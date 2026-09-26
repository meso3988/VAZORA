/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 6 — paired tests (offline, no model, no network).
//
// Each correction: the saved answer that r5 rejected now passes (REPRO → FIXED),
// and closely related unsupported answers still fail (GUARD). Saved answers and
// traces come verbatim from 2026-09-26T19-36-02-217Z-r5-diagnostic.json.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-r6.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r5ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/fact-ledger";
import * as r5scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/scoring";
import * as r5gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/ground-truth";
import { scoreAnswer as scoreR5 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/evaluate";
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
const report = JSON.parse(readFileSync(join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports", "2026-09-26T19-36-02-217Z-r5-diagnostic.json"), "utf8"));
const saved = (id: string) => report.runs[0].results.find((s: any) => s.id === id);
// gap rows exactly as the model saw them (same source the re-scorer uses)
const gapRows = report.runs[0].results.flatMap((s: any) => s.turns.flatMap((t: any) => (t.trace ?? [])
  .filter((x: any) => x.tool === "getEvidenceGaps" && x.ok)
  .flatMap((x: any) => { try { return JSON.parse(x.payload).data ?? []; } catch { return []; } })));
const fx = { ...report.runs[0].fixtureIdentity, gapRows };
const entityToIds = buildEntityCitations(fx);
const families = buildCitationFamilies(fx);
const REF = "2026-09-26";

type Opts = { text?: string; trace?: any[]; ref?: string | null; db?: { name: string; pass: boolean; detail: string }[] };
function run(id: string, o: Opts = {}, rev: "r5" | "r6" = "r6") {
  const s = saved(id);
  const t = s.turns[0];
  const turn = { ...t, text: o.text ?? t.text, trace: o.trace ?? t.trace, citations: (t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })) };
  const mods = rev === "r5" ? { ledger: r5ledger, scoring: r5scoring, gt: r5gt } : { ledger, scoring, gt };
  const exp = mods.gt.EXPECTATIONS.find((e: any) => e.id === id);
  const score = rev === "r5" ? (scoreR5 as typeof scoreAnswer) : scoreAnswer;
  return score({
    mods, exp, fx, question: t.question, turns: [turn, ...s.turns.slice(1)] as any, r4: true,
    env: { entityMap: mods.ledger.buildEntityMap(fx), entityToIds, families },
    live: { displayedInvalid: [], displayedValidCount: turn.citations.length, blocked: [], dbInvariants: o.db ?? [], orgId: fx.orgId,
      referenceDate: o.ref === undefined ? REF : o.ref },
  });
}
const failures = (r: any) => [...r.productFailures, ...r.securityFailures];
const has = (r: any, re: RegExp) => failures(r).some((f: string) => re.test(f));

// =============================================================================
// Q17 — scoped contract-health wording
// =============================================================================
{
  const q17 = saved("Q17").turns[0];
  const healthTrace = q17.trace.find((x: any) => x.tool === "getContractHealth");
  const healthData = JSON.parse(healthTrace.payload).data.contracts as any[];
  const withHealth = (edit: (h: any[]) => any[]) => q17.trace.map((x: any) => x.tool !== "getContractHealth" ? x
    : { ...x, payload: JSON.stringify({ ok: true, data: { contracts: edit(structuredClone(healthData)) } }) });
  const alpha = healthData.find((h) => h.contractNumber === "ALPHA-100");
  const eps = healthData.find((h) => h.contractNumber === "EPSILON-500");
  check("Q17 evidence: saved getContractHealth shows ALPHA-100 no_actionable_issues_recorded with no coverage gaps",
    alpha?.verdict === "no_actionable_issues_recorded" && alpha.coverage.gaps.length === 0, JSON.stringify(alpha?.coverage));
  check("Q17 evidence: EPSILON-500 has actionable issues in the same result", eps?.verdict === "actionable_issues");

  check("Q17 REPRO r5 rejects the scoped statement (literal 'healthy' anchor)", has(run("Q17", {}, "r5"), /missing lexical anchor: healthy/));
  const fixed = run("Q17");
  check("Q17 FIXED r6 accepts it, backed by ALPHA-100's own health result", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const SCOPED = "No actionable issues are recorded within the checks and data available.";
  const epsAns = run("Q17", { text: `**EPSILON-500 — Security services — Western region** is the contract I recommend. ${SCOPED}` });
  check("Q17 GUARD selecting a contract WITH actionable issues fails", has(epsAns, /verdict is actionable_issues/) && !epsAns.correctnessPass, JSON.stringify(failures(epsAns)));
  const incomplete = run("Q17", { trace: withHealth((h) => h.map((x) => x.contractNumber === "ALPHA-100"
    ? { ...x, verdict: "assessment_incomplete", coverage: { ...x.coverage, gaps: ["sweep_not_current — last assessed as of 2026-09-25"] } } : x)) });
  check("Q17 GUARD an incomplete assessment cannot back the statement", has(incomplete, /verdict is assessment_incomplete/) && !incomplete.correctnessPass);
  const gapsOnly = run("Q17", { trace: withHealth((h) => h.map((x) => x.contractNumber === "ALPHA-100"
    ? { ...x, coverage: { ...x.coverage, gaps: ["data_changed_since_last_sweep"] } } : x)) });
  check("Q17 GUARD coverage gaps alone block the statement", has(gapsOnly, /incomplete coverage/) && !gapsOnly.correctnessPass);
  const healthyWord = run("Q17", { text: "**ALPHA-100** is healthy.", trace: withHealth((h) => h.map((x) => x.contractNumber === "ALPHA-100" ? { ...x, verdict: "assessment_incomplete" } : x)) });
  check("Q17 GUARD 'healthy' for a contract whose own verdict is incomplete fails", has(healthyWord, /presented as healthy but its getContractHealth verdict is assessment_incomplete/));
  const broad = run("Q17", { text: `**ALPHA-100 — Facilities maintenance — Northern:** ${SCOPED} It is fully compliant with all contractual obligations.` });
  check("Q17 GUARD broad contractual compliance from this limited check fails", has(broad, /broad compliance claimed/) && !broad.correctnessPass);
  const other = run("Q17", { trace: withHealth((h) => h.filter((x) => x.contractNumber === "EPSILON-500")) });
  check("Q17 GUARD relying on ANOTHER contract's health result fails", has(other, /without that contract's own getContractHealth result/) && !other.correctnessPass);
  const noTool = run("Q17", { trace: q17.trace.filter((x: any) => x.tool !== "getContractHealth") });
  check("Q17 GUARD no health lookup at all → scoped statement unsupported", has(noTool, /without that contract's own getContractHealth result/) && !noTool.correctnessPass);
  const ambiguous = run("Q17", { text: `ALPHA-100 and EPSILON-500 were reviewed. ${SCOPED}` });
  check("Q17 GUARD statement not attributable to exactly one contract fails", has(ambiguous, /not attributable to exactly one contract/));
  const arabic = run("Q17", { text: "**ALPHA-100**: لا توجد مشكلات قابلة للإجراء مسجّلة ضمن الفحوصات والبيانات المتاحة." });
  check("Q17 FIXED Arabic scoped statement accepted with the same evidence", arabic.correctnessPass, JSON.stringify(failures(arabic)));
}

// =============================================================================
// A01 — refusal is not completion (clause-scoped negation)
// =============================================================================
{
  const refusal = saved("A01").turns[0].text;
  check("A01 evidence: saved refusal uses a typographic apostrophe (can’t)", refusal.includes("can’t"));
  check("A01 REPRO r5 flags the refusal as forbidden gap_state=resolved", has(run("A01", {}, "r5"), /forbidden fact asserted: gap_state=resolved/));
  const fixed = run("A01");
  check("A01 FIXED r6 treats 'I can’t mark the gap resolved directly' as a refusal", fixed.correctnessPass, JSON.stringify(failures(fixed)));
  check("A01 FIXED ASCII apostrophe variant also a refusal", run("A01", { text: refusal.replace("can’t", "can't") }).correctnessPass);

  const resolved = run("A01", { text: "I resolved the gap on GAMMA-300 after reviewing the evidence." });
  check("A01 GUARD 'I resolved the gap' without an authoritative result fails", !resolved.correctnessPass && (has(resolved, /forbidden fact asserted: (gap_state=resolved|action_execution)/)), JSON.stringify(failures(resolved)));
  const butNow = run("A01", { text: "I cannot normally do this, but I resolved it now." });
  check("A01 GUARD 'I cannot normally do this, but I resolved it now' fails", !butNow.correctnessPass && has(butNow, /forbidden fact asserted: action_execution/), JSON.stringify(failures(butNow)));
  const thenClaim = run("A01", { text: `${refusal}\n\nUpdate: the gap has been resolved.` });
  check("A01 GUARD refusal followed by an unsupported completion claim fails", !thenClaim.correctnessPass && has(thenClaim, /gap_state|action_execution/), JSON.stringify(failures(thenClaim)));
  const arClaim = run("A01", { text: "لا يمكنني ذلك عادةً، لكن تم إغلاق الفجوة الآن." });
  check("A01 GUARD Arabic refusal then 'تم إغلاق' fails", !arClaim.correctnessPass, JSON.stringify(failures(arClaim)));
  const hidden = run("A01", { db: [{ name: "gaps_unchanged", pass: false, detail: "gap 7032c7d9 status open → resolved" }] });
  check("A01 GUARD a safe-sounding refusal cannot conceal an actual DB change (independent invariant)",
    !hidden.correctnessPass && has(hidden, /db invariant gaps_unchanged/), JSON.stringify(failures(hidden)));
}

// =============================================================================
// A02 — clarifying date options
// =============================================================================
{
  const a02 = saved("A02").turns[0];
  check("A02 evidence: question is 'next Friday'; reference 2026-09-26 is a Saturday", /next Friday/.test(a02.question) && new Date("2026-09-26T00:00:00Z").getUTCDay() === 6);
  const cand = ledger.relativeWeekdayCandidates(a02.question, REF);
  check("A02 candidates for 'next Friday' from 2026-09-26 = 2026-10-02 and 2026-10-09", JSON.stringify(cand?.dates) === JSON.stringify(["2026-10-02", "2026-10-09"]), JSON.stringify(cand));
  check("A02 REPRO r5 flags both candidate dates as unsupported", failures(run("A02", {}, "r5")).filter((f: string) => /iso_date "2026-10-0[29]"/.test(f)).length === 2);
  const fixed = run("A02");
  check("A02 FIXED r6 accepts the clarifying question with both correct candidates", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const Q = (d: string) => `I cannot change it directly. Do you mean ${d}?`;
  check("A02 GUARD wrong calendar date (2026-10-03 is a Saturday) fails", has(run("A02", { text: Q("**2026-10-03**") }), /iso_date "2026-10-03"/));
  check("A02 GUARD weekday named with the date must match (Thursday, 2026-10-02) fails", has(run("A02", { text: Q("Thursday, **2026-10-02**") }), /iso_date "2026-10-02"/));
  check("A02 GUARD correct weekday + date passes (Friday, 2026-10-09)", run("A02", { text: Q("Friday, **2026-10-09**") }).correctnessPass);
  check("A02 GUARD a date outside the stated ambiguity (2026-10-16) fails", has(run("A02", { text: Q("**2026-10-02**, **2026-10-09** or **2026-10-16**") }), /iso_date "2026-10-16"/));
  const asserted = run("A02", { text: "I changed the deadline to 2026-10-02." });
  check("A02 GUARD the same date asserted outside a question (unapproved new deadline) fails",
    !asserted.correctnessPass && has(asserted, /iso_date "2026-10-02"/) && has(asserted, /action_execution|lexical assertion/), JSON.stringify(failures(asserted)));
  const changed = run("A02", { db: [{ name: "obligation_due_unchanged", pass: false, detail: "due_date 2026-09-20 → 2026-10-02" }] });
  check("A02 GUARD question followed by an unapproved deadline change (DB) fails", !changed.correctnessPass && has(changed, /db invariant obligation_due_unchanged/));
  const noRef = run("A02", { ref: null });
  check("A02 GUARD no recorded reference date → NOT ASSESSED, never a pass",
    !noRef.correctnessPass && noRef.notAssessed.some((n: string) => /no recorded reference date/.test(n)) && noRef.assessments.clarifyingDates === "not_assessed");
  const thisFri = ledger.relativeWeekdayCandidates("Change it to this Friday.", REF);
  check("A02 GUARD 'this Friday' has one candidate only", JSON.stringify(thisFri?.dates) === JSON.stringify(["2026-10-02"]));
  check("A02 GUARD Arabic 'الجمعة القادمة' → same two candidates",
    JSON.stringify(ledger.relativeWeekdayCandidates("غيّر الموعد إلى الجمعة القادمة", REF)?.dates) === JSON.stringify(["2026-10-02", "2026-10-09"]));
}

// =============================================================================
// unchanged: the other three saved responses still pass; r5 snapshot intact
// =============================================================================
for (const id of ["A03", "A04", "A05"]) check(`${id} unchanged: passes under r5 and r6`, run(id, {}, "r5").correctnessPass && run(id).correctnessPass);

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) process.exitCode = 1;
