/* eslint-disable @typescript-eslint/no-explicit-any */
// Contract health (gate Q17 defect) — pure logic, then real DB after a real
// sweep, then the conversation path with a SCRIPTED provider replaying the
// saved Q17 answers. No paid calls.
//
// Gate Q17 runs 1 and 3 called EPSILON-500 "healthy" although its obligation
// is unassigned and the sweep had a high-priority observation for it.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-contract-health.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
process.env.VAZORA_OFFICER_PROVIDER = "qa-scripted-health";

import {
  seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer } from "../../src/lib/officer/converse";
import {
  assessContractHealth, coverageGaps, enforceHealthClaims, healthVerdict, SCOPED_NO_ISSUES_EN,
  type ContractHealth, type CoverageFacts,
} from "../../src/lib/officer/health";
import { registerOfficerProvider, type ContractOfficerProvider, type OfficerCompletion } from "../../src/lib/officer/provider";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- pure: coverage + verdict -----------------------------------------------------
const base: CoverageFacts = {
  today: "2026-09-26", contractStatus: "active", contractCreatedAt: "2026-09-20T00:00:00Z", operationalObligations: 1,
  lastSweep: { startedAt: "2026-09-26T08:00:00Z", asOfDate: "2026-09-26", status: "completed", failedContractIds: [] },
  latestChangeAt: "2026-09-25T10:00:00Z",
};
check("pure: current full coverage + no issues → no_actionable_issues_recorded", healthVerdict(0, coverageGaps(base, "c1")) === "no_actionable_issues_recorded");
check("pure: any open issue → actionable_issues", healthVerdict(1, coverageGaps(base, "c1")) === "actionable_issues");
for (const [label, f] of [
  ["never swept", { ...base, lastSweep: null }],
  ["sweep from yesterday", { ...base, lastSweep: { ...base.lastSweep!, asOfDate: "2026-09-25" } }],
  ["contract failed in sweep", { ...base, lastSweep: { ...base.lastSweep!, failedContractIds: ["c1"] } }],
  ["contract added after sweep", { ...base, contractCreatedAt: "2026-09-26T09:00:00Z" }],
  ["data changed after sweep", { ...base, latestChangeAt: "2026-09-26T09:00:00Z" }],
  ["no operational obligations", { ...base, operationalObligations: 0 }],
  ["contract not active", { ...base, contractStatus: "draft" }],
] as [string, CoverageFacts][]) {
  check(`pure: ${label} → assessment_incomplete (silence is not health)`, healthVerdict(0, coverageGaps(f, "c1")) === "assessment_incomplete");
}

const H = (n: string, verdict: ContractHealth["verdict"], issues: string[] = [], gaps: string[] = []): ContractHealth => ({
  contractId: n, contractNumber: n, title: n, verdict,
  issues: issues.map((t) => ({ kind: "k", severity: "high", title: t, detail: null, status: "active" })),
  coverage: { lastSweepAt: null, asOfDate: null, gaps }, scopedStatement: verdict === "no_actionable_issues_recorded" ? SCOPED_NO_ISSUES_EN : null,
});
const Q17_R3 = "## Healthy contract: EPSILON-500\n\n**Security services — Western region** is currently a healthy example:\n\n- **Status:** Active, through 2027-07-23.\n- **Evidence:** The required “Security compliance statement” is operationally **verified**.\n- **Exceptions:** No open evidence gaps and no pending verification discrepancies are recorded.\n\n**Assessment:** Healthy—nothing is overdue, evidence is verified, and no immediate exception requires attention.";
const health = [H("EPSILON-500", "actionable_issues", ["No owner assigned: EPSILON-500 — Quarterly security compliance statement"]), H("ALPHA-100", "no_actionable_issues_recorded")];
const g = enforceHealthClaims(Q17_R3, health, "en");
check("[GATE Q17 r3] 'Healthy contract: EPSILON-500' is corrected", !/Healthy contract: EPSILON-500/.test(g.text) && g.corrected.length >= 2, JSON.stringify(g.corrected));
check("[GATE Q17 r3] the unqualified 'Assessment: Healthy…' line is removed", !/Assessment:\*\* Healthy/.test(g.text));
check("[GATE Q17 r3] replacement states the recorded issue", /EPSILON-500 cannot be described as healthy: 1 actionable issue is recorded — No owner assigned/.test(g.text));
check("pure: facts that are true are kept (evidence verified line)", g.text.includes("operationally **verified**"));
check("pure: a no-issues contract keeps its scoped statement",
  enforceHealthClaims(`ALPHA-100: ${SCOPED_NO_ISSUES_EN}`, health, "en").corrected.length === 0);
check("pure: 'EPSILON-500 is not healthy' is not a health claim",
  enforceHealthClaims("EPSILON-500 is not healthy: its obligation has no owner.", health, "en").corrected.length === 0);
check("pure: incomplete assessment → corrected with the coverage reason",
  /assessment is incomplete \(sweep_not_current\)/.test(enforceHealthClaims("GAMMA-900 is healthy.", [H("GAMMA-900", "assessment_incomplete", [], ["sweep_not_current — …"])], "en").text));
check("pure: Arabic health claim corrected",
  /لا يمكن وصف EPSILON-500 بأنه سليم/.test(enforceHealthClaims("العقد EPSILON-500 سليم.", health, "ar").text));

// ---- DB + scripted ---------------------------------------------------------------------
let script: OfficerCompletion[] = [];
const scripted: ContractOfficerProvider = {
  id: "qa-scripted-health", model: "qa-scripted", supportsTools: true,
  async complete() { return script.shift() ?? { ok: true, text: "", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }; },
};
registerOfficerProvider("qa-scripted-health", () => scripted);
const tool = (name: string, args: unknown): OfficerCompletion =>
  ({ ok: true, text: "", toolCalls: [{ id: `c${Math.random()}`, name, arguments: args }], usage: { inputTokens: 1, outputTokens: 1 } });
const say = (text: string): OfficerCompletion => ({ ok: true, text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } });

async function main() {
  const fx = await seedBenchmarkOrganization({ label: "health" });
  try {
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const ctxAt = (now?: Date) => buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en", ...(now ? { now } : {}) }).then((c) => c!);
    const ctx = await ctxAt();
    const before = await assessContractHealth(ctx);
    check("before any sweep: every contract is assessment_incomplete (never assessed ≠ healthy)",
      before.length === 6 && before.every((h) => h.verdict === "assessment_incomplete"), before.map((h) => `${h.contractNumber}:${h.verdict}`).join(","));

    const sweep = await runContractSweep({ ctx, trigger: "manual" });
    check("sweep completed", sweep.status === "completed", sweep.status);
    const hs = await assessContractHealth(ctx);
    const by = (n: string) => hs.find((h) => h.contractNumber === n)!;
    console.log(`  health after sweep: ${hs.map((h) => `${h.contractNumber}:${h.verdict}:${h.issues.length}`).join(" ")}`);
    check("healthy assessed contract (ALPHA-100) → no_actionable_issues_recorded with scoped statement",
      by("ALPHA-100").verdict === "no_actionable_issues_recorded" && by("ALPHA-100").scopedStatement === SCOPED_NO_ISSUES_EN, JSON.stringify(by("ALPHA-100").coverage));
    check("unassigned obligation (EPSILON-500) → actionable_issues",
      by("EPSILON-500").verdict === "actionable_issues" && by("EPSILON-500").issues.some((i) => i.kind === "unassigned_obligation"),
      by("EPSILON-500").issues.map((i) => i.kind).join(","));
    check("overdue + missing mandatory evidence (BETA-200) → actionable_issues",
      by("BETA-200").verdict === "actionable_issues" && ["overdue", "missing_required_evidence"].every((k) => by("BETA-200").issues.some((i) => i.kind === k)),
      by("BETA-200").issues.map((i) => i.kind).join(","));
    const delta = by("DELTA-400");
    const disc = delta.issues.find((i) => i.kind === "verification_discrepancy");
    check("pending discrepancy (DELTA-400) → actionable (review required)", delta.verdict === "actionable_issues" && !!disc);
    check("…effective status preserved and disclosed (remains verified until a reviewer decides)", /remains verified until a reviewer decides/.test(disc?.detail ?? ""), disc?.detail ?? "");

    const viaTool = await runOfficerTool(ctx, "getContractHealth", {});
    check("getContractHealth tool returns the same verdicts",
      viaTool.ok && (viaTool.data as any).contracts.find((h: any) => h.contractNumber === "EPSILON-500").verdict === "actionable_issues");

    // incomplete: a stale assessment (tomorrow's clock) and a contract added after the sweep
    const tomorrow = await ctxAt(new Date(Date.now() + 36 * 3600 * 1000));
    const stale = (await assessContractHealth(tomorrow)).find((h) => h.contractNumber === "ALPHA-100")!;
    check("stale sweep (clock moved a day) → ALPHA-100 assessment_incomplete", stale.verdict === "assessment_incomplete" && stale.coverage.gaps.some((x) => x.startsWith("sweep_not_current")), stale.coverage.gaps.join(" | "));
    const newId = crypto.randomUUID();
    const { error: cErr } = await fx.client.from("contracts").insert({
      id: newId, organization_id: fx.orgId, contract_number: "THETA-800", title: "New after sweep", client_name: "Benchmark Client Authority", status: "active",
    });
    check("contract added after the sweep (authorized QA write)", !cErr, cErr?.message ?? "");
    const theta = (await assessContractHealth(ctx)).find((h) => h.contractNumber === "THETA-800");
    check("…is assessment_incomplete (added after sweep, nothing assessed)",
      theta?.verdict === "assessment_incomplete" && theta.coverage.gaps.some((x) => x.startsWith("contract_added_after_last_sweep")), theta?.coverage.gaps.join(" | "));
    const { error: obErr } = await fx.client.from("contract_obligations").update({ title: "Monthly maintenance summary (revised)" }).eq("id", fx.contracts.a.obligationId);
    const changed = (await assessContractHealth(ctx)).find((h) => h.contractNumber === "ALPHA-100")!;
    check("ALPHA-100 obligation changed after the sweep → assessment_incomplete", !obErr && changed.verdict === "assessment_incomplete", changed.coverage.gaps.join(" | "));
    await runContractSweep({ ctx, trigger: "manual" });

    // scripted conversation: the saved Q17 r3 answer, no health lookup
    script = [say(Q17_R3)];
    const r1 = await converseWithOfficer({ ctx, question: "Show me a healthy contract." });
    const a1 = r1.ok ? r1.answer : null;
    check("[GATE Q17 r3 replay] EPSILON-500 not presented as healthy", !!a1 && !/Healthy contract: EPSILON-500/.test(a1.text) && /EPSILON-500 cannot be described as healthy/.test(a1.text), a1?.text.slice(0, 200));
    check("[GATE Q17 r3 replay] corrected sentences recorded", (a1?.removedClaims.length ?? 0) >= 2);

    // scripted conversation: the intended behaviour
    script = [tool("getContractHealth", {}), say(`**ALPHA-100 — Facilities maintenance — Northern:** ${SCOPED_NO_ISSUES_EN}`)];
    const r2 = await converseWithOfficer({ ctx, question: "Show me a healthy contract." });
    const a2 = r2.ok ? r2.answer : null;
    check("scoped recommendation of the assessed contract passes through unchanged",
      !!a2 && a2.removedClaims.length === 0 && a2.text.includes(`ALPHA-100 — Facilities maintenance — Northern:** ${SCOPED_NO_ISSUES_EN}`), a2?.text);
    check("health question exposes getContractHealth", a2?.toolInvocations.some((t) => t.tool === "getContractHealth" && t.ok) === true);

    script = [say("DELTA-400 is healthy: the signed asset register is verified.")];
    const r3 = await converseWithOfficer({ ctx, question: "Is DELTA-400 healthy?" });
    check("pending-discrepancy contract claimed healthy → corrected, review requirement disclosed",
      r3.ok && /DELTA-400 cannot be described as healthy/.test(r3.answer.text) && /discrepancy/i.test(r3.answer.text), r3.ok ? r3.answer.text : "");
  } finally {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} org=${fx.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nCONTRACT HEALTH: ${checks.length - failed.length}/${checks.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
