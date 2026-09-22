import "server-only";

import type { OfficerContext } from "@/lib/officer/context";
import { getUserState, listObservations, type ObservationRow } from "@/lib/officer/observations";
import { getOfficerProvider } from "@/lib/officer/provider";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Today Brief.
 *
 * The DATA object is built deterministically from observations and real audit
 * events — counts, priorities and changes are never produced by a model. A
 * single bounded model pass may then word it naturally; if that pass fails or
 * is unconfigured, the deterministic brief still stands on its own.
 */

/** Audit events that represent a real operational change worth reporting. */
const CHANGE_EVENTS: Record<string, string> = {
  "evidence.version_uploaded": "evidence_uploaded",
  "evidence.verification_completed": "verification_completed",
  "evidence.reverification_completed": "verification_completed",
  "evidence.gap_opened": "gap_opened",
  "evidence.gap_closed": "gap_resolved",
  "evidence.verification_discrepancy_detected": "discrepancy_detected",
  "evidence.verification_regression_confirmed": "regression_confirmed",
  "evidence.verification_previous_state_retained": "prior_state_retained",
  "evidence.human_override": "human_override",
  "officer.action_approved": "action_approved",
  "officer.action_rejected": "action_rejected",
  "officer.observation_resolved": "issue_resolved",
};

export type BriefChange = {
  kind: string;
  eventType: string;
  at: string;
  entityType: string;
  entityId: string | null;
};

export type TodayBrief = {
  asOfDate: string;
  timeZone: string;
  localTime: string;
  /** the watermark this brief compares against */
  since: string | null;
  sinceKind: "last_review" | "last_sweep" | "last_24h";
  newIssues: number;
  resolvedSinceLastReview: number;
  approvalsWaiting: number;
  counts: {
    critical: number;
    today: number;
    next3Days: number;
    thisWeek: number;
    monitoring: number;
  };
  highestPriorityItems: {
    observationId: string;
    kind: string;
    severity: string;
    title: string;
    detail: string | null;
    contractId: string | null;
    obligationId: string | null;
    supportingFacts: Record<string, unknown>;
    citations: { target: string; id: string; label: string }[];
  }[];
  changes: BriefChange[];
  /** true when nothing needs attention — do not manufacture activity */
  quiet: boolean;
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "informational"];

/**
 * Build the deterministic brief. `since` resolution order: the user's own last
 * review, else the previous successful sweep, else 24h — always a real
 * timestamp, never an assumption.
 */
export async function buildTodayBrief(ctx: OfficerContext): Promise<TodayBrief> {
  const userState = await getUserState(ctx);

  const { data: lastSweep } = await ctx.supabase
    .from("officer_sweep_runs")
    .select("started_at, completed_at")
    .eq("organization_id", ctx.organizationId)
    .in("status", ["completed", "partial"])
    .order("started_at", { ascending: false })
    .limit(2);
  // index 1 = the sweep before the most recent one
  const previousSweepAt = (lastSweep ?? [])[1]?.completed_at ?? (lastSweep ?? [])[1]?.started_at ?? null;

  let since: string | null = userState.lastReviewedAt;
  let sinceKind: TodayBrief["sinceKind"] = "last_review";
  if (!since) {
    since = previousSweepAt;
    sinceKind = "last_sweep";
  }
  if (!since) {
    since = new Date(Date.now() - 86_400_000).toISOString();
    sinceKind = "last_24h";
  }

  const observations = await listObservations(ctx, { includeResolvedSince: since });
  const open = observations.filter((o) => o.status === "active" || o.status === "acknowledged");
  const resolvedSince = observations.filter((o) => o.status === "resolved");

  const newIssues = open.filter((o) => Date.parse(o.firstDetectedAt) >= Date.parse(since)).length;

  const { count: approvalsWaiting } = await ctx.supabase
    .from("officer_actions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.organizationId)
    .in("status", ["suggested", "waiting_for_approval"]);

  const { data: events } = await ctx.supabase
    .from("activity_log")
    .select("event_type, entity_type, entity_id, created_at")
    .eq("organization_id", ctx.organizationId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  const changes: BriefChange[] = (events ?? [])
    .filter((e: any) => CHANGE_EVENTS[e.event_type])
    .map((e: any) => ({
      kind: CHANGE_EVENTS[e.event_type], eventType: e.event_type,
      at: e.created_at, entityType: e.entity_type, entityId: e.entity_id,
    }));

  const ranked = [...open].sort((a, b) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    a.priority - b.priority ||
    Date.parse(a.firstDetectedAt) - Date.parse(b.firstDetectedAt));

  const bucket = (b: ObservationRow["timeBucket"]) => open.filter((o) => o.timeBucket === b).length;

  return {
    asOfDate: ctx.clock.today,
    timeZone: ctx.clock.timeZone,
    localTime: ctx.clock.localTime,
    since, sinceKind,
    newIssues,
    resolvedSinceLastReview: resolvedSince.length,
    approvalsWaiting: approvalsWaiting ?? 0,
    counts: {
      critical: bucket("critical"),
      today: bucket("today"),
      next3Days: bucket("next_3_days"),
      thisWeek: bucket("this_week"),
      monitoring: bucket("monitoring"),
    },
    highestPriorityItems: ranked.slice(0, 5).map((o) => ({
      observationId: o.id, kind: o.kind, severity: o.severity,
      title: o.title, detail: o.detail,
      contractId: o.contractId, obligationId: o.obligationId,
      supportingFacts: o.supportingFacts, citations: o.citations,
    })),
    changes,
    quiet: open.length === 0 && (approvalsWaiting ?? 0) === 0,
  };
}

/**
 * ONE bounded model pass to word the brief. Never per-obligation, never a
 * source of new facts: the model may only rephrase what the brief contains.
 * Failure is not an error — the deterministic brief is the product of record.
 */
export async function renderBriefNarrative(
  ctx: OfficerContext,
  brief: TodayBrief,
  opts: { displayName?: string | null } = {},
): Promise<{ text: string | null; provider: string | null; model: string | null; usage?: { inputTokens?: number; outputTokens?: number } }> {
  const provider = getOfficerProvider();
  if (!provider || !ctx.officer.enabled || brief.quiet) {
    return { text: null, provider: null, model: null };
  }

  const arabic = ctx.locale.startsWith("ar") || ctx.officer.preferredLanguage === "ar";
  const system = [
    "You word a contract officer's daily brief.",
    "You are given a JSON object of ALREADY-VERIFIED counts and items. Restate it in 4-8 short lines.",
    "Absolute rules: introduce NO fact that is not in the JSON. Do not compute dates. Do not estimate money or exposure — if a financial condition is flagged, say only that a financial condition exists. Do not invent names.",
    "Preserve contract numbers, clause numbers and identifiers verbatim.",
    arabic ? "Write in Arabic." : "Write in English.",
    "No markdown headings, no bullet characters other than a plain dash.",
  ].join("\n");

  const payload = {
    greeting_name: opts.displayName ?? null,
    as_of: brief.asOfDate, local_time: brief.localTime, timezone: brief.timeZone,
    since: brief.since, since_kind: brief.sinceKind,
    new_issues: brief.newIssues,
    resolved_since_last_review: brief.resolvedSinceLastReview,
    approvals_waiting: brief.approvalsWaiting,
    counts: brief.counts,
    highest_priority: brief.highestPriorityItems.map((i) => ({
      title: i.title, severity: i.severity, kind: i.kind,
      facts: i.supportingFacts,
    })),
    change_kinds: brief.changes.map((c) => c.kind),
  };

  const completion = await provider.complete({
    system,
    messages: [{ role: "user", content: JSON.stringify(payload) }],
    tools: [],
    maxOutputTokens: 500,
  });
  if (!completion.ok) return { text: null, provider: provider.id, model: provider.model };

  await ctx.supabase.from("activity_log").insert({
    organization_id: ctx.organizationId,
    actor_user_id: ctx.userId,
    event_type: "officer.brief_generated",
    entity_type: "officer_brief",
    entity_id: null,
    metadata: {
      as_of: brief.asOfDate, new_issues: brief.newIssues,
      approvals_waiting: brief.approvalsWaiting, provider: provider.id, model: completion.model ?? provider.model,
    },
  });

  return {
    text: completion.text.trim() || null,
    provider: provider.id,
    model: completion.model ?? provider.model,
    usage: completion.usage,
  };
}
