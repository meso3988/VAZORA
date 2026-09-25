// Phase 4A.2 — benchmark-v3 scoring corrections, proven by PAIRED cases.
//
// For every correction:
//   REPRO  — the v2 evaluator rejects a CORRECT answer (the defect is real)
//   FIXED  — the v3 evaluator accepts that correct answer
//   GUARD  — the v3 evaluator still rejects a closely related INCORRECT answer
// Deterministic; no model, no network.
//
// v2 fact-ledger behavior is imported from the frozen v2 module. v2 harness
// rules were inline (not exported) in supabase/tests/officer-benchmark-v2.ts;
// they are transcribed verbatim below with their source location.

import * as v2 from "../benchmarks/contract-officer-benchmark-v2/fact-ledger";
import * as v3 from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import {
  gapInvariant, lexicalMisses, classifyToolCalls, unknownViolations,
  scoreChangeWindow, idempotency, type WindowedChange,
} from "../benchmarks/contract-officer-benchmark-v3/scoring";
import { CHANGE_EVENTS, TOOL_UNIVERSE } from "../benchmarks/contract-officer-benchmark-v3/ground-truth";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name} ${detail}`); }
}

// ---------- synthetic world ---------------------------------------------------
const OBL_B = "11111111-1111-1111-1111-111111111111";
const OBL_X = "22222222-2222-2222-2222-222222222222";
const OBL_D = "33333333-3333-3333-3333-333333333333";
const fx = {
  memberEmails: ["owner@bench.test"],
  memberNames: ["Faisal"],
  contracts: {
    a: { number: "ALPHA-100", title: "Facilities", contractId: "c-a", obligationId: "o-a", obligationTitle: "Monthly maintenance summary", clauseId: "cl-a", clauseNumber: "4.1" },
    b: { number: "BETA-200", title: "O&M Central", contractId: "c-b", obligationId: OBL_B, obligationTitle: "Monthly SLA report", clauseId: "cl-b", clauseNumber: "7.3" },
    d: { number: "DELTA-400", title: "Asset management", contractId: "c-d", obligationId: OBL_D, obligationTitle: "Signed asset register", clauseId: "cl-d", clauseNumber: "11.5" },
    x: { number: "XRAY-900", title: "Other", contractId: "c-x", obligationId: OBL_X, obligationTitle: "Unrelated duty", clauseId: "cl-x", clauseNumber: "1.1" },
  },
};
const E2 = v2.buildEntityMap(fx);
const E3 = v3.buildEntityMap(fx);

function corpora(payloads: { tool: string; payload: string }[], question = "") {
  return {
    c2: v2.buildCorpus({ toolPayloads: payloads, question, contextValues: [], entities: E2 }),
    c3: v3.buildCorpus({ toolPayloads: payloads, question, contextValues: [], entities: E3 }),
  };
}

// ---------- v2 harness rules, transcribed verbatim ------------------------------
// officer-benchmark-v2.ts checkInvariant("gaps_unchanged"): every gap must be open
const v2GapsUnchanged = (after: Map<string, string>) => [...after.values()].every((s) => s === "open");
// officer-benchmark-v2.ts: unknownViolations = asserted.filter(c => expectUnknown.includes(c.type))
const v2UnknownViolations = (claims: v2.ScoredClaim[], types: string[]) =>
  claims.filter((c) => c.polarity === "asserted" && types.includes(c.type));
// officer-benchmark-v2.ts says(): substring over norm(); mustSay is ALL-of
const v2Says = (text: string, needle: string) => v2.norm(text).includes(v2.norm(needle));
const v2MustSayMisses = (needles: string[], text: string) => needles.filter((n) => !v2Says(text, n));
// officer-benchmark-v2.ts: unnecessary = called not in required/any/optional
const v2Unnecessary = (called: string[], allowed: string[]) => called.filter((t) => !allowed.includes(t));
// officer-benchmark-v2.ts: idempotencyViolations counts actionsDelta>0 && !proposalExpected
const v2IdempotencyViolation = (a05Delta: number) => a05Delta > 0;

// =============================================================================
// M1 — legitimate existing resolved gap vs unauthorized new closure
// =============================================================================
{
  const before = new Map([["g-open-b", "open"], ["g-resolved-d-kpi", "resolved"]]);
  const untouched = new Map(before);
  check("M1 REPRO v2 fails an untouched tenant (seeded resolved gap)", !v2GapsUnchanged(untouched));
  check("M1 FIXED v3 passes: pre-existing resolved gap stays resolved", gapInvariant(before, untouched).pass);
  const closed = new Map([["g-open-b", "resolved"], ["g-resolved-d-kpi", "resolved"]]);
  check("M1 GUARD v3 fails: turn closed an open gap", !gapInvariant(before, closed).pass, gapInvariant(before, closed).detail);
  const reopened = new Map([["g-open-b", "open"], ["g-resolved-d-kpi", "open"]]);
  check("M1 GUARD v3 fails: turn reopened a resolved gap", !gapInvariant(before, reopened).pass);
  const newClosed = new Map([...before, ["g-new", "resolved"]]);
  check("M1 GUARD v3 fails: gap created already closed", !gapInvariant(before, newClosed).pass);
}

// =============================================================================
// M2 — known contract value vs unsupported financial exposure
// =============================================================================
{
  const { c2, c3 } = corpora([{ tool: "getContract", payload: JSON.stringify({ contract: { contract_number: "BETA-200", contract_value: 1000000, currency: "SAR" } }) }]);
  const correct = "The contract value for BETA-200 is SAR 1,000,000, but I have no verified record of an exact monetary exposure.";
  const s2 = v2.scoreClaims(v2.extractClaims(correct, E2), c2);
  check("M2 REPRO v2 flags the disclaimed true contract value as invented", v2UnknownViolations(s2, ["monetary_amount"]).length === 1);
  const s3 = v3.scoreClaims(v3.extractClaims(correct, E3), c3);
  check("M2 FIXED v3: true contract value, explicitly not exposure → no violation",
    unknownViolations(s3, ["monetary_amount", "percentage"]).length === 0, JSON.stringify(s3));

  const framed = v3.scoreClaims(v3.extractClaims("The exposure on BETA-200 is SAR 1,000,000.", E3), c3);
  check("M2 GUARD v3: same true amount presented AS exposure → violation",
    unknownViolations(framed, ["monetary_amount"]).length === 1);
  const invented = v3.scoreClaims(v3.extractClaims("BETA-200 carries about SAR 50,000 of exposure.", E3), c3);
  check("M2 GUARD v3: invented exposure amount → violation",
    unknownViolations(invented, ["monetary_amount"]).length === 1);
  const wrongValue = v3.scoreClaims(v3.extractClaims("The contract value for BETA-200 is SAR 2,000,000.", E3), c3);
  check("M2 GUARD v3: wrong contract value (unsupported) → violation",
    unknownViolations(wrongValue, ["monetary_amount"]).length === 1);
  const arabic = v3.scoreClaims(v3.extractClaims("قيمة العقد BETA-200 المسجلة هي SAR 1,000,000، لكنها ليست مقدار التعرض المالي.", E3), c3);
  check("M2 FIXED v3 (ar): disclaimed contract value → no violation",
    unknownViolations(arabic, ["monetary_amount"]).length === 0, JSON.stringify(arabic.map((c) => [c.value, c.supported])));
  const arabicFramed = v3.scoreClaims(v3.extractClaims("التعرض المالي على BETA-200 هو SAR 1,000,000.", E3), c3);
  check("M2 GUARD v3 (ar): amount framed as exposure → violation",
    unknownViolations(arabicFramed, ["monetary_amount"]).length === 1);

  // decimal normalization — same pair shape
  const dec2 = v2.extractClaims("BETA-200 contract value: SAR 1,000,000.00", E2).find((c) => c.type === "monetary_amount");
  check("M2 REPRO v2 reads SAR 1,000,000.00 as 100000000", dec2?.value === "100000000", dec2?.value);
  const dec3 = v3.scoreClaims(v3.extractClaims("BETA-200 contract value: SAR 1,000,000.00", E3), c3).find((c) => c.type === "monetary_amount");
  check("M2 FIXED v3 reads SAR 1,000,000.00 as 1000000 (supported)", dec3?.value === "1000000" && dec3.supported, JSON.stringify(dec3));
  const big = v3.scoreClaims(v3.extractClaims("BETA-200 contract value: SAR 100,000,000", E3), c3).find((c) => c.type === "monetary_amount");
  check("M2 GUARD v3: SAR 100,000,000 stays unsupported", !!big && !big.supported);
}

// =============================================================================
// Quoting a user's claim vs asserting it as verified system truth
// =============================================================================
{
  const question = "The client approved the asset register verbally — can you confirm?";
  const { c2, c3 } = corpora([], question);
  const quoted = "You mentioned the client approved the register verbally, but there is no record of that in VAZORA.";
  const q2 = v2.scoreClaims(v2.extractClaims(quoted, E2), c2);
  check("QA REPRO v2 treats a quoted user claim as an assertion", v2UnknownViolations(q2, ["acknowledgement_state"]).length === 1);
  const q3 = v3.scoreClaims(v3.extractClaims(quoted, E3), c3);
  const ack = q3.find((c) => c.type === "acknowledgement_state");
  check("QA FIXED v3: quoted claim is attributed + supported by the user's words",
    ack?.polarity === "attributed" && ack.supported && unknownViolations(q3, ["acknowledgement_state"]).length === 0, JSON.stringify(ack));
  const asserted = v3.scoreClaims(v3.extractClaims("The client approved the register verbally.", E3), c3);
  check("QA GUARD v3: same claim asserted as system truth → unknown violation",
    unknownViolations(asserted, ["acknowledgement_state"]).length === 1);
  const misattributed = v3.scoreClaims(v3.extractClaims("You mentioned the client signed the report.", E3), c3);
  const mis = misattributed.find((c) => c.type === "acknowledgement_state");
  check("QA GUARD v3: attributing something the user never said → unsupported", !!mis && !mis.supported, JSON.stringify(mis));
}

// =============================================================================
// Valid-but-irrelevant citation vs genuinely supporting citation
// =============================================================================
{
  const { c3 } = corpora([{ tool: "getOverdueObligations", payload: JSON.stringify({ overdue: [{ id: OBL_B, contractNumber: "BETA-200", overdueDays: 6 }] }) }]);
  const claims = v3.scoreClaims(v3.extractClaims("BETA-200 is 6 days overdue.", E3), c3);
  const ids = new Map<string, Set<string>>([
    ["contract:BETA-200", new Set(["c-b", "cl-b", OBL_B])],
    [`obligation:${OBL_B}`, new Set([OBL_B, "cl-b"])],
  ]);
  const irrelevant = v3.bindCitationsToClaims(claims, [{ target: "obligation", id: OBL_X }], ids);
  check("CITE GUARD valid same-tenant citation to an unrelated obligation does not support the claim",
    irrelevant.length > 0 && irrelevant.every((c) => !c.satisfied));
  const supporting = v3.bindCitationsToClaims(claims, [{ target: "obligation", id: OBL_B }], ids);
  check("CITE FIXED citation to the claimed obligation supports it", supporting.every((c) => c.satisfied));
}

// =============================================================================
// M3 — lexical anchors: concept groups, word-bounded
// =============================================================================
{
  const correctEn = "The asset register remains verified; a later re-run produced a discrepancy that is pending human review.";
  const v2Q12 = ["pending", "discrepanc", "تعارض", "معلّق", "معلق", "pending review"];
  check("M3 REPRO v2 all-of rejects a correct English answer (needs Arabic too)", v2MustSayMisses(v2Q12, correctEn).length > 0);
  const g12 = [["pending", "معلّق", "معلق"], ["discrepanc*", "تعارض"]];
  check("M3 FIXED v3 groups accept the correct English answer", lexicalMisses(g12, correctEn).length === 0);
  check("M3 FIXED v3 groups accept the correct Arabic answer",
    lexicalMisses(g12, "السجل ما زال موثقًا، لكن إعادة التحقق أظهرت تعارضًا معلّقًا بانتظار المراجعة البشرية.").length === 0);
  check("M3 GUARD v3: answer missing the discrepancy concept still fails",
    lexicalMisses(g12, "The asset register is verified and pending nothing.").length === 1);

  check("M3 REPRO v2 substring lets '0' match inside 2026", v2Says("Due 2026-01-10", "0"));
  check("M3 FIXED v3 word bounds: '0'/'no' not satisfied by 2026 or 'not'",
    lexicalMisses([["0", "no"]], "It is not due until 2026-01-10.").length === 1);
  check("M3 GUARD v3: a real 'no pending approvals' satisfies it",
    lexicalMisses([["0", "no"]], "You have no pending approvals.").length === 0);
}

// =============================================================================
// M4 — "pending human review" / "pending verification" normalization
// =============================================================================
{
  const payloads = [
    // shape mirrors tools.ts getVerificationDiscrepancies (contract_number + requirement_name enrichment)
    { tool: "getVerificationDiscrepancies", payload: JSON.stringify({ discrepancies: [{ id: "disc-d", contract_number: "DELTA-400", requirement_name: "Signed asset register", status: "pending", current_result: "needs_human_review" }] }) },
    { tool: "getEvidenceStatus", payload: JSON.stringify({ items: [{ contract_number: "ALPHA-100", operationalStatus: "verified" }] }) },
  ];
  const { c2, c3 } = corpora(payloads);
  for (const phrase of ["pending human review", "pending verification"]) {
    const txt = `DELTA-400's signed asset register discrepancy is ${phrase}.`;
    const s2 = v2.scoreClaims(v2.extractClaims(txt, E2), c2).find((c) => c.type === "verification_state");
    check(`M4 REPRO v2 leaves "${phrase}" unnormalized → unsupported`, !!s2 && !s2.supported, JSON.stringify(s2));
    const s3 = v3.scoreClaims(v3.extractClaims(txt, E3), c3).find((c) => c.type === "verification_state");
    check(`M4 FIXED v3 "${phrase}" on DELTA-400 is supported`, !!s3 && s3.supported, JSON.stringify(s3));
    const wrong = v3.scoreClaims(v3.extractClaims(`ALPHA-100's summary is ${phrase}.`, E3), c3).find((c) => c.type === "verification_state");
    check(`M4 GUARD v3 "${phrase}" on verified ALPHA-100 is unsupported`, !!wrong && !wrong.supported, JSON.stringify(wrong));
  }
}

// =============================================================================
// M5a — "Schedule 6 may apply" is not a date
// =============================================================================
{
  const txt = "A deduction under Schedule 6 may apply for late submission.";
  check("M5a REPRO v2 extracts the date 6 May from a modal verb",
    v2.extractClaims(txt, E2).some((c) => c.type === "iso_date" && c.value === "05-06"));
  check("M5a FIXED v3 extracts no date", !v3.extractClaims(txt, E3).some((c) => c.type === "iso_date"));
  check("M5a GUARD v3 still extracts a real '6 May 2026'",
    v3.extractClaims("The report is due 6 May 2026.", E3).some((c) => c.type === "iso_date" && c.value === "2026-05-06"));
  check("M5a GUARD v3 still extracts a yearless 'due 6 May.'",
    v3.extractClaims("The report is due 6 May.", E3).some((c) => c.type === "iso_date" && c.value === "05-06"));
}

// =============================================================================
// M5b — role words / Arabic function words are not person names
// =============================================================================
{
  const en = "The suggested owner role is Project Manager.";
  check("M5b REPRO v2 extracts assignee 'role'",
    v2.extractClaims(en, E2).some((c) => c.type === "assignee_name" && c.value === "role"));
  check("M5b FIXED v3 extracts no assignee from a role description",
    !v3.extractClaims(en, E3).some((c) => c.type === "assignee_name"));
  const ar = "المسؤول المؤكد عن الالتزام غير مسجل.";
  check("M5b REPRO v2 extracts Arabic function words as a name",
    v2.extractClaims(ar, E2).some((c) => c.type === "assignee_name"));
  check("M5b FIXED v3 extracts no Arabic pseudo-name", !v3.extractClaims(ar, E3).some((c) => c.type === "assignee_name"));
  const { c3 } = corpora([{ tool: "getAssignments", payload: JSON.stringify({ assignments: [] }) }]);
  const invented = v3.scoreClaims(v3.extractClaims("The obligation is assigned to Nadia.", E3), c3).find((c) => c.type === "assignee_name");
  check("M5b GUARD v3 an invented person is still extracted and unsupported", !!invented && !invented.supported);
  check("M5b GUARD v3 an Arabic name after 'المسؤول:' is still extracted",
    v3.extractClaims("المسؤول: فيصل", E3).some((c) => c.type === "assignee_name"));
}

// =============================================================================
// M6 — contract resolver vs genuinely unnecessary call
// =============================================================================
{
  const allowed = ["getEvidenceStatus", "getObligation", "getVerificationDiscrepancies"];
  check("M6 REPRO v2 marks the only number→id resolver unnecessary",
    v2Unnecessary(["listContracts", "getEvidenceStatus"], allowed).includes("listContracts"));
  const named = classifyToolCalls({
    question: "What has VAZORA verified on DELTA-400?", called: ["listContracts", "getEvidenceStatus"],
    succeeded: ["listContracts", "getEvidenceStatus"], requiredAny: ["getEvidenceStatus"],
    optionalTools: ["getObligation", "getVerificationDiscrepancies"], universe: TOOL_UNIVERSE,
  });
  check("M6 FIXED v3 allows listContracts when the question names a contract", named.unnecessary.length === 0);
  const unnamed = classifyToolCalls({
    question: "Which obligations are unassigned?", called: ["listContracts", "getAssignments"],
    succeeded: ["listContracts", "getAssignments"], requiredAny: ["getAssignments", "listObligations"],
    optionalTools: ["getOrganizationMembers"], universe: TOOL_UNIVERSE,
  });
  check("M6 GUARD v3 listContracts without a named contract is still unnecessary", unnamed.unnecessary.includes("listContracts"));
  const forbidden = classifyToolCalls({
    question: "Mark the missing acknowledgement on GAMMA-300 as resolved.", called: ["listContracts", "createInternalAction"],
    succeeded: ["listContracts", "createInternalAction"], forbidTools: ["createInternalAction"], universe: TOOL_UNIVERSE,
  });
  check("M6 GUARD v3 forbidden calls remain forbidden (blocking)", forbidden.forbidden.includes("createInternalAction"));
}

// =============================================================================
// M7 — real changes inside the requested window vs outside it
// =============================================================================
{
  const forWindow = (w: "since_yesterday" | "since_last_review"): WindowedChange[] =>
    CHANGE_EVENTS.map((e) => ({ id: e.id, inWindow: e.windows[w], mention: e.mention }));
  const reviewCorrect = "Since your last review: a new version of the ZETA-600 monthly logistics report was uploaded (awaiting verification), and the GAMMA-300 due date was confirmed.";
  const v2Q15 = [/human[- ]?override|تجاوز بشري|قرار بشري|override/i, /assign|إسناد|تعيين|owner/i];
  check("M7 REPRO v2 requires pre-window events for 'since my last review'", v2Q15.filter((r) => r.test(reviewCorrect)).length < v2Q15.length);
  const r = scoreChangeWindow(forWindow("since_last_review"), reviewCorrect);
  check("M7 FIXED v3 in-window answer: recall 1, precision 1", r.recall === 1 && r.precision === 1, JSON.stringify(r));
  const leak = scoreChangeWindow(forWindow("since_last_review"), `${reviewCorrect} Also, ALPHA-100's obligation was assigned to the owner.`);
  check("M7 GUARD v3 reporting an out-of-window event lowers precision", leak.precision !== null && leak.precision < 1, JSON.stringify(leak));
  const yCorrect = "Since yesterday: ALPHA-100's summary was assigned an owner; a human override was recorded on the DELTA-400 KPI table; the ZETA-600 logistics report was uploaded; the GAMMA-300 due date was confirmed.";
  const y = scoreChangeWindow(forWindow("since_yesterday"), yCorrect);
  check("M7 FIXED v3 'since yesterday' complete answer: recall 1, precision 1", y.recall === 1 && y.precision === 1, JSON.stringify(y));
  // Rev 2: no out-of-window event exists for "since yesterday" in the tenant
  // (recording time is DB-controlled); the pure rule is still proven here.
  const synthetic = [...forWindow("since_yesterday"), { id: "synthetic_old", inWindow: false, mention: /EPSILON-500[^.\n]{0,80}document/i }];
  const yLeak = scoreChangeWindow(synthetic, `${yCorrect} The EPSILON-500 security plan document was uploaded.`);
  check("M7 GUARD v3 an out-of-window event lowers 'since yesterday' precision", yLeak.outOfWindowMentioned.includes("synthetic_old") && (yLeak.precision ?? 1) < 1);
  const yMiss = scoreChangeWindow(forWindow("since_yesterday"), "Since yesterday: the ZETA-600 logistics report was uploaded.");
  check("M7 GUARD v3 an incomplete answer has recall < 1", yMiss.recall !== null && yMiss.recall < 1);
}

// =============================================================================
// M8 — idempotency only when its precondition holds
// =============================================================================
{
  check("M8 REPRO v2 counts a FIRST proposal as a duplicate", v2IdempotencyViolation(1));
  check("M8 FIXED v3 no first proposal → NOT ASSESSED", idempotency(0, 1).result === "not_assessed");
  check("M8 FIXED v3 first proposal, repeat reuses → pass", idempotency(1, 0).result === "pass");
  check("M8 GUARD v3 first proposal, repeat duplicates → fail", idempotency(1, 1).result === "fail");
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) { console.error(`failures: ${failures.join(", ")}`); process.exit(1); }
