// Phase 4A.1 — fact-ledger unit tests (deterministic, no model).
// Proves the measurement machinery itself: extraction, entity binding,
// negation scoping, corpus support, and claim↔citation support cases A–E.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  buildEntityMap, buildCorpus, extractClaims, scoreClaims,
  bindCitationsToClaims, splitClauses, isNegatedClause,
} from "../benchmarks/contract-officer-benchmark-v2/fact-ledger";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name} ${detail}`); }
}

// ---------- synthetic world ----------------------------------------------------
const OBL_B = "11111111-1111-1111-1111-111111111111";
const OBL_X = "22222222-2222-2222-2222-222222222222";
const CLAUSE_B = "33333333-3333-3333-3333-333333333333";
const REQ_C = "44444444-4444-4444-4444-444444444444";
const TENANT_B_ID = "55555555-5555-5555-5555-555555555555"; // foreign-tenant citation id

const fx = {
  memberEmails: ["owner@bench.test"],
  contracts: {
    b: {
      number: "BETA-200", title: "O&M Central", contractId: "c-b",
      obligationId: OBL_B, obligationTitle: "Monthly SLA report",
      clauseId: CLAUSE_B, clauseNumber: "7.3",
      req: { reqId: "r-b", itemId: "i-b", name: "Signed SLA report", evidenceTitle: "September report" },
    },
    x: {
      number: "XRAY-900", title: "Other", contractId: "c-x",
      obligationId: OBL_X, obligationTitle: "Unrelated duty",
      clauseId: "cl-x", clauseNumber: "1.1",
      req: { reqId: REQ_C, itemId: "i-c", name: "Client acknowledgement", evidenceTitle: "Ack" },
    },
  },
};

const entities = buildEntityMap(fx);

// Corpus = what tools returned. B's obligation is 6 days overdue, due 2026-01-10.
const corpus = buildCorpus({
  toolPayloads: [
    { tool: "getOverdueObligations", payload: JSON.stringify({ overdue: [{ id: OBL_B, contractNumber: "BETA-200", title: "Monthly SLA report", overdueDays: 6, dueDate: "2026-01-10" }] }) },
    { tool: "getEvidenceGaps", payload: JSON.stringify({ gaps: [{ id: "gap-1", requirementId: REQ_C, contract: "XRAY-900", status: "open" }] }) },
  ],
  question: "Which obligations are overdue?",
  contextValues: ["2026-01-16"],
  entities,
});

const entityToIds = new Map<string, Set<string>>([
  [`contract:BETA-200`, new Set(["c-b", CLAUSE_B, OBL_B])],
  [`obligation:${OBL_B}`, new Set([OBL_B, CLAUSE_B, "c-b"])],
  [`contract:XRAY-900`, new Set(["c-x", "cl-x", OBL_X, REQ_C])],
  [`obligation:${OBL_X}`, new Set([OBL_X, "cl-x", "c-x", REQ_C])],
  [`requirement:${REQ_C}`, new Set([REQ_C, OBL_X, "c-x"])],
]);

// ---------- extraction --------------------------------------------------------
{
  const claims = extractClaims("BETA-200 is 6 days overdue.", entities);
  const d = claims.find((c) => c.type === "day_count");
  check("extract-day-count", d?.value === "6" && d.polarity === "asserted");
  const e = claims.find((c) => c.type === "contract_number");
  check("extract-contract-number", e?.value === "beta-200");
  check("bind-day-count-to-contract", d?.entityKey === "contract:BETA-200");
}
{
  const claims = extractClaims("متأخر بـ٦ أيام على BETA-200", entities);
  check("extract-arabic-indic-day", claims.some((c) => c.type === "day_count" && c.value === "6"), JSON.stringify(claims));
}
{
  const claims = extractClaims("Exposure is SAR 50,000 and 12%.", entities);
  check("extract-money", claims.some((c) => c.type === "monetary_amount" && c.value === "50000"), JSON.stringify(claims));
  check("extract-percent", claims.some((c) => c.type === "percentage"));
}
{
  const claims = extractClaims("المبلغ ٥٠٬٠٠٠ ريال", entities);
  check("extract-arabic-money", claims.some((c) => c.type === "monetary_amount" && c.value === "50000"), JSON.stringify(claims));
}
{
  const claims = extractClaims("Clause 7.3 requires the monthly SLA report. Due 2026-01-10.", entities);
  check("extract-clause-number", claims.some((c) => c.type === "clause_number" && c.value === "7.3"));
  check("extract-iso-date", claims.some((c) => c.type === "iso_date" && c.value === "2026-01-10"));
  check("extract-month-date", extractClaims("due Sep 25, 2026", entities).some((c) => c.value === "2026-09-25"));
}

// ---------- negation scoping ----------------------------------------------------
check("clause-negation-detect", isNegatedClause("there is no record that the client approved"));
check("clause-affirmative", !isNegatedClause("the client approved verbally"));
{
  // The decisive case: negation in ANOTHER clause must not hide an assertion.
  const claims = extractClaims("The client approved verbally, but there is no signed record.", entities);
  const ack = claims.find((c) => c.type === "acknowledgement_state");
  check("negation-other-clause-still-asserts", ack?.polarity === "asserted", JSON.stringify(claims));
}
{
  const claims = extractClaims("There is no record that the client approved verbally.", entities);
  const ack = claims.find((c) => c.type === "acknowledgement_state");
  check("negated-claim-not-asserted", !ack || ack.polarity === "negated", JSON.stringify(claims));
}
check("clause-split", splitClauses("A is done but B is not").length >= 2);

// ---------- corpus support -------------------------------------------------------
{
  const claims = extractClaims("BETA-200 is 6 days overdue, due 2026-01-10.", entities);
  const scored = scoreClaims(claims, corpus);
  check("grounded-claims-supported", scored.filter((c) => c.polarity === "asserted").every((c) => c.supported),
    JSON.stringify(scored.filter((c) => !c.supported)));
}
{
  const claims = extractClaims("BETA-200 is 12 days overdue.", entities);
  const scored = scoreClaims(claims, corpus);
  check("wrong-day-count-unsupported",
    scored.some((c) => c.type === "day_count" && c.value === "12" && !c.supported));
}
{
  const claims = extractClaims("BETA-200 exposure is SAR 50,000.", entities);
  const scored = scoreClaims(claims, corpus);
  check("invented-money-flagged",
    scored.some((c) => c.type === "monetary_amount" && !c.supported));
}
{
  // value exists globally but NOT on the claimed entity — binding must catch it
  const c2 = buildCorpus({
    toolPayloads: [
      { tool: "getOverdueObligations", payload: JSON.stringify({ overdue: [{ id: OBL_B, contractNumber: "BETA-200", overdueDays: 6 }] }) },
      { tool: "getOverdueObligations", payload: JSON.stringify({ overdue: [{ id: OBL_X, contractNumber: "XRAY-900", overdueDays: 12 }] }) },
    ],
    question: "", contextValues: [], entities,
  });
  const claims = extractClaims("BETA-200 is 12 days overdue.", entities);
  const scored = scoreClaims(claims, c2);
  check("cross-entity-value-rejected",
    scored.some((c) => c.type === "day_count" && c.value === "12" && !c.supported));
}

// ---------- claim ↔ citation support (spec cases A–E) -----------------------------
{
  // A: correct fact + correct citation → PASS
  const claims = scoreClaims(extractClaims("BETA-200 is 6 days overdue.", entities), corpus);
  const checks = bindCitationsToClaims(claims, [{ target: "obligation", id: OBL_B }], entityToIds);
  check("A-correct-fact-correct-cite", checks.length > 0 && checks.every((c) => c.satisfied));
}
{
  // B: correct fact + unrelated citation from same contract → FAIL support
  const claims = scoreClaims(extractClaims("BETA-200 is 6 days overdue.", entities), corpus);
  const checks = bindCitationsToClaims(claims, [{ target: "clause", id: "cl-x" }].map((c) => c), entityToIds);
  // cl-x belongs to XRAY-900; even a same-contract decoy must fail — test with X's obligation
  const decoy = bindCitationsToClaims(claims, [{ target: "obligation", id: OBL_X }], entityToIds);
  check("B-unrelated-cite-fails", checks.every((c) => !c.satisfied) && decoy.every((c) => !c.satisfied));
}
{
  // C: incorrect fact + valid citation → FAIL factual accuracy
  const claims = scoreClaims(extractClaims("BETA-200 is 12 days overdue.", entities), corpus);
  const bad = claims.filter((c) => c.type === "day_count" && !c.supported);
  check("C-wrong-fact-fails", bad.length === 1);
}
{
  // D: correct fact + foreign-tenant citation → BLOCKED (validator rejects it;
  //    here the binding must also refuse to satisfy the claim)
  const claims = scoreClaims(extractClaims("BETA-200 is 6 days overdue.", entities), corpus);
  const checks = bindCitationsToClaims(claims, [{ target: "obligation", id: TENANT_B_ID }], entityToIds);
  check("D-foreign-cite-fails", checks.every((c) => !c.satisfied));
}
{
  // E: no citation for a material claim → coverage fails
  const claims = scoreClaims(extractClaims("BETA-200 is 6 days overdue.", entities), corpus);
  const checks = bindCitationsToClaims(claims, [], entityToIds);
  check("E-no-cite-fails-coverage", checks.length > 0 && checks.every((c) => !c.satisfied));
}

// ---------- negated claim contradicted by corpus ---------------------------------
{
  // Corpus positively shows BETA-200 overdue; "not overdue" must be contradicted.
  const claims = extractClaims("BETA-200 is not overdue.", entities);
  const scored = scoreClaims(claims, corpus);
  const neg = scored.find((c) => c.type === "overdue_state" && c.polarity === "negated");
  check("negated-claim-contradicted", !!neg && neg.supported === false, JSON.stringify(scored));
}

// ---------- regression: review-found defects ----------------------------------
{
  // "غير مكتمل" ASSERTS the incomplete state — the internal negation must not
  // flip the claim to negated (which would false-flag a true statement).
  const claims = extractClaims("التقرير غير مكتمل", entities);
  const st = claims.find((c) => c.type === "verification_state");
  check("internal-negation-asserts-state", st?.polarity === "asserted" && st.value === "incomplete", JSON.stringify(claims));
}
{
  const claims = extractClaims("BETA-200 is six days overdue.", entities);
  check("word-number-day-count", claims.some((c) => c.type === "day_count" && c.value === "6"));
}
{
  const claims = extractClaims("The owner is unassigned.", entities);
  check("assignee-stopword-skipped", !claims.some((c) => c.type === "assignee_name" && c.value === "unassigned"));
}
{
  // Per-clause binding: each side of a conjunction binds its own entity.
  const claims = extractClaims("BETA-200 is 6 days overdue, but XRAY-900 is on track.", entities);
  const day = claims.find((c) => c.type === "day_count");
  check("per-clause-entity-binding", day?.entityKey === "contract:BETA-200", JSON.stringify(claims));
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) { console.error(`failures: ${failures.join(", ")}`); process.exit(1); }
