import "server-only";

import { createClient } from "@supabase/supabase-js";

import { buildOfficerContext, type OfficerContext } from "@/lib/officer/context";
import { runContractSweep, type SweepOutcome } from "@/lib/officer/sweep";
import { requireSupabaseEnv } from "@/lib/supabase/env";

/**
 * Shared core of the scheduled sweep endpoints. The secret authorizes the
 * CALL; the organization membership of the configured actor authorizes the
 * SCOPE (buildOfficerContext). Nothing here picks an actor or an organization
 * on its own: both come from server configuration or the authenticated POST.
 */

export type ScheduledTarget = { organizationId: string; actorUserId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Constant-time comparison; lengths differing is a plain mismatch. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * VAZORA_SCHEDULED_SWEEPS — server-only JSON list of
 * {"organizationId","actorUserId"} pairs. The actor should be a member account
 * designated for automation; scheduled runs are recorded with trigger
 * "scheduled". Returns null for any malformed configuration (never a guess).
 */
export function parseScheduledTargets(raw: string | undefined): ScheduledTarget[] | null {
  if (!raw?.trim()) return null;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length) return null;
    const out: ScheduledTarget[] = [];
    for (const t of list) {
      if (!t || !UUID.test(String(t.organizationId)) || !UUID.test(String(t.actorUserId))) return null;
      out.push({ organizationId: String(t.organizationId), actorUserId: String(t.actorUserId) });
    }
    return new Set(out.map((t) => t.organizationId)).size === out.length ? out : null;
  } catch {
    return null;
  }
}

export type TargetResult =
  | { organizationId: string; status: SweepOutcome["status"]; sweepRunId: string | null; contractsTotal: number; contractsDone: number; created: number; updated: number; resolved: number; failures: number }
  | { organizationId: string; status: "not_authorized" };

type Deps = {
  buildContext: (target: ScheduledTarget) => Promise<OfficerContext | null>;
  run: (ctx: OfficerContext) => Promise<SweepOutcome>;
};

/** Service-role context for one target; null when the actor is not a member. */
export function serviceDeps(serviceKey: string): Deps {
  const { url } = requireSupabaseEnv();
  return {
    buildContext: (t) => buildOfficerContext({
      supabase: createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as OfficerContext["supabase"],
      organizationId: t.organizationId, userId: t.actorUserId, locale: "en",
    }),
    run: (ctx) => runContractSweep({ ctx, trigger: "scheduled" }),
  };
}

/** Sweep one target. Codes and counts only — no contract or evidence text. */
export async function sweepTarget(target: ScheduledTarget, deps: Deps): Promise<TargetResult> {
  const ctx = await deps.buildContext(target);
  if (!ctx) return { organizationId: target.organizationId, status: "not_authorized" };
  const o = await deps.run(ctx);
  return {
    organizationId: target.organizationId, status: o.status, sweepRunId: o.sweepRunId,
    contractsTotal: o.contractsTotal, contractsDone: o.contractsDone,
    created: o.created, updated: o.updated, resolved: o.resolved, failures: o.failures.length,
  };
}

/**
 * Sweep every configured target, each independently (each organization uses
 * its own clock inside runContractSweep). One organization's failure is
 * reported as such and never turns the whole run into a success.
 */
export async function sweepTargets(targets: ScheduledTarget[], deps: Deps) {
  const results: TargetResult[] = [];
  for (const t of targets) {
    try {
      results.push(await sweepTarget(t, deps));
    } catch {
      results.push({ organizationId: t.organizationId, status: "failed", sweepRunId: null, contractsTotal: 0, contractsDone: 0, created: 0, updated: 0, resolved: 0, failures: 1 });
    }
  }
  const failed = results.filter((r) => r.status === "failed" || r.status === "partial" || r.status === "not_authorized");
  return { ok: failed.length === 0, results };
}
