import "server-only";

import type { OfficerObservationView } from "@/domain/officer";
import type { OfficerContext } from "@/lib/officer/context";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Read and decide on Officer observations. All access is organization-scoped. */

export type ObservationRow = OfficerObservationView & {
  severity: "critical" | "high" | "medium" | "low" | "informational";
  timeBucket: "critical" | "today" | "next_3_days" | "this_week" | "monitoring" | "resolved";
  recommendedActionType: string | null;
  supportingFacts: Record<string, unknown>;
  reopenCount: number;
};

export function mapObservation(row: any): ObservationRow {
  return {
    id: row.id,
    contractId: row.contract_id,
    obligationId: row.obligation_id,
    evidenceRequirementId: row.evidence_requirement_id,
    kind: row.kind,
    priority: row.priority,
    priorityReason: (row.priority_reason ?? []) as string[],
    title: row.title,
    detail: row.detail,
    citations: (row.citations ?? []) as OfficerObservationView["citations"],
    status: row.status,
    dedupeKey: row.dedupe_key,
    firstDetectedAt: row.first_detected_at,
    lastSeenAt: row.last_seen_at,
    acknowledgedBy: row.acknowledged_by,
    resolvedAt: row.resolved_at,
    severity: row.severity,
    timeBucket: row.time_bucket,
    recommendedActionType: row.recommended_action_type,
    supportingFacts: (row.supporting_facts ?? {}) as Record<string, unknown>,
    reopenCount: row.reopen_count ?? 0,
  };
}

/** Upper bound per read; hitting it means the list may be incomplete. */
const OBSERVATION_READ_LIMIT = 1000;

/**
 * A failed or truncated read is NOT an empty list. Callers get an explicit
 * outcome so "no observations" can never be produced by an error.
 */
export type ObservationRead =
  | { ok: true; rows: ObservationRow[] }
  | { ok: false; code: "observations_read_failed" | "observations_truncated" };

/** Active + acknowledged observations, plus recently resolved for context. */
export async function readObservations(
  ctx: OfficerContext,
  opts: { includeResolvedSince?: string | null; contractId?: string | null } = {},
): Promise<ObservationRead> {
  const base = () => {
    let q = ctx.supabase
      .from("officer_observations")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("priority", { ascending: true })
      .order("last_seen_at", { ascending: false })
      .limit(OBSERVATION_READ_LIMIT);
    if (opts.contractId) q = q.eq("contract_id", opts.contractId);
    return q;
  };
  try {
    // Open rows are read on their own, so accumulated history can never push
    // an unresolved issue out of the window.
    const open = await base().in("status", ["active", "acknowledged"]);
    if (open.error || !Array.isArray(open.data)) return { ok: false, code: "observations_read_failed" };
    let resolved: any[] = [];
    if (opts.includeResolvedSince) {
      const r = await base().eq("status", "resolved").gte("resolved_at", opts.includeResolvedSince);
      if (r.error || !Array.isArray(r.data)) return { ok: false, code: "observations_read_failed" };
      resolved = r.data;
    }
    if (open.data.length >= OBSERVATION_READ_LIMIT || resolved.length >= OBSERVATION_READ_LIMIT) {
      return { ok: false, code: "observations_truncated" };
    }
    return { ok: true, rows: [...open.data, ...resolved].map(mapObservation) };
  } catch {
    return { ok: false, code: "observations_read_failed" };
  }
}

/** Throwing variant for callers without an incomplete state of their own. */
export async function listObservations(
  ctx: OfficerContext,
  opts: { includeResolvedSince?: string | null; contractId?: string | null } = {},
): Promise<ObservationRow[]> {
  const r = await readObservations(ctx, opts);
  if (!r.ok) throw new Error(r.code);
  return r.rows;
}

/** One observation, validated against the caller's organization. */
export async function getObservation(ctx: OfficerContext, id: string): Promise<ObservationRow | null> {
  const { data } = await ctx.supabase
    .from("officer_observations")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("id", id)
    .maybeSingle();
  return data ? mapObservation(data) : null;
}

export type ObservationOutcome = { ok: true } | { ok: false; error: string };

/**
 * Acknowledge: "I have seen this." It does NOT resolve the condition — only
 * the sweep may resolve, when the underlying facts change.
 */
export async function acknowledgeObservation(ctx: OfficerContext, id: string): Promise<ObservationOutcome> {
  const { data, error } = await ctx.supabase
    .from("officer_observations")
    .update({ status: "acknowledged", acknowledged_by: ctx.userId, acknowledged_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "active")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found_or_not_active" };
  await ctx.supabase.from("activity_log").insert({
    organization_id: ctx.organizationId,
    actor_user_id: ctx.userId,
    event_type: "officer.observation_acknowledged",
    entity_type: "officer_observation",
    entity_id: id,
    metadata: {},
  });
  return { ok: true };
}

/**
 * Advance the caller's review watermark.
 *
 * DOCUMENTED SEMANTIC: `last_reviewed_at` means "the moment a review
 * experience was successfully presented to THIS user". The page only calls
 * this from a post-mount client beacon, so it can never move on a failed
 * request, an unauthorized request, a render failure, or a mere navigation
 * to the URL — any of those would silently skip changes the user never saw.
 * (Trade-off: a script-disabled session sees the review but does not advance
 * the watermark — under-marking is safe, over-marking is not.)
 *
 * The watermark is per user (RLS restricts the row to its own user), so one
 * member reviewing does not consume another member's changes.
 */
export async function markReviewed(ctx: OfficerContext): Promise<void> {
  const now = new Date().toISOString();
  const { data } = await ctx.supabase
    .from("officer_user_state")
    .select("organization_id")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (data) {
    await ctx.supabase.from("officer_user_state")
      .update({ last_reviewed_at: now })
      .eq("organization_id", ctx.organizationId).eq("user_id", ctx.userId);
  } else {
    await ctx.supabase.from("officer_user_state")
      .insert({ organization_id: ctx.organizationId, user_id: ctx.userId, last_reviewed_at: now });
  }
}

export async function getUserState(ctx: OfficerContext): Promise<{ lastReviewedAt: string | null; lastBriefAt: string | null }> {
  const { data } = await ctx.supabase
    .from("officer_user_state")
    .select("last_reviewed_at, last_brief_at")
    .eq("organization_id", ctx.organizationId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return {
    lastReviewedAt: (data?.last_reviewed_at as string | null) ?? null,
    lastBriefAt: (data?.last_brief_at as string | null) ?? null,
  };
}
