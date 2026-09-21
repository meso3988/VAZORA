import "server-only";

import type { SupabaseLike } from "@/lib/evidence/run";

/**
 * Phase 3 stability patch — VERIFICATION_DISCREPANCY.
 *
 * A weaker result on the SAME immutable evidence_version + SAME requirement
 * that was previously effectively VERIFIED is a model-disagreement event, not
 * an operational regression. The prior resolution stays in force; a pending
 * discrepancy row is recorded; only an authorized human may keep the prior
 * state or confirm the regression (which opens a NEW gap with
 * opened_via = 'human_confirmed_verification_regression').
 *
 * A NEW evidence version re-verifies normally — this module only ever
 * intercepts same-version reruns.
 */

export type DiscrepancyDecision = "keep_prior" | "confirm_regression";

/** Result weaker than verified → eligible for discrepancy interception. */
const WEAKER_THAN_VERIFIED = new Set([
  "partial", "missing", "not_found", "needs_human_review", "unable_to_verify",
]);

/**
 * Called during gap reconciliation when a run produced an unproven result for
 * a requirement with no currently-active gap. If a PRIOR run on the SAME
 * evidence version effectively verified this requirement (AI result or human
 * override), the weaker rerun is recorded as a pending discrepancy and the
 * previously-resolved gap is left untouched.
 *
 * Returns the discrepancy id when interception happened, else null (caller
 * proceeds with normal gap opening).
 */
export async function recordSameVersionDiscrepancy(opts: {
  supabase: SupabaseLike;
  organizationId: string;
  evidenceItemId: string;
  evidenceVersionId: string;
  evidenceRequirementId: string;
  /** the just-created run + check that produced the weaker result */
  currentRunId: string;
  currentCheckId: string;
  currentResult: string;
  provider: string | null;
  model: string | null;
  userId: string;
}): Promise<string | null> {
  const {
    supabase, organizationId, evidenceItemId, evidenceVersionId,
    evidenceRequirementId, currentRunId, currentCheckId, currentResult,
    provider, model, userId,
  } = opts;
  if (!WEAKER_THAN_VERIFIED.has(currentResult)) return null;

  // Prior completed runs against THIS SAME immutable version (never the
  // current run — append-only history means it already exists).
  const { data: priorRuns } = await supabase
    .from("evidence_verification_runs")
    .select("id, created_at")
    .eq("organization_id", organizationId)
    .eq("evidence_item_id", evidenceItemId)
    .eq("evidence_version_id", evidenceVersionId)
    .eq("status", "completed")
    .neq("id", currentRunId);
  const priorRunIds = (priorRuns ?? []).map((r) => r.id as string);
  if (!priorRunIds.length) return null;

  // Latest check for this requirement in those runs that was effectively
  // verified — human override counts as effectively verified.
  const { data: priorChecks } = await supabase
    .from("evidence_verification_checks")
    .select("id, verification_run_id, result, human_result, created_at")
    .eq("organization_id", organizationId)
    .eq("evidence_requirement_id", evidenceRequirementId)
    .in("verification_run_id", priorRunIds)
    .order("created_at", { ascending: false });
  const priorVerified = (priorChecks ?? []).find(
    (c) => (c.human_result ?? c.result) === "verified",
  );
  if (!priorVerified) return null;

  // Prior decisions on THIS exact (item, requirement, version) question.
  // Scoped per version: each immutable file is its own factual question, so
  // a stale decision on v1 must never silence a real v2 discrepancy.
  const { data: priorDecisions } = await supabase
    .from("evidence_verification_discrepancies")
    .select("id, status")
    .eq("organization_id", organizationId)
    .eq("evidence_item_id", evidenceItemId)
    .eq("evidence_requirement_id", evidenceRequirementId)
    .eq("evidence_version_id", evidenceVersionId)
    .in("status", ["pending", "kept_prior"]);

  // Already flagged and awaiting review — one row per open question.
  const pending = (priorDecisions ?? []).find((d) => d.status === "pending");
  if (pending) return pending.id as string;

  // A human already retained the prior verified state for this exact
  // version: the decision stands until a NEW version arrives. Re-raising it
  // on every rerun of unchanged bytes would be review-queue noise — suppress
  // the new row AND the gap, which is precisely what "remains in force" means.
  const kept = (priorDecisions ?? []).find((d) => d.status === "kept_prior");
  if (kept) return kept.id as string;

  const { data: row, error } = await supabase
    .from("evidence_verification_discrepancies")
    .insert({
      organization_id: organizationId,
      evidence_item_id: evidenceItemId,
      evidence_version_id: evidenceVersionId,
      evidence_requirement_id: evidenceRequirementId,
      prior_check_id: priorVerified.id,
      current_check_id: currentCheckId,
      prior_run_id: priorVerified.verification_run_id,
      current_run_id: currentRunId,
      prior_result: "verified",
      current_result: currentResult,
      provider,
      model,
    })
    .select("id")
    .single();
  if (error || !row) return null;

  await supabase.from("activity_log").insert({
    organization_id: organizationId,
    actor_user_id: userId,
    event_type: "evidence.verification_discrepancy_detected",
    entity_type: "evidence_item",
    entity_id: evidenceItemId,
    metadata: {
      discrepancy_id: row.id,
      requirement_id: evidenceRequirementId,
      version_id: evidenceVersionId,
      prior_run_id: priorVerified.verification_run_id,
      current_run_id: currentRunId,
      prior_result: "verified",
      current_result: currentResult,
      provider,
      model,
    },
  });
  return row.id as string;
}

/** Map a weaker check result to the gap type a confirmed regression opens. */
function gapTypeFor(result: string): string {
  if (result === "partial") return "partial_evidence";
  if (result === "missing" || result === "not_found") return "missing_evidence";
  return "quality";
}

/**
 * Authorized human decision on a pending discrepancy.
 *
 * keep_prior        — prior verified state stays in force; no gap opens.
 * confirm_regression — a NEW gap opens, explicitly attributed to the human
 *                     decision via opened_via, never implied as AI output.
 */
export async function resolveDiscrepancy(opts: {
  supabase: SupabaseLike;
  orgId: string;
  userId: string;
  discrepancyId: string;
  decision: DiscrepancyDecision;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, orgId, userId, discrepancyId, decision, reason } = opts;

  const { data: disc } = await supabase
    .from("evidence_verification_discrepancies")
    .select("*")
    .eq("id", discrepancyId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!disc) return { ok: false, error: "not_found" };
  if (disc.status !== "pending") return { ok: false, error: "already_resolved" };

  const resolvedAt = new Date().toISOString();
  const status = decision === "keep_prior" ? "kept_prior" : "regression_confirmed";
  const { error: upErr } = await supabase
    .from("evidence_verification_discrepancies")
    .update({ status, resolved_by: userId, resolved_at: resolvedAt, resolution_note: reason })
    .eq("id", discrepancyId)
    .eq("organization_id", orgId)
    .eq("status", "pending");
  if (upErr) return { ok: false, error: upErr.message };

  if (decision === "keep_prior") {
    await supabase.from("activity_log").insert({
      organization_id: orgId,
      actor_user_id: userId,
      event_type: "evidence.verification_previous_state_retained",
      entity_type: "evidence_item",
      entity_id: disc.evidence_item_id,
      metadata: {
        discrepancy_id: discrepancyId,
        requirement_id: disc.evidence_requirement_id,
        prior_run_id: disc.prior_run_id,
        current_run_id: disc.current_run_id,
      },
    });
    return { ok: true };
  }

  // Confirmed regression — open a NEW gap with explicit human attribution.
  // The prior resolved gap is history and stays resolved.
  const { data: item } = await supabase
    .from("evidence_items")
    .select("contract_id, obligation_id")
    .eq("id", disc.evidence_item_id)
    .eq("organization_id", orgId)
    .maybeSingle();
  const { data: gapRow } = await supabase
    .from("evidence_gaps")
    .insert({
      organization_id: orgId,
      contract_id: item?.contract_id,
      obligation_id: item?.obligation_id,
      evidence_requirement_id: disc.evidence_requirement_id,
      verification_run_id: disc.current_run_id,
      gap_type: gapTypeFor(disc.current_result as string),
      description: `Human-confirmed verification regression: ${disc.prior_result} → ${disc.current_result}.`,
      status: "open",
      opened_via: "human_confirmed_verification_regression",
    })
    .select("id")
    .single();

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: userId,
    event_type: "evidence.verification_regression_confirmed",
    entity_type: "evidence_item",
    entity_id: disc.evidence_item_id,
    metadata: {
      discrepancy_id: discrepancyId,
      requirement_id: disc.evidence_requirement_id,
      prior_run_id: disc.prior_run_id,
      current_run_id: disc.current_run_id,
      gap_id: gapRow?.id ?? null,
      opened_via: "human_confirmed_verification_regression",
    },
  });
  if (gapRow) {
    await supabase.from("activity_log").insert({
      organization_id: orgId,
      actor_user_id: userId,
      event_type: "evidence.gap_opened",
      entity_type: "evidence_gap",
      entity_id: gapRow.id,
      metadata: {
        run_id: disc.current_run_id,
        requirement_id: disc.evidence_requirement_id,
        opened_via: "human_confirmed_verification_regression",
        discrepancy_id: discrepancyId,
      },
    });
  }
  return { ok: true };
}
