/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 10 — paired tests (offline, no model, no network).
//
// Sole scope: the extraction false positives demonstrated live by the r9
// diagnostic (reports/2026-09-29T23-46-45-182Z-r9-diagnostic.json):
//   Q01 heading "EPSILON-500 — owner missing:" produced
//     assignee_name "missing"            (a state word, not a person)
//     verification_state "missing"       (an ownership clause, not evidence)
// r10 = (a) state/descriptive words are not names, with a colon-recovery arm
//         for "owner missing: Faisal"; (b) bare "missing"/"مفقود" is a
//         verification_state claim only inside an evidence-object segment and
//         never after an ownership subject.
// Frozen r9 modules = revisions/r9/*; the live tree is the r10 evaluator.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-r10.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r9ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r9/fact-ledger";
import * as r9scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r9/scoring";
import * as r9gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r9/ground-truth";
import { scoreAnswer as scoreR9 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r9/evaluate";
import * as ledger from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import * as scoring from "../benchmarks/contract-officer-benchmark-v3/scoring";
import * as gt from "../benchmarks/contract-officer-benchmark-v3/ground-truth";
import { scoreAnswer } from "../benchmarks/contract-officer-benchmark-v3/evaluate";
import { buildCitationFamilies, buildEntityCitations } from "./officer-benchmark-v3-env";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports", "2026-09-29T23-46-45-182Z-r9-diagnostic.json"), "utf8"));

const run = report.runs[0];
const gapRows = run.results.flatMap((s: any) => (s.turns ?? []).flatMap((t: any) => (t.trace ?? [])
  .filter((x: any) => x.tool === "getEvidenceGaps" && x.ok)
  .flatMap((x: any) => { try { return JSON.parse(x.payload).data ?? []; } catch { return []; } })));
const fx = { ...run.fixtureIdentity, gapRows };
const end = report.ranAt
  ? new Date(report.ranAt).toLocaleDateString("en-CA", { timeZone: fx.timezone ?? "UTC" })
  : null;
const ref = fx.today && end === fx.today ? fx.today : null;
const entityToIds = buildEntityCitations(fx);
const families = buildCitationFamilies(fx);
const entities = ledger.buildEntityMap(fx);
const saved = (id: string) => run.results.find((s: any) => s.id === id);

// ---------- direct extraction checks ------------------------------------------
const claimsOf = (text: string) => ledger.extractClaims(text, entities);
const kindCount = (text: string, type: string) => claimsOf(text).filter((c) => c.type === type).length;
const assigneeValues = (text: string) =>
  claimsOf(text).filter((c) => c.type === "assignee_name").map((c) => c.value);

// =============================================================================
// ASSIGNEE — state/descriptive words emit no person-name claim.
// =============================================================================
for (const [name, text] of [
  ["owner missing", "EPSILON-500 — owner missing"],
  ["assignee missing", "the assignee missing today"],
  ["owner unassigned", "owner unassigned on EPSILON-500"],
  ["owner vacant", "owner vacant since award"],
  ["no owner assigned", "no owner assigned to the obligation"],
  ["responsible person missing", "a responsible person missing from the record"],
  ["owner assignment pending", "owner assignment pending approval"],
  ["مسؤول مفقود", "EPSILON-500 — مسؤول مفقود"],
  ["المسؤول شاغر", "المسؤول شاغر حاليا"],
  ["مسؤول غائب", "مسؤول غائب"],
] as const) {
  check(`r10 assignee: "${name}" emits no name`, assigneeValues(text).length === 0,
    JSON.stringify(assigneeValues(text)));
}

// =============================================================================
// ASSIGNEE — real names still extract (and unsupported ones still fail later).
// =============================================================================
check(`r10 assignee: 'owner: Faisal' → faisal`, assigneeValues("owner: Faisal").includes("faisal"),
  JSON.stringify(assigneeValues("owner: Faisal")));
check(`r10 assignee: 'assigned to Ahmed Al-Khaldi' → ahmed`, assigneeValues("assigned to Ahmed Al-Khaldi").includes("ahmed"));
check(`r10 assignee: 'المسؤول: أحمد الخالدي' → أحمد الخالدي`, assigneeValues("المسؤول: أحمد الخالدي").includes("أحمد الخالدي"),
  JSON.stringify(assigneeValues("المسؤول: أحمد الخالدي")));
// r10 recovery arm — a state word before a colon-introduced name does not
// swallow the real assertion.
check(`r10 assignee: 'owner missing: Faisal' → faisal`, assigneeValues("owner missing: Faisal").includes("faisal"),
  JSON.stringify(assigneeValues("owner missing: Faisal")));
check(`r10 assignee: 'owner missing: **Faisal**' → faisal`, assigneeValues("owner missing: **Faisal**").includes("faisal"),
  JSON.stringify(assigneeValues("owner missing: **Faisal**")));
// but a colon-introduced QUOTED title is not a name.
check(`r10 assignee: 'owner missing: "Quarterly…"' → no claim`,
  assigneeValues(`owner missing: "Quarterly security compliance statement"`).length === 0,
  JSON.stringify(assigneeValues(`owner missing: "Quarterly security compliance statement"`)));

// =============================================================================
// VERIFY_STATE — bare "missing"/"مفقود" requires an evidence-object segment.
// =============================================================================
for (const [name, text] of [
  ["owner missing", "owner missing"],
  ["assignee missing", "the assignee missing"],
  ["responsible party missing", "responsible party missing"],
  ["owner is missing", "the owner is missing"],
  ["مسؤول مفقود", "مسؤول مفقود"],
  ["المالك مفقود", "المالك مفقود"],
] as const) {
  check(`r10 verify_state: "${name}" emits no evidence-state claim`,
    kindCount(text, "verification_state") === 0, JSON.stringify(claimsOf(text).map((c) => `${c.type}:${c.value}`)));
}
for (const [name, text] of [
  ["evidence missing", "the required evidence is missing"],
  ["document missing", "required document is missing"],
  ["verification evidence missing", "verification evidence is missing"],
  ["acknowledgement evidence missing", "acknowledgement evidence missing"],
  ["the missing report", "the missing report was never received"],
  ["الدليل مفقود", "الدليل مفقود"],
  ["التقرير مفقود", "التقرير مفقود من السجل"],
] as const) {
  check(`r10 verify_state: "${name}" still extracts`, kindCount(text, "verification_state") === 1,
    JSON.stringify(claimsOf(text).map((c) => `${c.type}:${c.value}`)));
}
// Combined sentences — local context must not leak across clauses.
{
  const cl = claimsOf("Owner missing; required evidence is also missing.");
  check("r10 combined A→B: ownership clause emits no assignee claim", cl.filter((c) => c.type === "assignee_name").length === 0,
    JSON.stringify(cl.map((c) => `${c.type}:${c.value}`)));
  check("r10 combined A→B: ownership 'missing' emits no evidence claim",
    cl.filter((c) => c.type === "verification_state").length === 1 &&
    cl.some((c) => c.type === "verification_state" && c.value === "missing"),
    JSON.stringify(cl.map((c) => `${c.type}:${c.value}`)));
}
{
  const cl = claimsOf("Required evidence is missing; owner missing.");
  check("r10 combined B→A: evidence claim kept, owner 'missing' suppressed",
    cl.filter((c) => c.type === "verification_state").length === 1 &&
    cl.filter((c) => c.type === "assignee_name").length === 0,
    JSON.stringify(cl.map((c) => `${c.type}:${c.value}`)));
}
{
  // Same segment, evidence word present, but 'missing' still follows an
  // ownership subject → ownership wins.
  const cl = claimsOf("the evidence owner is missing");
  check("r10: 'the evidence owner is missing' — ownership subject suppresses claim",
    kindCount("the evidence owner is missing", "verification_state") === 0,
    JSON.stringify(cl.map((c) => `${c.type}:${c.value}`)));
}

// =============================================================================
// End-to-end on the saved r9 Q01 answer.
// =============================================================================
const hasUndefined = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x === undefined ? "__UNDEF__" : x)).includes("__UNDEF__") || /:undefined\b/.test(JSON.stringify(v));
function restrict(exp: any) {
  const out = { ...exp };
  for (const key of ["expectedArgs", "expectedCitations", "expectedFacts", "forbiddenFacts"] as const) {
    if (!exp[key]) continue;
    const kept = (exp[key](fx) as any[]).filter((x) => !hasUndefined(x));
    out[key] = () => kept;
  }
  return out;
}
function carriedLive(s: any) {
  const displayedInvalid = s.securityFailures.filter((f: string) => f.startsWith("invalid citation surfaced") || f.startsWith("unauthorized disclosure"));
  const dbFails = s.securityFailures.filter((f: string) => f.startsWith("db invariant")).map((f: string) => {
    const m = f.match(/^db invariant (\S+): (.*)$/); return { name: m?.[1] ?? "?", pass: false, detail: m?.[2] ?? "" };
  });
  const passed = Number(s.metrics.dbChecksPassed ?? 0);
  const blocked = Array.isArray(s.turns?.[0]?.rejectedCitations)
    ? s.turns[0].rejectedCitations.map((b: any) => ({ id: b.id, target: b.target, reason: b.reason }))
    : Math.max(0, Number(s.metrics.citationsRejected ?? 0) - displayedInvalid.length);
  return {
    displayedInvalid, displayedValidCount: Number(s.metrics.citationsValid ?? 0), blocked,
    dbInvariants: [...dbFails, ...Array.from({ length: passed }, () => ({ name: "carried", pass: true, detail: "" }))],
    orgId: fx.orgId, referenceDate: ref,
  };
}
type Opts = { text?: string; trace?: any[]; citations?: any[]; tools?: any[] };
function runScenario(id: string, o: Opts = {}, rev: "r9" | "r10" = "r10") {
  const s = saved(id);
  const t = s.turns[0];
  const turn = {
    ...t, text: o.text ?? t.text, trace: o.trace ?? t.trace,
    toolInvocations: o.tools ?? t.toolInvocations,
    citations: (o.citations ?? t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })),
  };
  const mods = rev === "r9" ? { ledger: r9ledger, scoring: r9scoring, gt: r9gt } : { ledger, scoring, gt };
  const exp = restrict(mods.gt.EXPECTATIONS.find((e: any) => e.id === id));
  const score = rev === "r9" ? (scoreR9 as typeof scoreAnswer) : scoreAnswer;
  return score({
    mods, exp, fx, question: t.question, turns: [turn, ...s.turns.slice(1)] as any, r4: true,
    env: { entityMap: mods.ledger.buildEntityMap(fx), entityToIds, families },
    live: { ...carriedLive(s), displayedValidCount: turn.citations.length },
  });
}
const failures = (r: any) => [...r.productFailures, ...r.securityFailures];
const has = (r: any, re: RegExp) => failures(r).some((f: string) => re.test(f));

const q01 = saved("Q01").turns[0].text as string;
const EPSILON_OBL = "4371ea73";

// REPRO — frozen r9 still produces both demonstrated defects.
{
  const r = runScenario("Q01", {}, "r9");
  check("r9 repro: Q01 saved answer fails on assignee_name 'missing'", has(r, /assignee_name.*missing/i), failures(r).join(" | "));
  check("r9 repro: Q01 saved answer fails on verification_state 'missing'", has(r, /verification_state.*missing/i), failures(r).join(" | "));
}
// FIXED — the identical saved answer passes under r10.
{
  const r = runScenario("Q01");
  check("r10 fixed: Q01 saved answer passes", r.correctnessPass === true, failures(r).join(" | "));
  check("r10 fixed: Q01 has no unsupported claims", Number(r.metrics?.unsupportedClaims ?? -1) === 0);
}
// GUARD e2e — a real fabricated name still extracts, binds, fails.
{
  const text = q01.replace("owner missing:**", "owner: Ahmed Al-Khaldi:**");
  const r = runScenario("Q01", { text });
  check("r10 guard: fabricated 'Ahmed' owner still fails bound to EPSILON",
    has(r, new RegExp(`assignee_name.*ahmed.*@(?:obligation:${EPSILON_OBL}|contract:EPSILON)`)), failures(r).join(" | "));
}
// GUARD — unsupported 'missing' evidence claim still fails: the claim binds
// DELTA-400, whose "Signed asset register" evidence is operationally
// verified — a "missing" assertion there is false and must stay flagged.
{
  const text = q01.replace("the discrepancy is pending review.", "the discrepancy is pending review; the required evidence is missing.");
  const r = runScenario("Q01", { text });
  check("r10 guard: unsupported 'evidence is missing' on verified DELTA still extracted and fails",
    has(r, /verification_state.*missing/i), failures(r).join(" | "));
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
