/**
 * REVIEWER PILOT v2 — MATCHING / ADJUDICATION LEDGER + INDEPENDENT AUDIT PACKET
 *
 * Derived ONLY from committed files (mechanical scoring + adjudication +
 * request bodies). For every reference unit it separates:
 *   1. the reviewer's raw verdict (its own units, untouched),
 *   2. the automatic span match (top candidate by overlap),
 *   3. any change the experiment runner made during adjudication,
 *   4. the effect of that change on E1–E8 and on the case score.
 * Anything that is not an exact, single, unchanged automatic match is
 * labelled adjudication_required — never hidden under an automatic result.
 *
 * It also writes an audit packet for an independent reviewer: answer text,
 * sources and the reviewer's units, WITHOUT the runner's decisions, without old
 * detector results and without code.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-reviewer-pilot-v2-ledger.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const base = join(protoDir, "reports", "2026-10-02T01-18-02-707Z-reviewer-pilot-v2-");

type Unit = { i: number; span?: string; assertion?: string; claim?: string | null; verdict?: string; effectiveVerdict?: string; sourceRefs?: string[] };
type RefUnit = { span: string; assertion: string; verdict: string; required: boolean };
type Cand = { unit: number; ratio: number };
type Mech = { id: string; locale: string; e8: string | null; caseVerdict: string; reference: { caseVerdict: string; units: RefUnit[] }; units: Unit[]; candidates: { refUnit: number; candidates: Cand[] }[] };
type AdjUnit = { refUnit: number; decision: string; reviewerUnit: number | null; reviewerVerdict: string | null; note: string };
type AdjCase = { id: string; units: AdjUnit[]; spurious: { reviewerUnit: number; note: string }[] };

const mech: Mech[] = JSON.parse(readFileSync(base + "mechanical.json", "utf8"));
const adj: { cases: AdjCase[] } = JSON.parse(readFileSync(join(protoDir, "reviewer-pilot-v2-adjudication.json"), "utf8"));
const reqs = JSON.parse(readFileSync(base + "requests.json", "utf8"));
const adjById = new Map(adj.cases.map((c) => [c.id, c]));
const inputById = new Map<string, { answer: string; sources: unknown }>(
  reqs.requests.map((r: { caseId: string; body: { messages: { content: string }[] } }) => {
    const j = JSON.parse(r.body.messages[0].content);
    return [r.caseId, { answer: j.answer, sources: j.sources }];
  }),
);

function errorFor(ref: RefUnit, reviewerVerdict: string | null, covered: boolean): string | null {
  if (ref.assertion !== "ASSERTED") return null;
  if (!covered) return ref.required ? "E4" : null;
  if (reviewerVerdict === "SUPPORTED" && (ref.verdict === "CONTRADICTED" || ref.verdict === "INSUFFICIENT_EVIDENCE")) return "E1";
  if (reviewerVerdict === "INSUFFICIENT_EVIDENCE" && ref.verdict === "CONTRADICTED") return "E2";
  if ((reviewerVerdict === "CONTRADICTED" || reviewerVerdict === "INSUFFICIENT_EVIDENCE") && ref.verdict === "SUPPORTED") return "E3";
  return null;
}

const ledger: unknown[] = [];
const audit: unknown[] = [];
let adjudicationRequired = 0;
const mechanicalOnlyErrors: string[] = [];
const adjudicatedErrors: string[] = [];

for (const c of mech) {
  const a = adjById.get(c.id)!;
  const unitsOut = c.reference.units.map((ref, ri) => {
    const cands = c.candidates.find((x) => x.refUnit === ri)?.candidates ?? [];
    const top = cands[0] ?? null;
    const topUnit = top ? c.units.find((u) => u.i === top.unit) : undefined;
    const topVerdict = topUnit ? (topUnit.assertion === "ASSERTED" ? topUnit.effectiveVerdict ?? null : "NON_ASSERTION") : null;
    const decided = a.units.find((u) => u.refUnit === ri)!;
    const changed = !top || decided.reviewerUnit !== top.unit;
    const exact = !!top && top.ratio === 1 && cands.filter((x) => x.ratio === 1).length === 1 && !changed;
    const status = exact ? "auto_exact" : "adjudication_required";
    if (status === "adjudication_required") adjudicationRequired++;
    const mechErr = errorFor(ref, topVerdict === "NON_ASSERTION" ? null : topVerdict, !!top && topVerdict !== "NON_ASSERTION");
    const adjErr = errorFor(ref, decided.reviewerVerdict, decided.decision === "COVERED");
    if (mechErr) mechanicalOnlyErrors.push(`${c.id} ref${ri}: ${mechErr}`);
    if (adjErr) adjudicatedErrors.push(`${c.id} ref${ri}: ${adjErr}`);
    return {
      refUnit: ri, refSpan: ref.span, refAssertion: ref.assertion, refVerdict: ref.verdict, required: ref.required,
      automaticMatch: top ? { reviewerUnit: top.unit, overlap: +top.ratio.toFixed(2), reviewerVerdict: topVerdict, otherCandidates: cands.slice(1).map((x) => ({ unit: x.unit, overlap: +x.ratio.toFixed(2) })) } : null,
      runnerAdjudication: { decision: decided.decision, reviewerUnit: decided.reviewerUnit, reviewerVerdict: decided.reviewerVerdict, note: decided.note },
      runnerChangedAutomaticMatch: changed,
      status,
      errorIfAutomaticOnly: mechErr,
      errorAfterAdjudication: adjErr,
    };
  });
  const spurious = a.spurious.map((s) => ({ ...s, rule: "ASSERTED reviewer unit where the reference has no asserted unit — mechanical rule; the presupposition/consequent label is the runner's description" }));
  ledger.push({
    id: c.id, locale: c.locale,
    reviewerRawUnits: c.units.map((u) => ({ unit: u.i, span: u.span, assertion: u.assertion, verdict: u.verdict, effectiveVerdict: u.effectiveVerdict, sourceRefs: u.sourceRefs })),
    reviewerCaseVerdict: c.caseVerdict, referenceCaseVerdict: c.reference.caseVerdict,
    caseScoreDependsOnMatching: false,
    referenceUnits: unitsOut, spurious,
  });
  if (unitsOut.some((u) => u.status === "adjudication_required") || spurious.length) {
    const inp = inputById.get(c.id)!;
    audit.push({
      id: c.id,
      answer: inp.answer,
      sources: inp.sources,
      reviewerUnits: c.units.map((u) => ({ unit: u.i, span: u.span, assertion: u.assertion, claim: u.claim, verdict: u.verdict, sourceRefs: u.sourceRefs })),
      questions: [
        ...unitsOut.filter((u) => u.status === "adjudication_required").map((u) => ({
          referenceClaim: u.refSpan,
          ask: "Which reviewer unit(s), if any, address this same claim — same subject, same content, same polarity (asserted vs negated), same time scope? Answer with unit numbers, NONE, or AMBIGUOUS, and give a one-line reason.",
        })),
        ...spurious.map((s) => ({
          reviewerUnit: s.reviewerUnit,
          ask: "Does the answer itself assert this unit as fact, or is it a presupposition / conditional consequence / non-assertion? Answer ASSERTED, NON_ASSERTION or AMBIGUOUS with a one-line reason.",
        })),
      ],
    });
  }
}

const out = {
  derivedFrom: ["reports/…-reviewer-pilot-v2-mechanical.json", "reviewer-pilot-v2-adjudication.json", "reports/…-reviewer-pilot-v2-requests.json"],
  note: "The case-level reviewer verdict is aggregated from the reviewer's OWN units and does not depend on matching. Matching affects only unit-level E1–E4. E5 is mechanical. Span overlap and coverage.allTextReviewed are never treated as proof of coverage.",
  adjudicationRequiredCount: adjudicationRequired,
  errorsIfAutomaticMatchOnly: mechanicalOnlyErrors,
  errorsAfterRunnerAdjudication: adjudicatedErrors,
  independentConfirmation: "NOT YET PERFORMED — the runner's adjudication is unconfirmed until the audit packet is reviewed independently",
  cases: ledger,
};
writeFileSync(base + "matching-ledger.json", JSON.stringify(out, null, 2));
writeFileSync(join(protoDir, "reviewer-pilot-v2-independent-audit-packet.json"), JSON.stringify({
  purpose: "Independent audit of matching decisions in the 24-case calibration. You receive the answer, the exact sources the reviewer saw, and the reviewer's units. You do NOT receive the runner's decisions, any reference verdicts, old detector results or code. Answer each question from the text and sources only.",
  items: audit,
}, null, 2));

console.log(`adjudication_required reference units: ${adjudicationRequired}`);
console.log(`errors if the automatic top match were used: ${mechanicalOnlyErrors.length ? mechanicalOnlyErrors.join(" | ") : "none"}`);
console.log(`errors after runner adjudication: ${adjudicatedErrors.length ? adjudicatedErrors.join(" | ") : "none"}`);
for (const l of ledger as { id: string; referenceUnits: { refUnit: number; status: string; automaticMatch: { reviewerUnit: number; overlap: number } | null; runnerAdjudication: { reviewerUnit: number | null }; runnerChangedAutomaticMatch: boolean; errorIfAutomaticOnly: string | null; errorAfterAdjudication: string | null }[]; spurious: unknown[] }[]) {
  for (const u of l.referenceUnits) {
    if (u.status === "auto_exact") continue;
    console.log(`  ${l.id} ref${u.refUnit}: auto u${u.automaticMatch?.reviewerUnit ?? "-"} (${u.automaticMatch?.overlap ?? "-"}) → runner u${u.runnerAdjudication.reviewerUnit}${u.runnerChangedAutomaticMatch ? " CHANGED" : ""} · auto-only error ${u.errorIfAutomaticOnly ?? "none"} · adjudicated error ${u.errorAfterAdjudication ?? "none"}`);
  }
  if (l.spurious.length) console.log(`  ${l.id}: ${l.spurious.length} spurious unit(s) (E5, mechanical)`);
}
console.log(`audit packet items: ${audit.length}`);
