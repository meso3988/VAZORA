import "server-only";

import type { SupabaseLike } from "@/lib/evidence/run";

export const OVERRIDE_RESULTS = new Set([
  "verified", "partial", "missing", "not_found",
  "not_applicable", "needs_human_review", "unable_to_verify",
]);

export type OverrideOutcome = { ok: true } | { ok: false; error: string };

/**
 * Authorized human override on a single check. The AI/deterministic result is
 * NEVER mutated — the human decision is stored alongside it (human_result +
 * reason + actor + timestamp). When the effective result becomes verified,
 * the matching open gap resolves via the check's verification run.
 */
export async function applyHumanOverride(opts: {
  supabase: SupabaseLike;
  orgId: string;
  userId: string;
  checkId: string;
  humanResult: string;
  reason: string;
}): Promise<OverrideOutcome> {
  const { supabase, orgId, userId, checkId, humanResult, reason } = opts;

  const { data: check } = await supabase
    .from("evidence_verification_checks")
    .select("id, verification_run_id, evidence_requirement_id")
    .eq("id", checkId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!check) return { ok: false, error: "forbidden" };

  const { error } = await supabase
    .from("evidence_verification_checks")
    .update({
      human_result: humanResult,
      human_reason: reason,
      overridden_by: userId,
      overridden_at: new Date().toISOString(),
    })
    .eq("id", checkId)
    .eq("organization_id", orgId);
  if (error) return { ok: false, error: "override" };

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: userId,
    event_type: "evidence.human_override",
    entity_type: "evidence_verification_check",
    entity_id: checkId,
    metadata: { run_id: check.verification_run_id, human_result: humanResult },
  });

  // Override to verified resolves the criterion's active gap — attribution is
  // the check's own run, and the override record keeps the AI result intact.
  if (humanResult === "verified" && check.evidence_requirement_id) {
    const { data: gap } = await supabase
      .from("evidence_gaps")
      .update({ status: "resolved", closed_by_verification_run_id: check.verification_run_id })
      .eq("organization_id", orgId)
      .eq("evidence_requirement_id", check.evidence_requirement_id)
      .in("status", ["open", "evidence_received", "reverification_pending"])
      .select("id")
      .maybeSingle();
    if (gap) {
      await supabase.from("activity_log").insert({
        organization_id: orgId,
        actor_user_id: userId,
        event_type: "evidence.gap_closed",
        entity_type: "evidence_gap",
        entity_id: gap.id,
        metadata: { run_id: check.verification_run_id, via: "human_override" },
      });
    }
  }

  return { ok: true };
}
