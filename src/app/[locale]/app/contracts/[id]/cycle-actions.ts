"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { roleHasCapability, type AnyRole } from "@/lib/officer/authority";
import { buildOfficerContext } from "@/lib/officer/context";
import { scheduleCycles } from "@/lib/officer/schedule";
import { addDays } from "@/lib/officer/time";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Record / correct the completion of ONE obligation cycle (migration 0015).
 * The actor and time come from the session and the database; the role is
 * checked here (existing capability model) and again in the database
 * function. A recorded completion is not evidence verification, client
 * acceptance, a claim or a payment; it changes no due date, verification
 * result or evidence gap.
 */

const KNOWN_ERRORS = new Set([
  "not_authenticated", "obligation_not_found", "not_authorized", "obligation_not_operational", "note_required",
  "not_a_scheduled_cycle", "schedule_not_defined", "cycle_not_yet_due", "completion_date_in_future",
  "evidence_item_required", "evidence_out_of_scope", "evidence_version_out_of_scope", "evidence_used_for_other_cycle",
  "cycle_already_settled", "settlement_not_found", "reason_required", "settlement_not_active",
]);

const loc = (formData: FormData) => {
  const raw = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Live session + the caller's role in THIS organization, read server-side. */
async function authorizedCaller() {
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) return null;
  const supabase = await createSupabaseServer();
  const { data: m } = await supabase.from("organization_members").select("role")
    .eq("organization_id", session.organizationId).eq("user_id", session.user.id).maybeSingle();
  const role = (m?.role ?? null) as AnyRole | null;
  return { session, supabase, allowed: roleHasCapability(role, "obligation.settle_cycle") };
}

function errorCode(message: string | undefined): string {
  const code = (message ?? "").trim();
  return KNOWN_ERRORS.has(code) ? code : "write_failed";
}

export async function recordCycleCompletion(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const obligationId = String(formData.get("obligationId") ?? "").slice(0, 64);
  const cycle = String(formData.get("cycleDueDate") ?? "");
  const completedOn = String(formData.get("completedOn") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "").trim();
  const back = (q: string) => `/app/contracts/${contractId}/obligations?${q}`;

  const caller = await authorizedCaller();
  if (!caller) { redirect({ href: "/login", locale }); throw new Error("unreachable"); }
  if (!caller.allowed) { redirect({ href: back("cycleError=not_authorized"), locale }); throw new Error("unreachable"); }
  if (!UUID.test(obligationId) || !ISO.test(cycle) || (completedOn && !ISO.test(completedOn)) || (evidenceItemId && !UUID.test(evidenceItemId))) {
    redirect({ href: back("cycleError=invalid"), locale }); throw new Error("unreachable");
  }
  if (!note) { redirect({ href: back("cycleError=note_required"), locale }); throw new Error("unreachable"); }

  const { session, supabase } = caller;
  // The cycle must be one of the obligation's scheduled cycles (same
  // schedule as every other surface), in the organization's own calendar.
  const [{ data: ob }, ctx] = await Promise.all([
    supabase.from("contract_obligations")
      .select("id, contract_id, due_date_normalized, due_rule_normalized, contracts!inner(start_date, end_date)")
      .eq("organization_id", session.organizationId).eq("id", obligationId).eq("contract_id", contractId).maybeSingle(),
    buildOfficerContext({ supabase, organizationId: session.organizationId, userId: session.user.id, locale }),
  ]);
  if (!ob || !ctx) { redirect({ href: back("cycleError=obligation_not_found"), locale }); throw new Error("unreachable"); }
  const k = (Array.isArray(ob.contracts) ? ob.contracts[0] : ob.contracts) as { start_date: string | null; end_date: string | null } | null;
  const scheduled = ob.due_date_normalized
    ? [ob.due_date_normalized as string]
    : scheduleCycles({ dueRuleNormalized: ob.due_rule_normalized as string | null, contractStart: k?.start_date, contractEnd: k?.end_date, until: addDays(ctx.clock.today, 31) });
  if (!scheduled.includes(cycle)) { redirect({ href: back("cycleError=not_a_scheduled_cycle"), locale }); throw new Error("unreachable"); }

  const { error } = await supabase.rpc("record_obligation_cycle_settlement", {
    p_obligation_id: obligationId,
    p_cycle_due_date: cycle,
    p_completed_on: completedOn || null,
    p_note: note,
    p_evidence_item_id: evidenceItemId || null,
    p_evidence_version_id: null,
  });
  if (error) { redirect({ href: back(`cycleError=${errorCode(error.message)}`), locale }); throw new Error("unreachable"); }
  redirect({ href: back(`cycleRecorded=${cycle}`), locale });
}

export async function voidCycleCompletion(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const settlementId = String(formData.get("settlementId") ?? "").slice(0, 64);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const back = (q: string) => `/app/contracts/${contractId}/obligations?${q}`;

  const caller = await authorizedCaller();
  if (!caller) { redirect({ href: "/login", locale }); throw new Error("unreachable"); }
  if (!caller.allowed) { redirect({ href: back("cycleError=not_authorized"), locale }); throw new Error("unreachable"); }
  if (!UUID.test(settlementId)) { redirect({ href: back("cycleError=invalid"), locale }); throw new Error("unreachable"); }
  if (!reason) { redirect({ href: back("cycleError=reason_required"), locale }); throw new Error("unreachable"); }

  const { error } = await caller.supabase.rpc("void_obligation_cycle_settlement", { p_settlement_id: settlementId, p_reason: reason });
  if (error) { redirect({ href: back(`cycleError=${errorCode(error.message)}`), locale }); throw new Error("unreachable"); }
  redirect({ href: back("cycleVoided=1"), locale });
}
