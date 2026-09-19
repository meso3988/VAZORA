"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Human review actions on extracted obligations. All mutations flow through
 * RLS with the caller's JWT; organization is derived server-side.
 * The DB activation gate also blocks activating unapproved obligations.
 */

function loc(formData: FormData) {
  const raw = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

async function liveSession() {
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) return null;
  return session;
}

/** Approve one obligation extraction. */
export async function approveObligation(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const obligationId = String(formData.get("obligationId") ?? "").slice(0, 64);

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();
  await supabase
    .from("contract_obligations")
    .update({ review_status: "approved", reviewed_by: session.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", obligationId)
    .eq("organization_id", session.organizationId)
    .eq("contract_id", contractId);

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "obligation.approved",
    entity_type: "obligation",
    entity_id: obligationId,
  });

  redirect({ href: `/app/contracts/${contractId}/review`, locale });
}

/** Reject an extraction draft. Not deleted — stays auditable. */
export async function rejectObligation(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const obligationId = String(formData.get("obligationId") ?? "").slice(0, 64);
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();
  await supabase
    .from("contract_obligations")
    .update({ review_status: "rejected", reviewed_by: session.user.id, reviewed_at: new Date().toISOString(), review_notes: note })
    .eq("id", obligationId)
    .eq("organization_id", session.organizationId)
    .eq("contract_id", contractId);

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "obligation.rejected",
    entity_type: "obligation",
    entity_id: obligationId,
    metadata: { note },
  });

  redirect({ href: `/app/contracts/${contractId}/review`, locale });
}

/**
 * Edit + approve. Stored in reviewed_values; the original AI payload is never
 * overwritten. The audit record captures both.
 */
export async function editObligation(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const obligationId = String(formData.get("obligationId") ?? "").slice(0, 64);
  const title = String(formData.get("title") ?? "").trim().slice(0, 240);
  const requirement = String(formData.get("requirement_text") ?? "").trim();
  const frequency = String(formData.get("frequency") ?? "").trim().slice(0, 120) || null;
  const due = String(formData.get("due_rule_raw") ?? "").trim().slice(0, 400) || null;
  const owner = String(formData.get("owner_role_suggested") ?? "").trim().slice(0, 120) || null;
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();
  const { data: original } = await supabase
    .from("contract_obligations")
    .select("title, requirement_text, frequency, due_rule_raw, owner_role_suggested")
    .eq("id", obligationId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!original) { redirect({ href: `/app/contracts/${contractId}/review`, locale }); throw new Error("s"); }

  const edits = { title, requirement_text: requirement, frequency, due_rule_raw: due, owner_role_suggested: owner };
  const values: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(edits)) {
    if (String(v ?? "") !== String((original as Record<string, unknown>)[k] ?? "")) values[k] = v;
  }

  await supabase
    .from("contract_obligations")
    .update({
      review_status: "approved",
      reviewed_by: session.user.id,
      reviewed_at: new Date().toISOString(),
      reviewed_values: Object.keys(values).length ? values : null,
      review_notes: note,
      // the display columns track reviewed values so downstream reads use them
      title,
      requirement_text: requirement || original.requirement_text,
      frequency: frequency ?? (original.frequency as string | null),
      due_rule_raw: due ?? (original.due_rule_raw as string | null),
      owner_role_suggested: owner ?? (original.owner_role_suggested as string | null),
      field_provenance: { ...(await provenanceOf(supabase, obligationId)), edited_by_human: "explicit" },
      needs_source_review: false,
    })
    .eq("id", obligationId)
    .eq("organization_id", session.organizationId);

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "obligation.edited",
    entity_type: "obligation",
    entity_id: obligationId,
    metadata: { original, edited: values, note },
  });

  redirect({ href: `/app/contracts/${contractId}/review`, locale });
}

async function provenanceOf(supabase: Awaited<ReturnType<typeof createSupabaseServer>>, id: string) {
  const { data } = await supabase.from("contract_obligations").select("field_provenance").eq("id", id).maybeSingle();
  return (data?.field_provenance as Record<string, unknown>) ?? {};
}

/** Safe bulk approval: only obligations that pass the bulk-eligibility rules. */
export async function bulkApprove(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();
  const { data: rows } = await supabase
    .from("contract_obligations")
    .select("id, review_status, needs_source_review, ai_confidence, financial_condition, penalty_condition, conflict_group_id, due_date_normalized, due_rule_normalized")
    .eq("organization_id", session.organizationId)
    .eq("contract_id", contractId)
    .eq("review_status", "extracted");

  const eligible = (rows ?? []).filter((o) =>
    !o.needs_source_review &&
    (o.ai_confidence ?? 0) >= 0.85 &&
    !o.financial_condition &&
    !o.penalty_condition &&
    !o.conflict_group_id &&
    (o.due_date_normalized || o.due_rule_normalized),
  );

  if (eligible.length) {
    await supabase
      .from("contract_obligations")
      .update({ review_status: "approved", reviewed_by: session.user.id, reviewed_at: new Date().toISOString() })
      .in("id", eligible.map((o) => o.id))
      .eq("organization_id", session.organizationId)
      .eq("contract_id", contractId);

    for (const o of eligible) {
      await supabase.from("activity_log").insert({
        organization_id: session.organizationId,
        actor_user_id: session.user.id,
        event_type: "obligation.approved",
        entity_type: "obligation",
        entity_id: o.id,
        metadata: { bulk: true },
      });
    }
  }

  redirect({ href: `/app/contracts/${contractId}/review?bulk=${eligible.length}`, locale });
}

/** Approve an assignment suggestion (role + optional person). */
export async function approveAssignment(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const suggestionId = String(formData.get("suggestionId") ?? "").slice(0, 64);

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();
  await supabase
    .from("obligation_assignment_suggestions")
    .update({ approved: true, decided_by: session.user.id, decided_at: new Date().toISOString() })
    .eq("id", suggestionId)
    .eq("organization_id", session.organizationId);

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "assignment.approved",
    entity_type: "assignment",
    entity_id: suggestionId,
  });

  redirect({ href: `/app/contracts/${contractId}/review`, locale });
}

/** Approve all high-confidence assignment suggestions at once. */
export async function bulkApproveAssignments(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();
  const { data: sugg } = await supabase
    .from("obligation_assignment_suggestions")
    .select("id, obligation:obligation_id!inner(contract_id)")
    .eq("organization_id", session.organizationId)
    .eq("confidence", "high")
    .is("approved", null);

  const ids = (sugg ?? [])
    .filter((s) => (s.obligation as { contract_id?: string } | null)?.contract_id === contractId)
    .map((s) => s.id as string);

  if (ids.length) {
    await supabase
      .from("obligation_assignment_suggestions")
      .update({ approved: true, decided_by: session.user.id, decided_at: new Date().toISOString() })
      .in("id", ids)
      .eq("organization_id", session.organizationId);
    await supabase.from("activity_log").insert({
      organization_id: session.organizationId,
      actor_user_id: session.user.id,
      event_type: "assignment.approved",
      entity_type: "contract",
      entity_id: contractId,
      metadata: { bulk: true, count: ids.length },
    });
  }

  redirect({ href: `/app/contracts/${contractId}/review`, locale });
}

/** Deliberate activation: only when every obligation is approved or rejected. */
export async function activateContract(formData: FormData) {
  const locale = loc(formData);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);

  const session = await liveSession();
  if (!session) { redirect({ href: "/login", locale }); throw new Error("s"); }

  const supabase = await createSupabaseServer();

  const { data: rows, error } = await supabase
    .from("contract_obligations")
    .select("id, review_status")
    .eq("organization_id", session.organizationId)
    .eq("contract_id", contractId);
  if (error || !rows) redirect({ href: `/app/contracts/${contractId}/review?err=read`, locale });

  const unresolved = (rows ?? []).filter((o) => o.review_status === "extracted" || o.review_status === "needs_review" || o.review_status === "conflict_requires_review").length;
  const approved = (rows ?? []).filter((o) => o.review_status === "approved").map((o) => o.id as string);
  if (!approved.length || unresolved > 0) {
    redirect({ href: `/app/contracts/${contractId}/review?err=unresolved&n=${unresolved}`, locale });
  }

  const { error: actErr } = await supabase
    .from("contract_obligations")
    .update({ activation_status: "active" })
    .in("id", approved)
    .eq("organization_id", session.organizationId)
    .eq("contract_id", contractId)
    .eq("review_status", "approved");
  if (actErr) redirect({ href: `/app/contracts/${contractId}/review?err=gate`, locale });

  const { data: latestRun } = await supabase
    .from("contract_ingestion_runs")
    .select("id")
    .eq("organization_id", session.organizationId)
    .eq("contract_id", contractId)
    .eq("status", "ready_for_review")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestRun) {
    await supabase.from("contract_ingestion_runs").update({ status: "approved" }).eq("id", latestRun.id);
  }

  await supabase.from("activity_log").insert({
    organization_id: session.organizationId,
    actor_user_id: session.user.id,
    event_type: "contract.activated",
    entity_type: "contract",
    entity_id: contractId,
    metadata: { obligations_active: approved.length },
  });

  redirect({ href: `/app/contracts/${contractId}?activated=1`, locale });
}
