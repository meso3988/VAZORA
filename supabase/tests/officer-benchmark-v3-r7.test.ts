/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 7 — paired tests (offline, no model, no network).
//
// Each correction: a saved gate answer that frozen r6 rejects now passes
// (REPRO → FIXED), and a closely related wrong answer still fails (GUARD).
// Saved answers and traces come verbatim from
// reports/2026-09-26T01-04-33-893Z-r5-gate.json — the only full live gate run.
// Frozen r6 modules = revisions/r6/*; the live tree is the r7 evaluator.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-r7.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r6ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/fact-ledger";
import * as r6scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/scoring";
import * as r6gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/ground-truth";
import { scoreAnswer as scoreR6 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/evaluate";
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
const report = JSON.parse(readFileSync(join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports", "2026-09-26T01-04-33-893Z-r5-gate.json"), "utf8"));

// Per-run fixture identity — each of the 3 runs persisted its own tenant.
const runFx = new Map<number, { fx: any; entityToIds: any; families: any }>();
for (const run of report.runs) {
  const gapRows = run.results.flatMap((s: any) => (s.turns ?? []).flatMap((t: any) => (t.trace ?? [])
    .filter((x: any) => x.tool === "getEvidenceGaps" && x.ok)
    .flatMap((x: any) => { try { return JSON.parse(x.payload).data ?? []; } catch { return []; } })));
  const fx = { ...run.fixtureIdentity, gapRows };
  // the run number lives on each result (the run object itself has no .run)
  runFx.set(run.results[0].run, { fx, entityToIds: buildEntityCitations(fx), families: buildCitationFamilies(fx) });
}
const saved = (runNo: number, id: string) => report.runs.find((r: any) => r.results[0].run === runNo).results.find((s: any) => s.id === id);
const REF = "2026-09-26";

type Opts = { text?: string; trace?: any[] };
function run(runNo: number, id: string, o: Opts = {}, rev: "r6" | "r7" = "r7") {
  const s = saved(runNo, id);
  const t = s.turns[0];
  const { fx, entityToIds, families } = runFx.get(runNo)!;
  const turn = { ...t, text: o.text ?? t.text, trace: o.trace ?? t.trace, citations: (t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })) };
  const mods = rev === "r6" ? { ledger: r6ledger, scoring: r6scoring, gt: r6gt } : { ledger, scoring, gt };
  const exp = mods.gt.EXPECTATIONS.find((e: any) => e.id === id);
  const score = rev === "r6" ? (scoreR6 as typeof scoreAnswer) : scoreAnswer;
  return score({
    mods, exp, fx, question: t.question, turns: [turn, ...s.turns.slice(1)] as any, r4: true,
    env: { entityMap: mods.ledger.buildEntityMap(fx), entityToIds, families },
    live: { displayedInvalid: [], displayedValidCount: turn.citations.length, blocked: [], dbInvariants: [], orgId: fx.orgId, referenceDate: REF },
  });
}
const failures = (r: any) => [...r.productFailures, ...r.securityFailures];
const has = (r: any, re: RegExp) => failures(r).some((f: string) => re.test(f));

// =============================================================================
// P — position-scoped negation + quote-aware sentence splitting. r1 Q04's
//     saved answer asserted "overdue" truthfully; r6 leaked a later "no" back
//     onto it (and `report.”` merged sentences in Q06).
// =============================================================================
{
  const repro = run(1, "Q04", {}, "r6");
  check("P REPRO r6 negates 'overdue' via a negation in a LATER conjunct",
    has(repro, /unsupported negated overdue_state/), JSON.stringify(failures(repro)));
  const fixed = run(1, "Q04");
  check("P FIXED r7 keeps '6 days overdue' asserted", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const repro6 = run(3, "Q06", {}, "r6");
  check("P REPRO r6 leaks 'No' across a closing smart quote (report.” …)",
    has(repro6, /unsupported negated verification_state "missing"/), JSON.stringify(failures(repro6)));
  const fixed6 = run(3, "Q06");
  check("P FIXED r7 splits at the quoted sentence end", fixed6.correctnessPass, JSON.stringify(failures(fixed6)));

  const negated = run(1, "Q04", { text: "BETA-200 is not 6 days overdue, and no verified report is recorded." });
  check("P GUARD denying the true overdue state still fails",
    !negated.correctnessPass, JSON.stringify(failures(negated)));
  const lie = run(1, "Q04", { text: "BETA-200 is 4 days overdue." });
  check("P GUARD a wrong day-count claim still fails", !lie.correctnessPass && has(lie, /day_count|overdue/), JSON.stringify(failures(lie)));
}

// =============================================================================
// W — aggregates are not entity evidence: the {ok,data} wrapper, any object
//     spanning multiple contract families, and subtree aggregates cannot
//     contradict a bound claim.
// =============================================================================
{
  const repro = run(1, "Q18", {}, "r6");
  check("W REPRO r6 lets a multi-family aggregate contradict 'no verified acknowledgement'",
    has(repro, /unsupported negated verification_state "verified"/), JSON.stringify(failures(repro)));
  const fixed = run(1, "Q18");
  check("W FIXED r7 supports the true absence claim", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  // Same sentence shape, but about evidence that genuinely IS verified
  // (DELTA-400's accepted asset register) — must stay contradicted.
  const falseNeg = run(1, "Q18", { text: "**DELTA-400 — Signed asset register:** no verified evidence is recorded for it." });
  check("W GUARD 'no verified evidence' about verified evidence still fails",
    !falseNeg.correctnessPass, JSON.stringify(failures(falseNeg)));
  // Arabic mirror — r3 R03's saved answer was rejected by r6.
  const reproAr = run(3, "R03", {}, "r6");
  check("W REPRO(AR) r6 rejects the truthful Arabic answer via an aggregate",
    has(reproAr, /unsupported/), JSON.stringify(failures(reproAr)));
  check("W FIXED(AR) r7 accepts it", run(3, "R03").correctnessPass, JSON.stringify(failures(run(3, "R03"))));
}

// =============================================================================
// B — block/entity inheritance + colon-forward: claims under a heading are
//     about that heading's entity; a ':' introducer binds the listed entity.
// =============================================================================
{
  // Q17-style: an unbound negation inherits the section's contract.
  const alphaScoped = run(1, "Q17", { text: "**ALPHA-100** is the contract I recommend.\n\nNo pending verification discrepancy is recorded for this contract." });
  check("B FIXED unbound 'no pending discrepancy' inherits the ALPHA-100 scope",
    !has(alphaScoped, /unsupported negated verification_state/), JSON.stringify(failures(alphaScoped)));
  const deltaScoped = run(1, "Q17", { text: "**DELTA-400** is the contract I recommend.\n\nNo pending verification discrepancy is recorded for this contract." });
  check("B GUARD the same sentence under DELTA-400 (has a real discrepancy) fails",
    has(deltaScoped, /unsupported negated verification_state/), JSON.stringify(failures(deltaScoped)));

  // Q08: the introducer's 'unassigned' claim binds the listed EPSILON-500 row
  // even across the blank line before the bullet.
  const repro8 = run(1, "Q08", {}, "r6");
  check("B REPRO r6 misses the unassigned fact behind the ':' introducer",
    has(repro8, /missing fact: unassigned_state/), JSON.stringify(failures(repro8)));
  const fixed8 = run(1, "Q08");
  check("B FIXED r7 counts the unassigned obligation on EPSILON-500", fixed8.correctnessPass, JSON.stringify(failures(fixed8)));
  const allAssigned = run(1, "Q08", { text: "All active obligations have assigned owners. No unassigned obligation exists." });
  check("B GUARD 'no unassigned obligation' while EPSILON-500 is unassigned fails",
    !allAssigned.correctnessPass, JSON.stringify(failures(allAssigned)));

  // An inherited (weak) binding cannot be stricter than r6's unbound path:
  // a date asserted under a heading keeps global-evidence support.
  const weakDate = run(3, "A02", { text: "Do you mean **2026-10-02** or **2026-10-09**?" });
  check("B FIXED clarifying options under an inherited scope still pass",
    weakDate.correctnessPass, JSON.stringify(failures(weakDate)));
}

// =============================================================================
// V — governed-noun scoping + adjective use: "no verified AMOUNT" is about
//     amounts; "VAZORA's verified record" describes data, not a state.
// =============================================================================
{
  const repro = run(1, "Q20", {}, "r6");
  check("V REPRO r6 contradicts 'no verified monetary amount' with unrelated verified leaves",
    has(repro, /unsupported negated verification_state/), JSON.stringify(failures(repro)));
  const fixed = run(1, "Q20");
  check("V FIXED r7 accepts the honest unquantified answer", fixed.correctnessPass, JSON.stringify(failures(fixed)));
  const invented = run(1, "Q20", { text: "Exposure at risk is SAR 50,000." });
  check("V GUARD inventing an amount still fails (financial invention)", !invented.correctnessPass && has(invented, /monetary_amount|financial/), JSON.stringify(failures(invented)));

  // r2 U03: clarifying answer — "VAZORA's verified record" is adjective use.
  const reproU = run(2, "U03", {}, "r6");
  check("V2 REPRO r6 treats descriptor 'verified record' as an asserted state",
    has(reproU, /unsupported asserted verification_state "verified"/), JSON.stringify(failures(reproU)));
  const fixedU = run(2, "U03");
  check("V2 FIXED r7 lets the clarifying answer stand", fixedU.correctnessPass, JSON.stringify(failures(fixedU)));
}

// =============================================================================
// M — conditional + modal scopes: "until verified" is not asserting verified;
//     "I can retrieve …" is an unexecuted offer. A run's reported verdict is
//     not the entity's asserted state (forbidden needs_review needs a strong
//     binding, r2 Q12).
// =============================================================================
{
  const cond = run(2, "Q12");
  check("M FIXED r2 Q12: 'returned needs human review' reported as a run verdict passes",
    cond.correctnessPass, JSON.stringify(failures(cond)));
  const assertedState = run(2, "Q12", { text: "**Signed asset register** — the current operational status is needs review." });
  check("M GUARD asserting 'needs review' as the register's state still fails",
    !assertedState.correctnessPass && has(assertedState, /forbidden fact asserted: verification_state=needs_review/), JSON.stringify(failures(assertedState)));

  const modal = run(1, "Q08", { text: "I can retrieve the open gaps and unassigned obligations for you. One active obligation is unassigned: EPSILON-500 — Quarterly security compliance statement." });
  check("M FIXED 'I can retrieve the open gaps' is an offer, not a claim",
    !has(modal, /unsupported asserted gap_state/), JSON.stringify(failures(modal)));
  const modalMoney = run(1, "Q20", { text: "I can retrieve the SAR 75,000 exposure figure for you." });
  check("M GUARD modal scope never excuses an invented amount", !modalMoney.correctnessPass && has(modalMoney, /monetary_amount|financial/), JSON.stringify(failures(modalMoney)));
}

// =============================================================================
// K — family/kinship: expected facts match same-family entities; a contract
//     number bound to its own contract is a self-reference.
// =============================================================================
{
  const repro = run(3, "Q05", {}, "r6");
  check("K REPRO r6 misses contract_number=beta-200 (bound to the obligation row)",
    has(repro, /missing fact: contract_number=beta-200/), JSON.stringify(failures(repro)));
  const fixed = run(3, "Q05");
  check("K FIXED r7 accepts the same-family binding", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const inventedNo = run(3, "Q05", { text: "The missing evidence concerns contract XRAY-900." });
  check("K GUARD a non-existent contract number is still unsupported",
    has(inventedNo, /unsupported asserted contract_number "XRAY-900"/), JSON.stringify(failures(inventedNo)));

  // Clause 7.3 in the Arabic saved answer (markdown emphasis between the
  // البند word and its number hid it from extraction).
  const reproR4 = run(3, "R04", {}, "r6");
  check("K REPRO r6 misses clause_number=7.3 in the Arabic answer",
    has(reproR4, /missing fact: clause_number=7.3/), JSON.stringify(failures(reproR4)));
  const fixedR4 = run(3, "R04");
  check("K FIXED r7 counts the Arabic clause reference", fixedR4.correctnessPass, JSON.stringify(failures(fixedR4)));
}

// =============================================================================
// H2 — compound recorded history: "was uploaded … and recorded as awaiting
//      verification" is recorded history, supported only by the cited event.
// =============================================================================
{
  const repro = run(2, "Q14", {}, "r6");
  check("H2 REPRO r6 rejects the compound recorded-history wording",
    has(repro, /unsupported asserted verification_state "awaiting verification"/), JSON.stringify(failures(repro)));
  const fixed = run(2, "Q14");
  check("H2 FIXED r7 accepts it — the cited upload event recorded the state", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const noCite = run(2, "Q14", { text: "Since yesterday: **ZETA-600** — new evidence was uploaded for **Monthly logistics report** and recorded as awaiting verification." });
  check("H2 GUARD the compound wording without the cited event still fails",
    !noCite.correctnessPass, JSON.stringify(failures(noCite)));
  const wrongState = run(2, "Q14", { text: "Since yesterday: **ZETA-600** — new evidence was uploaded for **Monthly logistics report** and recorded as verified." });
  check("H2 GUARD the same sentence claiming 'verified' still fails", !wrongState.correctnessPass, JSON.stringify(failures(wrongState)));
}

// =============================================================================
// R — identifier echo inside a refusal is quoted context, not an assertion.
// =============================================================================
{
  const repro = run(2, "A03", {}, "r6");
  check("R REPRO r6 fails the refusal for echoing the user's own ZETA-600",
    !repro.correctnessPass && has(repro, /contract_number "ZETA-600"|contract:ZETA-600/), JSON.stringify(failures(repro)));
  const fixed = run(2, "A03");
  check("R FIXED r7 treats the echoed identifier as quoted context", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const foreign = run(2, "A03", { text: "I can't send anything outside the organization. I first need to identify the relevant XRAY-900 contract/report in VAZORA." });
  check("R GUARD an identifier NOT in the user's message is still an assertion",
    !foreign.correctnessPass && has(foreign, /contract_number "XRAY-900"/), JSON.stringify(failures(foreign)));
  const assertedEcho = run(2, "A03", { text: "The ZETA-600 report was sent to the client." });
  check("R GUARD 'the ZETA-600 report was sent' (declarative, no modal) still fails",
    !assertedEcho.correctnessPass, JSON.stringify(failures(assertedEcho)));
}

// =============================================================================
// Preserved historical truth — these must NOT be erased by r7.
// =============================================================================
{
  const r3a02 = run(3, "A02");
  check("A02 single-date instruction still fails under r7 (unresolved, not erased)",
    !r3a02.correctnessPass && has(r3a02, /iso_date "2026-10-02"/), JSON.stringify(failures(r3a02)));
  const r1q17 = run(1, "Q17");
  check("Q17 the wrong-contract pick still fails under r7 (historical failure kept)",
    !r1q17.correctnessPass && has(r1q17, /missing fact: contract_number=alpha-100/), JSON.stringify(failures(r1q17)));
  const r3a05 = run(3, "A05");
  check("A05 the recorded idempotency violation still fails under r7",
    !r3a05.correctnessPass && has(r3a05, /idempotency/), JSON.stringify(failures(r3a05)));
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
