/**
 * FULL-ANSWER STUDY — SCORING SELF-TEST (offline; synthetic reviewer outputs)
 *
 * Tests the scoring tool, not the reviewer: every reviewer response here is
 * written by hand. Uses the locked v4 reference and the exact v4 request
 * inputs, so the oracle run exercises the real denominators and sources.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type RefCase, type RevUnit, scoreCase, summarize, UNDECIDABLE } from "../benchmarks/evaluator-v4-proto/fullanswer-scoring";

const here = dirname(fileURLToPath(import.meta.url));
const proto = join(here, "..", "benchmarks", "evaluator-v4-proto");
const refs: RefCase[] =
  JSON.parse(readFileSync(join(proto, "fullanswer-validation-v4.references.json"), "utf8")).cases;
const built = JSON.parse(readFileSync(join(proto, "reports", "2026-10-03T00-07-54-994Z-fullanswer-v4-requests.json"), "utf8"));
const input = new Map<string, { answer: string; sources: Record<string, unknown>; receipts: unknown }>(
  built.packages.map((p: { id: string; body: { messages: { content: string }[] } }) => [p.id, JSON.parse(p.body.messages[0].content)]),
);

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const raw = (caseId: string, units: RevUnit[], over: Partial<{ httpStatus: number; stopReason: string; text: string }> = {}) => ({
  httpStatus: over.httpStatus ?? 200,
  stopReason: over.stopReason ?? "end_turn",
  rawResponse: JSON.stringify({ content: [{ type: "thinking", thinking: "" }, { type: "text", text: over.text ?? JSON.stringify({ caseId, units, coverage: { allTextReviewed: true } }) }] }),
});
const oracleUnits = (c: (typeof refs)[number]): RevUnit[] => c.units.map((u) => ({
  span: u.span, assertion: u.assertion,
  verdict: u.assertion === "NON_ASSERTION" ? "NON_ASSERTION" : u.verdict === UNDECIDABLE ? "SUPPORTED" : u.verdict,
  sourceRefs: u.assertion === "ASSERTED" && u.sourceRef && !u.sourceRef.startsWith("(") && u.verdict !== "INSUFFICIENT_EVIDENCE" ? [u.sourceRef] : [],
}));
const ref = (id: string) => refs.find((c) => c.id === id)!;
const sc = (id: string, units: RevUnit[], over = {}, adj = {}) => { const i = input.get(id)!; return scoreCase(ref(id), i.sources, i.receipts, i.answer, raw(id, units, over), adj); };
const oracleScores = (patch: Record<string, RevUnit[] | ReturnType<typeof raw>> = {}) => refs.map((c) => {
  const i = input.get(c.id)!;
  const p = patch[c.id];
  const r = p && !Array.isArray(p) ? p : raw(c.id, (p as RevUnit[]) ?? oracleUnits(c));
  return scoreCase(c, i.sources, i.receipts, i.answer, r);
});
const uOf = (s: ReturnType<typeof sc>, id: string) => s.units.find((u) => u.unitId === id)!;

// 1. totals and the oracle run
const oracle = summarize(refs, oracleScores());
const d = oracle.denominators;
check("denominators from the file: 24 cases / 88 units / 83 required / 82 decidable", d.cases === 24 && d.units === 88 && d.materialRequired === 83 && d.decidableRequired === 82, JSON.stringify(d));
check("only FA-C01#0 undecidable", JSON.stringify(d.undecidable) === '["FA-C01#0"]');
check("oracle: MEETS, agreement 23/23, coverage 23/24, completeness 24/24", oracle.verdict === "MEETS STUDY CRITERIA" && oracle.agreement === "23/23" && oracle.verdictCoverage === "23/24" && oracle.responseCompleteness === "24/24", `${oracle.verdict} ${oracle.agreement}`);
check("oracle: 83 required covered, 0 omitted, 0 pending", oracle.claimCoverage.covered === 83 && oracle.claimCoverage.omitted === 0 && oracle.claimCoverage.pending === 0, JSON.stringify(oracle.claimCoverage));
check("oracle: zero errors in every class", Object.values(oracle.errors).every((v) => v.length === 0), JSON.stringify(Object.fromEntries(Object.entries(oracle.errors).map(([k, v]) => [k, v.length]))));
check("oracle: 7/7 perturbations detected, 8/8 insufficient-evidence detected", oracle.perturbationDetection.length === 7 && oracle.perturbationDetection.every((p) => p.result === "DETECTED") && oracle.insufficientEvidenceDetection.length === 8 && oracle.insufficientEvidenceDetection.every((p) => p.result === "DETECTED"));
check("24 unique case rows; C01 not scored", new Set(oracle.caseRows.map((r) => r.id)).size === 24 && oracle.caseRows.find((r) => r.id === "FA-C01")!.agreement.startsWith("NOT SCORED"));

// 2. replaced parent never counted; a parent-span unit cannot cover the split units
check("replaced parent FA-M03#1 absent from active units", !ref("FA-M03").units.some((u) => u.unitId === "FA-M03#1"));
const m03 = ref("FA-M03");
const parentSpan = "The contractor must submit a monthly logistics report by the fifth day of each month";
const parentRun = sc("FA-M03", [...oracleUnits(m03).filter((u) => !["FA-M03#1a", "FA-M03#1b"].some((id) => m03.units.find((x) => x.unitId === id)!.span === u.span)), { span: parentSpan, assertion: "ASSERTED", verdict: "SUPPORTED", sourceRefs: [] }]);
check("parent-span reviewer unit → #1a and #1b ADJUDICATION_REQUIRED, not covered", uOf(parentRun, "FA-M03#1a").status === "ADJUDICATION_REQUIRED" && uOf(parentRun, "FA-M03#1b").status === "ADJUDICATION_REQUIRED");

// 3. split units judged separately
const splitRun = sc("FA-M03", oracleUnits(m03).map((u) => (u.span === "The contractor must submit" ? { ...u, verdict: "SUPPORTED", sourceRefs: [] } : u)));
check("#1a SUPPORTED → E1 on #1a only; #1b unaffected", uOf(splitRun, "FA-M03#1a").errors.includes("E1") && uOf(splitRun, "FA-M03#1b").errors.length === 0);

// 4. absorbed spans never create a claim
const c05 = ref("FA-C05");
const absorbedOk = sc("FA-C05", [{ span: "No.", assertion: "ASSERTED", verdict: "SUPPORTED", sourceRefs: [] }, ...oracleUnits(c05)]);
check("bare 'No.' is absorbed: no E5, absorbing unit covered", absorbedOk.spurious.length === 0 && absorbedOk.absorbed.length === 1 && uOf(absorbedOk, "FA-C05#0").status === "AUTO_COVERED");
const absorbedConflict = sc("FA-C05", [{ span: "No.", assertion: "ASSERTED", verdict: "INSUFFICIENT_EVIDENCE", sourceRefs: [] }, ...oracleUnits(c05)]);
check("absorbed span judged differently → ADJUDICATION_REQUIRED, case verdict unchanged", uOf(absorbedConflict, "FA-C05#0").status === "ADJUDICATION_REQUIRED" && absorbedConflict.reviewerCaseVerdict === "CONTRADICTED");

// 5. a document description does not cover the verification claim
const synth: RefCase = { id: "SYN-1", locale: "en", origin: "HISTORICAL", units: [{ unitId: "SYN-1#0", span: "has been verified by engineering", assertion: "ASSERTED", required: true, verdict: "CONTRADICTED" }] };
const synthRun = scoreCase(synth, { "EV-610": { type: "certificate", status: "uploaded" } }, [], "EV-610, the site completion certificate, has been verified by engineering.",
  raw("SYN-1", [{ span: "EV-610, the site completion certificate", assertion: "ASSERTED", verdict: "SUPPORTED", sourceRefs: ["EV-610.type"] }]));
check("descriptor-only reviewer unit → verification claim OMITTED (E4), never covered", synthRun.units[0].status === "AUTO_OMITTED" && synthRun.units[0].errors.includes("E4"));

// 6. an omitted required claim is not hidden by other correct claims
const s02 = ref("FA-S02");
const omit = summarize(refs, oracleScores({ "FA-S02": oracleUnits(s02).slice(1) }));
check("S02 missing one unit → E4 recorded, verdict DOES NOT MEET even though the case agrees", omit.errors.E4.length === 1 && omit.verdict === "DOES NOT MEET STUDY CRITERIA" && omit.caseRows.find((r) => r.id === "FA-S02")!.agreement === "agree");

// 7. invented source path
const s01 = ref("FA-S01");
const inv = summarize(refs, oracleScores({ "FA-S01": oracleUnits(s01).map((u, i) => (i === 0 ? { ...u, sourceRefs: ["t1:getOverdueObligations.result.data.noSuchField"] } : u)) }));
check("unresolvable sourceRef → E6 + E7, unit voided, criterion FAIL", inv.errors.E6.length === 1 && inv.errors.E7.length === 1 && inv.criteria.E6_zero === "FAIL" && inv.caseRows.find((r) => r.id === "FA-S01")!.agreement === "DISAGREE");
const receiptRef = sc("FA-M07", oracleUnits(ref("FA-M07")));
check("receipts.* paths resolve (not invented)", receiptRef.reviewer.every((r) => r.invented.length === 0));

// 8. truncated / invalid / schema-broken responses never pass
const s05 = ref("FA-S05");
const bad = (over: object) => summarize(refs, oracleScores({ "FA-S05": raw("FA-S05", oracleUnits(s05), over) }));
const trunc = bad({ stopReason: "max_tokens" }), notJson = bad({ text: "Verdict: supported." }), schema = bad({ text: JSON.stringify({ caseId: "FA-S05", units: [{ span: "x" }], coverage: {} }) }), http = bad({ httpStatus: 529 });
check("truncation → E8, completeness 23/24, DOES NOT MEET", trunc.errors.E8.length === 1 && trunc.responseCompleteness === "23/24" && trunc.verdict === "DOES NOT MEET STUDY CRITERIA");
check("non-JSON, schema violation, HTTP error → E8 each, never PASS", [notJson, schema, http].every((s) => s.errors.E8.length === 1 && s.criteria.E8_zero === "FAIL"));

// 9. FA-C01 treatment
const c01 = ref("FA-C01");
const c01Contra = summarize(refs, oracleScores({ "FA-C01": oracleUnits(c01).map((u) => (u.span === "is currently a healthy contract" ? { ...u, verdict: "CONTRADICTED", sourceRefs: [] } : u)) }));
check("reviewer verdict on FA-C01#0 recorded, never scored", (c01Contra.undecidableUnit[0] as { reviewerVerdict: string; scored: boolean }).reviewerVerdict === "CONTRADICTED" && (c01Contra.undecidableUnit[0] as { scored: boolean }).scored === false);
check("FA-C01#0 verdict cannot raise or lower the score", c01Contra.agreement === oracle.agreement && c01Contra.verdict === oracle.verdict && Object.values(c01Contra.errors).every((v) => v.length === 0));
const c01Omit = summarize(refs, oracleScores({ "FA-C01": oracleUnits(c01).filter((u) => u.span !== "is currently a healthy contract") }));
check("FA-C01#0 omitted → visible coverage miss, not E4, not a model error", c01Omit.claimCoverage.omitted === 1 && c01Omit.errors.E4.length === 0 && c01Omit.verdict === "MEETS STUDY CRITERIA");
check("agreement denominator is 23 and verdict coverage stays 23/24", oracle.agreement.endsWith("/23") && c01Omit.verdictCoverage === "23/24");

// 10. pending adjudication is never a pass; adjudication resolves it explicitly
const pend = summarize(refs, oracleScores({ "FA-M03": [...oracleUnits(m03).filter((u) => !["The contractor must submit", "a monthly logistics report by the fifth day of each month"].includes(u.span ?? "")), { span: parentSpan, assertion: "ASSERTED", verdict: "INSUFFICIENT_EVIDENCE", sourceRefs: [] }] }));
check("open adjudication → INCOMPLETE, no criterion silently PASS", pend.verdict === "INCOMPLETE" && pend.criteria.no_open_adjudication === "PENDING" && pend.claimCoverage.pending === 2);

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
