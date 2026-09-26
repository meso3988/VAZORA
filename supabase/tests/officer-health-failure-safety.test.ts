/* eslint-disable @typescript-eslint/no-explicit-any */
// Contract-health failure safety — no paid model calls.
//
// Part 1 (pure, stub client): read failures in assessContractHealth.
// Part 2 (real DB + fault injection on the normal authenticated client): sweep
// persistence, scoped resolution, recovery, consumers (tool, brief, Officer).
//
// DEFECT (reproduced first): observation read fails → treated as [] →
// no_actionable_issues_recorded. This does NOT establish the cause of the
// earlier intermittent test run, which remains undetermined.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-health-failure-safety.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
process.env.VAZORA_OFFICER_PROVIDER = "qa-scripted-health-safety";

import {
  seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildTodayBrief } from "../../src/lib/officer/brief";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer } from "../../src/lib/officer/converse";
import { assessContractHealth, enforceHealthClaims, HealthUnavailableError, type ContractHealth } from "../../src/lib/officer/health";
import { readObservations } from "../../src/lib/officer/observations";
import { registerOfficerProvider, type ContractOfficerProvider, type OfficerCompletion } from "../../src/lib/officer/provider";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ============================================================================
// Part 1 — stub client
// ============================================================================
type Outcome = { data?: any; error?: any; throws?: boolean };
const T = "2026-09-26";
function stubCtx(over: Record<string, Outcome> = {}) {
  const base: Record<string, Outcome> = {
    contracts: { data: [
      { id: "c-alpha", contract_number: "ALPHA-100", title: "Facilities", status: "active", created_at: "2026-09-20T00:00:00Z" },
      { id: "c-eps", contract_number: "EPSILON-500", title: "Security", status: "active", created_at: "2026-09-20T00:00:00Z" },
    ] },
    officer_sweep_runs: { data: [
      { started_at: "2026-09-26T08:00:00Z", completed_at: "2026-09-26T08:01:00Z", as_of_date: T, status: "completed", failures: [] },
    ] },
    contract_obligations: { data: [
      { id: "o-a", contract_id: "c-alpha", review_status: "approved", activation_status: "active", updated_at: "2026-09-25T00:00:00Z" },
      { id: "o-e", contract_id: "c-eps", review_status: "approved", activation_status: "active", updated_at: "2026-09-25T00:00:00Z" },
    ] },
    evidence_gaps: { data: [] }, evidence_verification_discrepancies: { data: [] }, obligation_evidence_requirements: { data: [] },
    officer_observations: { data: [{ id: "ob1", contract_id: "c-eps", kind: "unassigned_obligation", severity: "high", title: "No owner assigned: EPSILON-500", detail: null, status: "active", citations: [], priority_reason: [] }] },
  };
  const tables = { ...base, ...over };
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "limit", "gte", "is", "maybeSingle"]) b[m] = () => b;
    b.then = (res: any, rej: any) => {
      const o = tables[table] ?? { data: [] };
      if (o.throws) return rej(new TypeError("fetch failed"));
      return res({ data: o.error ? null : o.data, error: o.error ?? null });
    };
    return b;
  };
  return { organizationId: "org", userId: "u", role: "owner", locale: "en", officer: { enabled: true }, clock: { today: T }, supabase: { from: builder } } as any;
}
const by = (hs: ContractHealth[], n: string) => hs.find((h) => h.contractNumber === n)!;
const dbError = { message: "permission denied for relation officer_observations", code: "42501" };

async function part1() {
  // A/B baseline
  const ok = await assessContractHealth(stubCtx());
  check("A (stub) complete assessment, no issues → ALPHA-100 no_actionable_issues_recorded, complete",
    by(ok, "ALPHA-100").verdict === "no_actionable_issues_recorded" && by(ok, "ALPHA-100").coverage.complete);
  check("B (stub) existing issue → EPSILON-500 actionable_issues", by(ok, "EPSILON-500").verdict === "actionable_issues");

  // C: THE DEFECT — observation read returns an error
  const c = await assessContractHealth(stubCtx({ officer_observations: { error: dbError } }));
  check("C DEFECT REPRO: observation read ERROR → assessment_incomplete (was: no_actionable_issues_recorded)",
    by(c, "ALPHA-100").verdict === "assessment_incomplete" && by(c, "EPSILON-500").verdict === "assessment_incomplete",
    c.map((h) => `${h.contractNumber}:${h.verdict}`).join(","));
  check("C gap names the failed read with a safe code, no raw database text",
    by(c, "ALPHA-100").coverage.gaps.some((g) => g.startsWith("read_failed:officer_observations")) &&
    !JSON.stringify(c).includes("permission denied"));
  const c2 = await assessContractHealth(stubCtx({ officer_observations: { throws: true } }));
  check("C observation read THROWS (network) → assessment_incomplete", c2.every((h) => h.verdict === "assessment_incomplete"));
  const trunc = await assessContractHealth(stubCtx({ officer_observations: { data: Array.from({ length: 1000 }, (_, i) => ({ id: `x${i}`, contract_id: "c-x", kind: "k", status: "active", citations: [], priority_reason: [] })) } }));
  check("E truncated observation read (limit reached) → incomplete, never a clean result",
    trunc.every((h) => h.verdict !== "no_actionable_issues_recorded") && by(trunc, "ALPHA-100").coverage.gaps.some((g) => g.includes("officer_observations_truncated")));

  // D: other required reads
  for (const [table, o] of [
    ["contract_obligations", { error: dbError }], ["evidence_gaps", { throws: true }],
    ["officer_sweep_runs", { error: dbError }], ["evidence_verification_discrepancies", { throws: true }],
    ["obligation_evidence_requirements", { error: dbError }],
  ] as [string, Outcome][]) {
    const d = await assessContractHealth(stubCtx({ [table]: o }));
    check(`D ${table} ${o.throws ? "throws" : "errors"} → ALPHA-100 not healthy (assessment_incomplete)`,
      by(d, "ALPHA-100").verdict === "assessment_incomplete" && !by(d, "ALPHA-100").coverage.complete, by(d, "ALPHA-100").coverage.gaps.join(" | "));
    check(`D ${table} failure → EPSILON-500 known issue still visible, with incomplete coverage`,
      by(d, "EPSILON-500").verdict === "actionable_issues" && by(d, "EPSILON-500").issues.length === 1 && !by(d, "EPSILON-500").coverage.complete);
  }
  let unavailable = false;
  try { await assessContractHealth(stubCtx({ contracts: { error: dbError } })); } catch (e) { unavailable = e instanceof HealthUnavailableError; }
  check("D contract list unreadable → HealthUnavailableError (no empty 'nothing to report')", unavailable);
  const tool = await runOfficerTool(stubCtx({ contracts: { throws: true } }), "getContractHealth", {});
  check("D getContractHealth tool → safe error code, no raw message",
    !tool.ok && tool.error === "health_assessment_unavailable: contracts_read_failed", JSON.stringify(tool));

  // E: partial sweep — known findings visible, coverage incomplete, history separate
  const partial = await assessContractHealth(stubCtx({ officer_sweep_runs: { data: [
    { started_at: "2026-09-26T09:00:00Z", as_of_date: T, status: "partial", failures: [{ contract_id: "c-eps", error: "read_failed:contract_obligations" }] },
    { started_at: "2026-09-26T08:00:00Z", as_of_date: T, status: "completed", failures: [] },
  ] } }));
  const e = by(partial, "EPSILON-500");
  check("E partial sweep: EPSILON-500 known issue visible + incomplete coverage", e.verdict === "actionable_issues" && !e.coverage.complete && e.coverage.gaps.includes("sweep_failed_for_contract"));
  check("E last successful assessment kept as HISTORY (earlier run), not as fresh", e.coverage.lastSuccessfulAssessmentAt === "2026-09-26T08:00:00Z" && e.coverage.lastSweepAt === "2026-09-26T09:00:00Z");
  check("H (stub) other contract in the same partial sweep stays scoped and complete", by(partial, "ALPHA-100").coverage.complete && by(partial, "ALPHA-100").verdict === "no_actionable_issues_recorded");
  const failedAttempt = await assessContractHealth(stubCtx({ officer_sweep_runs: { data: [
    { started_at: "2026-09-26T09:00:00Z", as_of_date: T, status: "failed", failures: [] },
    { started_at: "2026-09-26T08:00:00Z", as_of_date: T, status: "completed", failures: [] },
  ] } }));
  check("latest sweep ATTEMPT failed → no contract gets a clean result", failedAttempt.every((h) => h.verdict !== "no_actionable_issues_recorded"));

  // J (pure guard)
  const g = enforceHealthClaims("ALPHA-100 is healthy and fully checked.", c, "en");
  check("J guard: incomplete assessment cannot be called healthy/fully checked",
    /ALPHA-100 cannot be described as healthy: its assessment is incomplete/.test(g.text) && /I could not complete the current assessment/.test(g.text), g.text);
  const gNull = enforceHealthClaims("Everything looks fine — all checks passed.", null, "en");
  check("J guard: assessment unreadable → reassurance replaced", /I could not complete the current assessment/.test(gNull.text) && gNull.corrected.length === 1, gNull.text);
  const gAr = enforceHealthClaims("العقد ALPHA-100 سليم.", c, "ar");
  check("J guard (Arabic): incomplete → لم أتمكن من إكمال التقييم الحالي", /لم أتمكن من إكمال التقييم الحالي/.test(gAr.text), gAr.text);
  const gIssues = enforceHealthClaims("EPSILON-500 is healthy.", partial, "en");
  check("J guard: known issues + incomplete coverage disclosed together", /1 actionable issue is recorded/.test(gIssues.text) && /Coverage is incomplete/.test(gIssues.text), gIssues.text);
}

// ============================================================================
// Part 2 — real DB with fault injection
// ============================================================================
type Call = { m: string; args: any[] };
type Rule = (table: string, calls: Call[]) => "error" | "throw" | null;
function faulty(client: any, rule: Rule): any {
  const wrap = (b: any, table: string, calls: Call[]): any => new Proxy(b, {
    get(target, p) {
      if (p === "then") {
        const r = rule(table, calls);
        if (r === "error") return (res: any) => res({ data: null, error: { message: "injected failure", code: "XX000" }, count: null });
        if (r === "throw") return (_res: any, rej: any) => rej(new TypeError("fetch failed (injected)"));
        return target.then.bind(target);
      }
      const v = target[p];
      if (typeof v !== "function") return v;
      return (...args: any[]) => {
        const out = v.apply(target, args);
        return out && typeof out === "object" && typeof out.then === "function" ? wrap(out, table, [...calls, { m: String(p), args }]) : out;
      };
    },
  });
  return new Proxy(client, { get: (t, p) => (p === "from" ? (table: string) => wrap(t.from(table), table, []) : Reflect.get(t, p)) });
}
const has = (calls: Call[], m: string, pred: (args: any[]) => boolean = () => true) => calls.some((c) => c.m === m && pred(c.args));

let script: OfficerCompletion[] = [];
const scripted: ContractOfficerProvider = {
  id: "qa-scripted-health-safety", model: "qa-scripted", supportsTools: true,
  async complete() { return script.shift() ?? { ok: true, text: "", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }; },
};
registerOfficerProvider("qa-scripted-health-safety", () => scripted);
const say = (text: string): OfficerCompletion => ({ ok: true, text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } });

async function part2() {
  const fx = await seedBenchmarkOrganization({ label: "hsafe" });
  try {
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const ctx = (await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" }))!;
    const withRule = (rule: Rule) => ({ ...ctx, supabase: faulty(fx.client, rule) });
    const beta = fx.contracts.b.contractId, eps = fx.contracts.e.contractId;
    const obs = async () => ((await fx.client.from("officer_observations").select("id, dedupe_key, status, contract_id, kind")
      .eq("organization_id", fx.orgId)).data ?? []) as any[];
    const active = (rows: any[]) => rows.filter((r) => r.status === "active" || r.status === "acknowledged");
    const health = async (c: any = ctx) => assessContractHealth(c);

    // F: observation INSERTS fail for BETA-200 on the very first sweep
    const s1 = await runContractSweep({ ctx: withRule((t, calls) =>
      t === "officer_observations" && has(calls, "insert", (a) => a[0]?.contract_id === beta) ? "error" : null), trigger: "manual" });
    check("F observation write failure → sweep NOT published as completed", s1.status === "partial", s1.status);
    check("F failure recorded for BETA-200 with a safe code", s1.failures.some((f) => f.contract_id === beta && f.error === "observation_write_failed"), JSON.stringify(s1.failures));
    const h1 = await health();
    check("F BETA-200 (no observations saved) is NOT a clean bill of health", by(h1, "BETA-200").verdict === "assessment_incomplete", `${by(h1, "BETA-200").verdict} ${by(h1, "BETA-200").coverage.gaps.join("|")}`);
    check("F BETA-200 freshness not advanced: no successful assessment recorded for it", by(h1, "BETA-200").coverage.lastSuccessfulAssessmentAt === null);
    check("H ALPHA-100 in the same sweep remains scoped: complete, no actionable issues", by(h1, "ALPHA-100").verdict === "no_actionable_issues_recorded" && by(h1, "ALPHA-100").coverage.complete);
    check("H EPSILON-500 in the same sweep: actionable, complete", by(h1, "EPSILON-500").verdict === "actionable_issues" && by(h1, "EPSILON-500").coverage.complete);
    const b1 = await buildTodayBrief(ctx);
    check("F brief after a partial sweep: not quiet, assessment incomplete", !b1.quiet && !b1.assessment.complete && b1.assessment.reasons.includes("latest_sweep_partial"), JSON.stringify(b1.assessment));

    // I: recovery
    const s2 = await runContractSweep({ ctx, trigger: "manual" });
    const h2 = await health();
    const dupes = () => obs().then((rows) => {
      const keys = active(rows).map((r) => r.dedupe_key);
      return keys.length - new Set(keys).size;
    });
    check("I recovery sweep completed", s2.status === "completed", JSON.stringify(s2.failures));
    check("I BETA-200 now actionable with complete coverage", by(h2, "BETA-200").verdict === "actionable_issues" && by(h2, "BETA-200").coverage.complete);
    check("I no duplicate active observations", (await dupes()) === 0);
    const lastGood = by(h2, "EPSILON-500").coverage.lastSuccessfulAssessmentAt;

    // G: replacement scan for EPSILON-500 fails (obligation read) — its issue must stay active
    const epsActiveBefore = active(await obs()).filter((r) => r.contract_id === eps).length;
    const s3 = await runContractSweep({ ctx: withRule((t, calls) =>
      t === "contract_obligations" && has(calls, "eq", (a) => a[0] === "contract_id" && a[1] === eps) ? "throw" : null), trigger: "manual" });
    const epsActiveAfter = active(await obs()).filter((r) => r.contract_id === eps).length;
    // A thrown (network) read error is recorded with the generic safe code
    // scan_failed; a returned database error carries the table code.
    check("G failed replacement scan → sweep partial with EPSILON-500 failure", s3.status === "partial" &&
      s3.failures.some((f) => f.contract_id === eps && /^(read_failed:contract_obligations|scan_failed)$/.test(f.error)), JSON.stringify(s3.failures));
    check("G EPSILON-500's previous observations NOT silently resolved", epsActiveBefore > 0 && epsActiveAfter === epsActiveBefore, `${epsActiveBefore} → ${epsActiveAfter}`);
    const h3 = await health();
    check("G EPSILON-500: known issue visible, coverage incomplete", by(h3, "EPSILON-500").verdict === "actionable_issues" && !by(h3, "EPSILON-500").coverage.complete);
    check("G EPSILON-500 last successful assessment = the earlier good run (history, not fresh)",
      by(h3, "EPSILON-500").coverage.lastSuccessfulAssessmentAt === lastGood && lastGood !== by(h3, "EPSILON-500").coverage.lastSweepAt);
    check("H ALPHA-100 unaffected by EPSILON-500's failure", by(h3, "ALPHA-100").verdict === "no_actionable_issues_recorded");

    // G2: contract list unreadable during the sweep — nothing may be resolved
    const activeBefore = active(await obs()).length;
    const s4 = await runContractSweep({ ctx: withRule((t, calls) => t === "contracts" && has(calls, "select") ? "error" : null), trigger: "manual" });
    check("G2 contract list read failure → sweep failed", s4.status === "failed" && s4.failures.some((f) => f.error === "read_failed:contracts"));
    check("G2 no observation resolved by the failed sweep", active(await obs()).length === activeBefore, `${activeBefore} → ${active(await obs()).length}`);
    const h4 = await health();
    check("G2 after a failed latest attempt, no contract is presented clean", h4.every((h) => h.verdict !== "no_actionable_issues_recorded"), h4.map((h) => `${h.contractNumber}:${h.verdict}`).join(","));

    // G3: current observation set unreadable during reconcile — abort, no writes
    const s5 = await runContractSweep({ ctx: withRule((t, calls) =>
      t === "officer_observations" && has(calls, "select", (a) => String(a[0]).includes("dedupe_key")) ? "error" : null), trigger: "manual" });
    check("G3 observation set unreadable → sweep failed, nothing resolved", s5.status === "failed" && active(await obs()).length === activeBefore);

    // F2: the final publication write fails — run is not published
    const s6 = await runContractSweep({ ctx: withRule((t, calls) =>
      t === "officer_sweep_runs" && has(calls, "update", (a) => typeof a[0]?.status === "string") ? "error" : null), trigger: "manual" });
    const { data: lastRun } = await fx.client.from("officer_sweep_runs").select("status").eq("organization_id", fx.orgId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    check("F2 publication write failure → outcome failed, stored run not published", s6.status === "failed" && lastRun?.status === "running", `${s6.status} / ${lastRun?.status}`);
    check("F2 health does not treat the unpublished run as fresh", (await health()).every((h) => h.verdict !== "no_actionable_issues_recorded"));

    // C/D live + consumers
    const cLive = await health(withRule((t, calls) => t === "officer_observations" && has(calls, "select") ? "error" : null));
    check("C (live) observation read error → no contract clean", cLive.every((h) => h.verdict === "assessment_incomplete"));
    const obsRead = await readObservations(withRule((t) => t === "officer_observations" ? "throw" : null));
    check("C (live) readObservations reports failure explicitly (not [])", !obsRead.ok);
    const bLive = await buildTodayBrief(withRule((t, calls) => t === "officer_observations" && has(calls, "select") ? "error" : null));
    check("Brief with observation read failure: not quiet, incomplete, no false calm", !bLive.quiet && !bLive.assessment.complete && bLive.assessment.reasons.includes("observations_read_failed"));

    // I2: full recovery
    const s7 = await runContractSweep({ ctx, trigger: "manual" });
    const h7 = await health();
    check("I2 clean sweep after failures → completed; ALPHA-100 clean and complete again",
      s7.status === "completed" && by(h7, "ALPHA-100").verdict === "no_actionable_issues_recorded" && by(h7, "ALPHA-100").coverage.complete);
    check("I2 still no duplicate active observations", (await dupes()) === 0);

    // J: scripted Officer tries to reassure while the assessment is incomplete
    script = [say("ALPHA-100 is healthy and fully checked.")];
    const j = await converseWithOfficer({ ctx: withRule((t, calls) => t === "officer_observations" && has(calls, "select") ? "error" : null), question: "Is ALPHA-100 healthy?" });
    check("J scripted Officer: 'healthy and fully checked' replaced by the incomplete statement",
      j.ok && !/is healthy and fully checked/.test(j.answer.text) && /I could not complete the current assessment/.test(j.answer.text), j.ok ? j.answer.text : j.error);
    script = [say("All contracts are healthy.")];
    const j2 = await converseWithOfficer({ ctx: withRule((t, calls) => t === "contracts" && has(calls, "select") ? "throw" : null), question: "Are my contracts healthy?" });
    check("J scripted Officer with the assessment unreadable → no reassurance",
      j2.ok && !/All contracts are healthy/.test(j2.answer.text) && /I could not complete the current assessment/.test(j2.answer.text), j2.ok ? j2.answer.text : j2.error);
  } finally {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} org=${fx.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
  }
}

async function main() {
  await part1();
  await part2();
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nHEALTH FAILURE SAFETY: ${checks.length - failed.length}/${checks.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
