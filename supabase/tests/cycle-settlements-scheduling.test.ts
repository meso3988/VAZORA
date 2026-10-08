/* eslint-disable @typescript-eslint/no-explicit-any */
// Cycle settlements, review-field decisions wiring and the scheduled-sweep
// adapter — tests that need no database (fakes and static checks). The
// database behavior of migration 0015 is covered by e2e-cycle-settlements.ts
// once the migration is applied.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/cycle-settlements-scheduling.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readCycleSettlements, settledCyclesOf } from "../../src/data/supabase/cycle-settlements";
import { liveIndicatorsFromRows } from "../../src/domain/indicators";
import { obligationStates } from "../../src/domain/obligation-state";
import { roleHasCapability } from "../../src/lib/officer/authority";
import { obligationSchedule, scheduleCycles, usesCycleSettlements } from "../../src/lib/officer/schedule";
import { parseScheduledTargets, sweepTargets, timingSafeEqual } from "../../src/lib/officer/scheduled-sweep";
import { runContractSweep } from "../../src/lib/officer/sweep";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

/** Fake PostgREST builder recording calls and resolving to `result`. */
function fakeClient(result: { data: unknown; error: unknown } | "throw") {
  const calls: { op: string; args: unknown[] }[] = [];
  const b: Record<string, unknown> = {};
  for (const op of ["from", "select", "eq", "in", "order", "limit", "lt", "update", "insert", "single"]) {
    b[op] = (...args: unknown[]) => { calls.push({ op, args }); return b; };
  }
  b.then = (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
    result === "throw" ? Promise.reject(new Error("down")).then(ok, bad) : Promise.resolve(result).then(ok, bad);
  return { client: b as any, calls };
}

const base = { dueDateNormalized: null, dueRuleNormalized: "monthly_day_5", frequency: "monthly", contractStart: "2026-09-01", contractEnd: "2027-08-31" };

async function main() {
  // ---- schedule with recorded settlements ----
  const one = obligationSchedule({ ...base, today: "2026-12-10", settledCycles: ["2026-10-05"] }) as any;
  check("one settled cycle among several: the others stay due", one.firstUnsettled === "2026-09-05" && one.unsettledPastCount === 3 && one.settlementsKnown, JSON.stringify(one));
  const all3 = obligationSchedule({ ...base, today: "2026-12-10", settledCycles: ["2026-09-05", "2026-10-05", "2026-11-05", "2026-12-05"] }) as any;
  check("all due cycles settled → next cycle is the operational date", all3.firstUnsettled === null && all3.dueDate === "2027-01-05");
  const unknown = obligationSchedule({ ...base, today: "2026-12-10", settledCycles: null }) as any;
  check("settlement read failed → cycles stay due, settlementsKnown=false (no 'not completed' claim)", unknown.firstUnsettled === "2026-09-05" && unknown.settlementsKnown === false);
  check("scheduleCycles lists the schedule up to a date, inside the period",
    JSON.stringify(scheduleCycles({ dueRuleNormalized: "monthly_day_5", contractStart: "2026-09-10", contractEnd: "2026-12-31", until: "2027-03-01" })) === JSON.stringify(["2026-10-05", "2026-11-05", "2026-12-05"]));
  check("only rule-scheduled obligations read settlements", usesCycleSettlements({ dueDateNormalized: null, dueRuleNormalized: "monthly_day_5" }) && !usesCycleSettlements({ dueDateNormalized: "2026-09-29", dueRuleNormalized: "monthly_day_5" }) && !usesCycleSettlements({ dueDateNormalized: null, dueRuleNormalized: "relative_days_10" }));

  // ---- consumers ----
  const st = obligationStates([{ id: "o1", dueDate: "", lifecycle: "active", dueRuleNormalized: "monthly_day_5", frequencyRaw: "monthly" }], [], "2026-10-07",
    { startDate: "2026-09-01" }, () => ["2026-09-05"]).get("o1")!.deadline as any;
  check("UI state honors a recorded cycle (09-05 settled → 10-05 overdue 2d)", st.dueDate === "2026-10-05" && st.window === "overdue" && st.recurring.settlementsKnown);
  const stUnknown = obligationStates([{ id: "o1", dueDate: "", lifecycle: "active", dueRuleNormalized: "monthly_day_5", frequencyRaw: "monthly" }], [], "2026-10-07",
    { startDate: "2026-09-01" }, () => null).get("o1")!.deadline as any;
  check("UI state flags unknown completion records", stUnknown.recurring.settlementsKnown === false);
  const ind = liveIndicatorsFromRows([{ id: "c", startDate: "2026-09-01" }],
    [{ id: "o1", contract_id: "c", due_date_normalized: null, due_rule_normalized: "monthly_day_5", frequency: "monthly" }],
    { today: "2026-10-07", endOfMonth: "2026-10-31" }, () => null).get("c")!;
  check("KPIs: unknown completion records → overdue/due counts unavailable, never a number", ind.obligationsOverdue.state === "unavailable" && ind.obligationsDueThisMonth.state === "unavailable" && ind.obligationsTotal.state === "value");

  // ---- settlements reader ----
  const okRows = [
    { id: "s1", obligation_id: "o1", cycle_due_date: "2026-09-05", completed_on: "2026-09-04", note: "n", evidence_item_id: null, evidence_version_id: null, recorded_by: "u1", recorded_at: "t", status: "active", voided_by: null, voided_at: null, void_reason: null },
    { id: "s2", obligation_id: "o1", cycle_due_date: "2026-10-05", completed_on: null, note: "wrong", evidence_item_id: null, evidence_version_id: null, recorded_by: "u1", recorded_at: "t", status: "voided", voided_by: "u1", voided_at: "t", void_reason: "mistake" },
  ];
  const ok = fakeClient({ data: okRows, error: null });
  const r = await readCycleSettlements(ok.client, "org-a", ["o1"]);
  check("reader scoped to the organization and obligations", ok.calls.some((c) => c.op === "eq" && JSON.stringify(c.args) === JSON.stringify(["organization_id", "org-a"])) && ok.calls.some((c) => c.op === "in" && JSON.stringify(c.args) === JSON.stringify(["obligation_id", ["o1"]])));
  check("voided records stay in history but do not settle the cycle", r.ok && r.byObligation.get("o1")!.length === 2 && JSON.stringify(settledCyclesOf(r, "o1")) === JSON.stringify(["2026-09-05"]));
  check("read error → { ok: false } (never 'no settlements')", (await readCycleSettlements(fakeClient({ data: null, error: { message: "relation does not exist" } }).client, "o", ["o1"])).ok === false);
  check("thrown read → { ok: false }", (await readCycleSettlements(fakeClient("throw").client, "o", ["o1"])).ok === false);
  check("truncated read → { ok: false }", (await readCycleSettlements(fakeClient({ data: Array.from({ length: 2001 }, () => okRows[0]), error: null }).client, "o", ["o1"])).ok === false);
  const none = fakeClient({ data: [], error: null });
  check("no recurring obligations → no query", (await readCycleSettlements(none.client, "o", [])).ok && none.calls.length === 0);

  // ---- permission model ----
  check("settle_cycle: owner/admin only (member, contributor, finance denied)",
    roleHasCapability("owner", "obligation.settle_cycle") && roleHasCapability("admin", "obligation.settle_cycle") &&
    !roleHasCapability("member", "obligation.settle_cycle") && !roleHasCapability("contributor", "obligation.settle_cycle") && !roleHasCapability("finance", "obligation.settle_cycle"));

  // ---- scheduled sweep adapter ----
  const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", U = "33333333-3333-4333-8333-333333333333";
  check("config: valid list parsed", JSON.stringify(parseScheduledTargets(JSON.stringify([{ organizationId: A, actorUserId: U }]))) === JSON.stringify([{ organizationId: A, actorUserId: U }]));
  check("config: missing / malformed / non-uuid / duplicate org → null (no guessing)",
    parseScheduledTargets(undefined) === null && parseScheduledTargets("not json") === null && parseScheduledTargets("[]") === null &&
    parseScheduledTargets(JSON.stringify([{ organizationId: "x", actorUserId: U }])) === null &&
    parseScheduledTargets(JSON.stringify([{ organizationId: A, actorUserId: U }, { organizationId: A, actorUserId: U }])) === null);
  check("secret comparison", timingSafeEqual("Bearer abc", "Bearer abc") && !timingSafeEqual("Bearer abd", "Bearer abc") && !timingSafeEqual("", "Bearer abc"));
  const outcome = (status: string) => ({ ok: status !== "failed", sweepRunId: "r", contractsTotal: 1, contractsDone: 1, created: 0, updated: 0, resolved: 0, failures: [], status }) as any;
  const deps = (map: Record<string, string | "nonmember" | "throw">) => ({
    buildContext: async (t: any) => (map[t.organizationId] === "nonmember" ? null : ({ organizationId: t.organizationId } as any)),
    run: async (ctx: any) => { const v = map[ctx.organizationId]; if (v === "throw") throw new Error("x"); return outcome(v); },
  });
  const mixed = await sweepTargets([{ organizationId: A, actorUserId: U }, { organizationId: B, actorUserId: U }], deps({ [A]: "completed", [B]: "failed" }));
  check("one organization failing does not become success for the run; the other is still reported", !mixed.ok && mixed.results[0].status === "completed" && mixed.results[1].status === "failed");
  const nm = await sweepTargets([{ organizationId: A, actorUserId: U }], deps({ [A]: "nonmember" }));
  check("configured actor not a member → not_authorized (no fallback to another member)", !nm.ok && nm.results[0].status === "not_authorized");
  const th = await sweepTargets([{ organizationId: A, actorUserId: U }, { organizationId: B, actorUserId: U }], deps({ [A]: "throw", [B]: "completed" }));
  check("an exception in one organization is contained and reported as failed", !th.ok && th.results[0].status === "failed" && th.results[1].status === "completed");
  const sk = await sweepTargets([{ organizationId: A, actorUserId: U }], deps({ [A]: "skipped" }));
  check("a run skipped because another sweep is running is reported, not hidden", sk.results[0].status === "skipped");

  // ---- cron route auth (no network) ----
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://stub.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "stub";
  const { GET } = await import("../../src/app/api/officer/sweep/scheduled/route");
  const call = async (auth?: string) => (await GET(new Request("http://x/api/officer/sweep/scheduled", { headers: auth ? { authorization: auth } : {} }))).status;
  delete process.env.CRON_SECRET;
  check("cron: no CRON_SECRET → disabled (404)", (await call("Bearer x")) === 404);
  process.env.CRON_SECRET = "s3cret-test";
  check("cron: missing or wrong secret → 401", (await call()) === 401 && (await call("Bearer nope")) === 401 && (await call("s3cret-test")) === 401);
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  check("cron: right secret but no service key → 503", (await call("Bearer s3cret-test")) === 503);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-not-real";
  delete process.env.VAZORA_SCHEDULED_SWEEPS;
  check("cron: no scheduled-organization configuration → 503 (never 'all organizations')", (await call("Bearer s3cret-test")) === 503);
  if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ---- sweep concurrency path (fake client) ----
  const sweepCalls: { op: string; args: unknown[] }[] = [];
  const fb: Record<string, unknown> = {};
  let lastOp = "";
  for (const op of ["from", "select", "eq", "lt", "update", "insert", "single"]) {
    fb[op] = (...args: unknown[]) => { sweepCalls.push({ op, args }); if (op === "insert" || op === "update") lastOp = op; return fb; };
  }
  fb.then = (ok: (r: unknown) => unknown) => Promise.resolve(lastOp === "insert" ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: [], error: null }).then(ok);
  const ctx = { supabase: fb, organizationId: "org-a", userId: "u", clock: { today: "2026-10-05", timeZone: "Asia/Riyadh" } } as any;
  const out = await runContractSweep({ ctx, trigger: "scheduled" });
  check("concurrent start (unique violation 23505) → 'skipped', nothing published", out.status === "skipped" && out.sweepRunId === null && out.failures[0]?.error === "sweep_already_running");
  check("a start first closes runs whose lease expired (status running, started_at older than the lease)",
    sweepCalls.some((c) => c.op === "lt" && c.args[0] === "started_at") && sweepCalls.some((c) => c.op === "update" && (c.args[0] as any)?.failures?.[0]?.error === "sweep_run_abandoned"));
  const sweepSrc = src("src/lib/officer/sweep.ts");
  check("publication is conditional on still holding the run (reclaimed runs cannot publish)", (sweepSrc.match(/\.eq\("status", "running"\)/g) ?? []).length >= 3 && sweepSrc.includes("sweep_run_superseded"));

  // ---- migration structure ----
  const mig = src("supabase/migrations/0015_cycle_settlements_and_sweep_lock.sql");
  check("migration: RLS on, member read only, no insert/update/delete policy", mig.includes("enable row level security") && mig.includes("for select using (is_org_member") && !/create policy[^;]*for (insert|update|delete)/i.test(mig));
  check("migration: one active settlement per cycle (partial unique index)", /unique index obligation_cycle_settlements_one_active[\s\S]*where status = 'active'/.test(mig));
  check("migration: writes via security-definer functions with pinned search_path, owner/admin check, audit in same transaction",
    (mig.match(/security definer\s+set search_path = public/g) ?? []).length === 2 && (mig.match(/is_org_owner_or_admin/g) ?? []).length === 2 && (mig.match(/insert into activity_log/g) ?? []).length === 2);
  check("migration: actor and time from session/database (auth.uid(), now()), not parameters", mig.includes("v_uid uuid := auth.uid ()") && !/p_recorded_by|p_actor/.test(mig));
  check("migration: corrections void with a reason; nothing is deleted", mig.includes("void_reason") && !/delete from obligation_cycle_settlements/i.test(mig));
  check("migration: functions not executable by anon/public", mig.includes("from public, anon"));
  check("migration: one running sweep per organization (partial unique index)", /unique index officer_sweep_runs_one_running[\s\S]*where status = 'running'/.test(mig));
  check("migration: settlement never touches due dates, verification or gaps", !/update contract_obligations|evidence_gaps set|evidence_verification/i.test(mig.replace(/--.*$/gm, "")));

  // ---- review decisions wiring ----
  const ra = src("src/app/[locale]/app/contracts/[id]/review-actions.ts");
  check("review: 'unchanged' keeps the extracted value and provenance", ra.includes('String(formData.get("external_dependency_decision") ?? "unchanged")') && ra.includes("fieldProv"));
  check("review: payment 'not determined' stays null (never false)", ra.includes('payDecision === "linked" ? true : payDecision === "not_linked" ? false : null'));
  check("review: ai_payload (original model output) is not written", !/ai_payload\s*:/.test(ra));
  check("review: before/after and decisions in the audit record", ra.includes("before: { external_dependency: origExt") && ra.includes("decisions:"));
  check("Officer tools expose provenance; sweep marks inferred dependencies as unconfirmed",
    src("src/lib/officer/tools.ts").includes("external_dependency_provenance") && sweepSrc.includes("externalDependencyInferred") && src("src/lib/officer/detectors.ts").includes("inferred by extraction, not confirmed by a reviewer"));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
