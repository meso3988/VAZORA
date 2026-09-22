import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { buildOfficerContext } from "@/lib/officer/context";
import { runContractSweep } from "@/lib/officer/sweep";
import { requireSupabaseEnv } from "@/lib/supabase/env";

/**
 * Scheduled sweep endpoint — no browser presence required.
 *
 * Authentication is a shared secret in a header, NOT a user session, so a
 * cron/scheduler can call it. Guard rails:
 *   * disabled entirely unless VAZORA_SWEEP_SECRET is configured
 *   * constant-time-ish comparison, no secret echoed back
 *   * an explicit organizationId is required — it never sweeps "everything"
 *     implicitly, and the caller must also supply the service-role key path
 *     through env (the anon client cannot read another tenant)
 *   * results are counts only; no contract or evidence content is returned
 *
 * This deliberately introduces no external automation infrastructure: point
 * any scheduler at it, or keep using the in-app "Run sweep now" button.
 */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const secret = process.env.VAZORA_SWEEP_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "sweep endpoint disabled" }, { status: 404 });
  }
  const presented = request.headers.get("x-vazora-sweep-secret") ?? "";
  if (!timingSafeEqual(presented, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // A scheduled run has no user session, so it needs the service role to read
  // tenant rows. Absent that, the endpoint refuses rather than pretending.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "scheduled sweeps require SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 },
    );
  }

  let body: { organizationId?: string; actorUserId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const organizationId = body.organizationId;
  const actorUserId = body.actorUserId;
  if (!organizationId || !actorUserId) {
    return NextResponse.json(
      { error: "organizationId and actorUserId are required" },
      { status: 400 },
    );
  }

  const { url } = requireSupabaseEnv();
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServer>>;

  // buildOfficerContext still requires a real membership row for the actor:
  // the secret authorizes the CALL, the membership authorizes the SCOPE.
  const ctx = await buildOfficerContext({
    supabase, organizationId, userId: actorUserId, locale: "en",
  });
  if (!ctx) {
    return NextResponse.json({ error: "actor is not a member of that organization" }, { status: 403 });
  }

  const outcome = await runContractSweep({ ctx, trigger: "scheduled" });
  return NextResponse.json({
    status: outcome.status,
    sweepRunId: outcome.sweepRunId,
    contractsTotal: outcome.contractsTotal,
    contractsDone: outcome.contractsDone,
    created: outcome.created,
    updated: outcome.updated,
    resolved: outcome.resolved,
    // Codes only — no contract or evidence text crosses this boundary.
    failures: outcome.failures.length,
  });
}
