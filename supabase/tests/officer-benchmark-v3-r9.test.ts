/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 9 — paired tests (offline, no model, no network).
//
// Sole scope: the ASSIGNEE extraction false positives demonstrated by the
// saved r8 targeted diagnostic (reports/2026-09-29T17-27-46-518Z-r8-diagnostic.json):
//   Q01 "needs an approved owner assignment." → captured "assignment."
//   R01 "بلا مسؤول معيّن"                     → captured "معيّن"
// r9 = strip trailing sentence punctuation/markdown before judging a capture,
// and treat role/process nouns + descriptive adjectives as non-names.
// Frozen r8 modules = revisions/r8/*; the live tree is the r9 evaluator.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-r9.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r8ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r8/fact-ledger";
import * as r8scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r8/scoring";
import * as r8gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r8/ground-truth";
import { scoreAnswer as scoreR8 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r8/evaluate";
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
const report = JSON.parse(readFileSync(join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports", "2026-09-29T17-27-46-518Z-r8-diagnostic.json"), "utf8"));

// Single diagnostic run — its persisted tenant identity reconstructs the fixture.
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
const saved = (id: string) => run.results.find((s: any) => s.id === id);

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
/** DB invariants/citation rejections observed in the saved run are carried. */
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
function runScenario(id: string, o: Opts = {}, rev: "r8" | "r9" = "r9") {
  const s = saved(id);
  const t = s.turns[0];
  const turn = {
    ...t, text: o.text ?? t.text, trace: o.trace ?? t.trace,
    toolInvocations: o.tools ?? t.toolInvocations,
    citations: (o.citations ?? t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })),
  };
  const mods = rev === "r8" ? { ledger: r8ledger, scoring: r8scoring, gt: r8gt } : { ledger, scoring, gt };
  const exp = restrict(mods.gt.EXPECTATIONS.find((e: any) => e.id === id));
  const score = rev === "r8" ? (scoreR8 as typeof scoreAnswer) : scoreAnswer;
  return score({
    mods, exp, fx, question: t.question, turns: [turn, ...s.turns.slice(1)] as any, r4: true,
    env: { entityMap: mods.ledger.buildEntityMap(fx), entityToIds, families },
    live: { ...carriedLive(s), displayedValidCount: turn.citations.length },
  });
}
const failures = (r: any) => [...r.productFailures, ...r.securityFailures];
const has = (r: any, re: RegExp) => failures(r).some((f: string) => re.test(f));

const q01 = saved("Q01").turns[0].text as string;
const r01 = saved("R01").turns[0].text as string;
const EPSILON_OBL = "4371ea73"; // EPSILON-500's obligation — fixture-verified unassigned

// =============================================================================
// REPRO — the frozen r8 evaluator still produces the demonstrated defect.
// =============================================================================
{
  const r = runScenario("Q01", {}, "r8");
  check("r8 repro: Q01 saved answer fails on assignee_name 'assignment'", has(r, /assignee_name.*assignment/i), failures(r).join(" | "));
}
{
  const r = runScenario("R01", {}, "r8");
  check("r8 repro: R01 saved answer fails on assignee_name 'معيّن'", has(r, /assignee_name.*معيّن/), failures(r).join(" | "));
}

// =============================================================================
// FIXED — the identical saved answers pass under r9.
// =============================================================================
{
  const r = runScenario("Q01");
  check("r9 fixed: Q01 saved answer passes", r.correctnessPass === true, failures(r).join(" | "));
  check("r9 fixed: Q01 has no unsupported claims", Number(r.metrics?.unsupportedClaims ?? -1) === 0);
}
{
  const r = runScenario("R01");
  check("r9 fixed: R01 saved answer passes", r.correctnessPass === true, failures(r).join(" | "));
  check("r9 fixed: R01 has no unsupported claims", Number(r.metrics?.unsupportedClaims ?? -1) === 0);
}

// =============================================================================
// PASS-side equivalents — descriptive role/process wording emits no claim.
// =============================================================================
{
  const text = q01.replace("needs an approved owner assignment.",
    "needs an approved owner assignment; the owner assignment process is still pending approval.");
  const r = runScenario("Q01", { text });
  check("r9 pass: 'approved owner assignment' + 'pending approval' — no assignee claim", !has(r, /assignee_name/i), failures(r).join(" | "));
}
{
  const text = q01.replace("needs an approved owner assignment.",
    "has no owner assigned; no owner is assigned today.");
  const r = runScenario("Q01", { text });
  check("r9 pass: 'no owner is assigned' — no assignee claim", !has(r, /assignee_name/i), failures(r).join(" | "));
}
{
  const text = q01.replace("needs an approved owner assignment.",
    "needs an owner assignment. The owner role is required; owner review is pending.");
  const r = runScenario("Q01", { text });
  check("r9 pass: 'owner assignment.'/'owner role'/'owner review' — no assignee claim", !has(r, /assignee_name/i), failures(r).join(" | "));
}
{
  const text = r01.replace("بلا مسؤول معيّن", "بلا مسؤول معيّن؛ لا يوجد مسؤول معين ولا مسؤول مكلف");
  const r = runScenario("R01", { text });
  check("r9 pass: معيّن/معين/مكلف descriptive forms — no assignee claim", !has(r, /assignee_name/i), failures(r).join(" | "));
}

// =============================================================================
// GUARD — real/person names still extract, bind, and fail when unsupported.
// =============================================================================
{
  // Fabricated named owner on the fixture-verified UNASSIGNED obligation —
  // name asserted AFTER the obligation title, mirroring the real failure's
  // binding shape (nearest preceding entity wins).
  const text = q01.replace("needs an approved owner assignment.", "is assigned to Ahmed Al-Khaldi.");
  const r = runScenario("Q01", { text });
  check("r9 guard: fabricated 'Ahmed Al-Khaldi' on unassigned obligation still fails",
    has(r, new RegExp(`assignee_name.*ahmed.*@obligation:${EPSILON_OBL}`)), failures(r).join(" | "));
}
{
  // Same in Arabic.
  const text = r01.replace("بلا مسؤول معيّن", "المسؤول: أحمد الخالدي");
  const r = runScenario("R01", { text });
  check("r9 guard: fabricated 'أحمد الخالدي' still fails", has(r, /assignee_name.*أحمد/i), failures(r).join(" | "));
}
{
  // Trailing punctuation on a real name: stripping must not neuter extraction.
  const text = q01.replace("needs an approved owner assignment.", "has owner: Faisal.");
  const r = runScenario("Q01", { text });
  check("r9 guard: 'owner: Faisal.' still extracts 'faisal' and fails unsupported",
    has(r, new RegExp(`assignee_name.*faisal.*@obligation:${EPSILON_OBL}`)), failures(r).join(" | "));
}
{
  // Entity binding: the same fabricated name asserted inside GAMMA's item
  // binds the GAMMA requirement entity — not flattened onto EPSILON — and
  // still fails unsupported.
  const text = q01.replace("depends on **Client PMO**.", "has owner: Nadia.");
  const r = runScenario("Q01", { text });
  check("r9 guard: wrong owner 'Nadia' binds the GAMMA entity, still fails",
    has(r, /assignee_name.*nadia.*@(obligation|requirement):/), failures(r).join(" | "));
}
{
  // A team/role-style assignee claim still extracts (single-word captures are
  // not blanked by the role-noun stop list).
  const text = q01.replace("needs an approved owner assignment.", "is assigned to Platform.");
  const r = runScenario("Q01", { text });
  check("r9 guard: unsupported 'Platform' assignee claim still fails",
    has(r, new RegExp(`assignee_name.*platform.*@obligation:${EPSILON_OBL}`)), failures(r).join(" | "));
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
