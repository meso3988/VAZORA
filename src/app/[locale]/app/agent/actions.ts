"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { routing, type AppLocale } from "@/i18n/routing";
import { approveOfficerAction, rejectOfficerAction } from "@/lib/officer/actions";
import { askOfficer, createConversation } from "@/lib/officer/conversation";
import { buildOfficerContext, ensureOfficerProfile } from "@/lib/officer/context";
import { recordMemory } from "@/lib/officer/memory";
import { isValidTimeZone } from "@/lib/officer/time";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Contract Officer server actions.
 *
 * Every entry point rebuilds the Officer context from the SESSION — the
 * organization, the user and the role are never taken from the form. A
 * forged organization id resolves to no context and the action refuses.
 */

async function liveContext(locale: AppLocale) {
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/app", locale });
    throw new Error("unreachable");
  }
  const supabase = await createSupabaseServer();
  await ensureOfficerProfile({ supabase, organizationId: session.organizationId });
  const ctx = await buildOfficerContext({
    supabase,
    organizationId: session.organizationId,
    userId: session.user.id,
    locale,
  });
  if (!ctx) {
    redirect({ href: "/app?error=forbidden", locale });
    throw new Error("unreachable");
  }
  return ctx;
}

function localeOf(formData: FormData): AppLocale {
  const raw = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

/** Start a conversation (organization-wide, or scoped to one contract). */
export async function startOfficerConversation(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64) || null;

  const created = await createConversation(ctx, { contractId, title: null });
  if (!created.ok) {
    redirect({ href: `/app/agent?error=${created.error}`, locale });
    throw new Error("unreachable");
  }
  redirect({ href: `/app/agent?c=${created.conversation.id}`, locale });
}

/** Ask the Officer a question inside an existing conversation. */
export async function askOfficerQuestion(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64);
  const question = String(formData.get("question") ?? "").trim();
  if (!conversationId || !question) {
    redirect({ href: `/app/agent?c=${conversationId}&error=invalid`, locale });
    throw new Error("unreachable");
  }

  const result = await askOfficer(ctx, { conversationId, question });
  if (!result.ok) {
    redirect({ href: `/app/agent?c=${conversationId}&error=${result.error}`, locale });
    throw new Error("unreachable");
  }
  redirect({ href: `/app/agent?c=${conversationId}`, locale });
}

/** Approve a proposed action — the server re-authorizes before anything runs. */
export async function approveOfficerActionForm(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const actionId = String(formData.get("actionId") ?? "").slice(0, 64);
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64);

  const result = await approveOfficerAction(ctx, actionId);
  const back = `/app/agent${conversationId ? `?c=${conversationId}` : ""}`;
  redirect({
    href: result.ok ? `${back}${conversationId ? "&" : "?"}approved=${actionId}`
                    : `${back}${conversationId ? "&" : "?"}error=${encodeURIComponent(result.error)}`,
    locale,
  });
}

export async function rejectOfficerActionForm(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const actionId = String(formData.get("actionId") ?? "").slice(0, 64);
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000) || "rejected by reviewer";

  const result = await rejectOfficerAction(ctx, actionId, reason);
  const back = `/app/agent${conversationId ? `?c=${conversationId}` : ""}`;
  redirect({
    href: result.ok ? `${back}${conversationId ? "&" : "?"}rejected=${actionId}`
                    : `${back}${conversationId ? "&" : "?"}error=${encodeURIComponent(result.error)}`,
    locale,
  });
}

/**
 * Record an organizational fact the user explicitly confirmed. Only an
 * authorized human can create confirmed memory; nothing the model says
 * reaches this path.
 */
export async function recordOfficerMemory(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const content = String(formData.get("content") ?? "").trim();
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64) || null;
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64) || null;
  if (!content) {
    redirect({ href: `/app/agent?c=${conversationId ?? ""}&error=invalid`, locale });
    throw new Error("unreachable");
  }
  const result = await recordMemory(ctx, {
    content, origin: "user_confirmed", kind: "fact",
    contractId, conversationId,
  });
  redirect({
    href: `/app/agent?c=${conversationId ?? ""}&${result.ok ? "remembered=1" : `error=${result.error}`}`,
    locale,
  });
}

/**
 * Run a contract sweep now. Deterministic detection; no model involved.
 * Authorization is re-checked server-side — UI visibility is never the gate.
 */
export async function runOfficerSweep(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const { roleHasCapability } = await import("@/lib/officer/authority");
  if (!roleHasCapability(ctx.role, "officer.sweep.run")) {
    redirect({ href: "/app/agent?error=unauthorized_sweep", locale });
    throw new Error("unreachable");
  }
  const { runContractSweep } = await import("@/lib/officer/sweep");
  const outcome = await runContractSweep({ ctx, trigger: "manual" });
  redirect({
    href: `/app/agent?swept=${outcome.status}&created=${outcome.created}&resolved=${outcome.resolved}`,
    locale,
  });
}

/** Acknowledge an observation — "seen", never "resolved". */
export async function acknowledgeOfficerObservation(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const observationId = String(formData.get("observationId") ?? "").slice(0, 64);
  const { acknowledgeObservation } = await import("@/lib/officer/observations");
  const result = await acknowledgeObservation(ctx, observationId);
  redirect({
    href: `/app/agent?${result.ok ? "acknowledged=1" : `error=${result.error}`}`,
    locale,
  });
}

/**
 * "Explain this" — starts (or reuses) a conversation and asks the Officer
 * about ONE observation. The observation id is validated server-side and the
 * context is injected from the database, never copied out of the browser.
 */
export async function explainOfficerObservation(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const observationId = String(formData.get("observationId") ?? "").slice(0, 64);

  const { getObservation } = await import("@/lib/officer/observations");
  const observation = await getObservation(ctx, observationId);
  if (!observation) {
    redirect({ href: "/app/agent?error=observation_not_found", locale });
    throw new Error("unreachable");
  }

  const { createConversation, askOfficer } = await import("@/lib/officer/conversation");
  const created = await createConversation(ctx, {
    contractId: observation.contractId,
    title: observation.title.slice(0, 80),
  });
  if (!created.ok) {
    redirect({ href: `/app/agent?error=${created.error}`, locale });
    throw new Error("unreachable");
  }

  // The question carries only server-held identifiers; the Officer must look
  // the facts up itself rather than trusting a pasted summary.
  const question = [
    `Explain this monitoring finding and what should happen next.`,
    `Finding type: ${observation.kind}. Severity: ${observation.severity}.`,
    observation.obligationId ? `Obligation id: ${observation.obligationId}.` : "",
    observation.contractId ? `Contract id: ${observation.contractId}.` : "",
    observation.evidenceRequirementId ? `Evidence requirement id: ${observation.evidenceRequirementId}.` : "",
    `Verify the current state with your tools before answering.`,
  ].filter(Boolean).join(" ");

  const asked = await askOfficer(ctx, { conversationId: created.conversation.id, question });
  redirect({
    href: asked.ok
      ? `/app/agent?c=${created.conversation.id}`
      : `/app/agent?c=${created.conversation.id}&error=${asked.error}`,
    locale,
  });
}

/**
 * Propose the follow-up the sweep recommended for an observation. Creates an
 * approval request — it changes nothing by itself.
 */
export async function proposeObservationFollowUp(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const observationId = String(formData.get("observationId") ?? "").slice(0, 64);

  const { getObservation } = await import("@/lib/officer/observations");
  const observation = await getObservation(ctx, observationId);
  if (!observation || !observation.recommendedActionType) {
    redirect({ href: "/app/agent?error=no_recommended_action", locale });
    throw new Error("unreachable");
  }

  const { runOfficerTool } = await import("@/lib/officer/tools");
  // Assignment needs a named person, which only a human can choose — so the
  // Command Center routes it to an escalation rather than inventing an owner.
  const result = observation.recommendedActionType === "obligation.assign_owner"
    ? await runOfficerTool(ctx, "requestHumanApproval", {
        actionType: "officer.escalate",
        summary: `Assign an owner: ${observation.title}`.slice(0, 200),
        reason: `${observation.detail ?? observation.title} (monitoring finding ${observation.kind})`.slice(0, 2000),
        ...(observation.contractId ? { contractId: observation.contractId } : {}),
        ...(observation.obligationId ? { obligationId: observation.obligationId } : {}),
      })
    : await runOfficerTool(ctx, "requestHumanApproval", {
        actionType: observation.recommendedActionType === "officer.escalate"
          ? "officer.escalate" : "officer.request_evidence_internal",
        summary: observation.title.slice(0, 200),
        reason: `${observation.detail ?? observation.title} (monitoring finding ${observation.kind})`.slice(0, 2000),
        ...(observation.contractId ? { contractId: observation.contractId } : {}),
        ...(observation.obligationId ? { obligationId: observation.obligationId } : {}),
      });

  redirect({
    href: `/app/agent?${result.ok ? "proposed=1" : `error=${encodeURIComponent((result as { error: string }).error)}`}`,
    locale,
  });
}

/**
 * Set the organization timezone deliberately. Until this happens the
 * workspace prompts, rather than silently answering "today" in UTC.
 */
export async function setOrganizationTimezone(formData: FormData) {
  const locale = localeOf(formData);
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/app", locale });
    throw new Error("unreachable");
  }
  const timezone = String(formData.get("timezone") ?? "").trim();
  const back = String(formData.get("returnTo") ?? "/app/agent");
  if (!isValidTimeZone(timezone)) {
    redirect({ href: `${back}?error=invalid_timezone`, locale });
    throw new Error("unreachable");
  }
  const supabase = await createSupabaseServer();
  const { error } = await supabase
    .from("organizations")
    .update({ timezone, timezone_set_at: new Date().toISOString() })
    .eq("id", session.organizationId);
  redirect({ href: `${back}?${error ? `error=${error.message}` : "timezone=set"}`, locale });
}
