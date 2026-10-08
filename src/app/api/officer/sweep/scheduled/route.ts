import { NextResponse } from "next/server";

import { parseScheduledTargets, serviceDeps, sweepTargets, timingSafeEqual } from "@/lib/officer/scheduled-sweep";

/**
 * Vercel Cron adapter for the existing sweep (GET, as Vercel Cron calls it).
 *
 *   * disabled (404) unless CRON_SECRET is configured; Vercel Cron sends
 *     "Authorization: Bearer <CRON_SECRET>" — anything else is 401
 *   * the request chooses nothing: organizations and their actor come only
 *     from the server-side VAZORA_SCHEDULED_SWEEPS configuration
 *   * each actor's membership is checked (buildOfficerContext); a run never
 *     falls back to some other member
 *   * one running sweep per organization is enforced by the database
 *     (migration 0015); a concurrent manual run makes this one "skipped"
 *   * any failed / partial / unauthorized organization makes the response 500
 *     so the cron log shows it; counts and codes only
 *
 * The schedule itself is activated by adding a crons entry to vercel.json on
 * the production branch — not done here.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "scheduled sweep disabled" }, { status: 404 });
  if (!timingSafeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "scheduled sweeps require SUPABASE_SERVICE_ROLE_KEY" }, { status: 503 });
  }
  const targets = parseScheduledTargets(process.env.VAZORA_SCHEDULED_SWEEPS);
  if (!targets) {
    return NextResponse.json({ error: "VAZORA_SCHEDULED_SWEEPS is missing or invalid" }, { status: 503 });
  }
  const { ok, results } = await sweepTargets(targets, serviceDeps(serviceKey));
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
