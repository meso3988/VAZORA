/**
 * HYBRID SEMANTIC REVIEWER PILOT v2 — SCORE (offline; reads committed raw only)
 *
 * Step 1 (this file, mechanical): parse each committed raw response, validate
 * the schema, resolve every cited source path against the exact sources that
 * were sent, aggregate a case verdict, and nominate candidate matches between
 * reference units and reviewer units (span containment / >=50% overlap).
 *
 * Span overlap only NOMINATES a candidate. Whether the reviewer addressed the
 * same claim (subject, content, polarity, temporal scope) is adjudicated per
 * unit in reviewer-pilot-v2-adjudication.json; an ambiguous match is recorded
 * as REVIEW_NEEDED and is never a pass. Step 2 (--final) computes E1–E8 and
 * the pilot criteria from the adjudication file.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-reviewer-pilot-v2-score.ts <raw.jsonl> [--final]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const rawPath = process.argv[2];
const finalMode = process.argv.includes("--final");
if (!rawPath) { console.error("usage: <raw.jsonl> [--final]"); process.exit(2); }

type RefUnit = { span: string; assertion: "ASSERTED" | "NON_ASSERTION"; verdict: string; required: boolean };
type PilotCase = { id: string; group: string; locale: string; dangerous?: boolean; distinction: string; reference: { caseVerdict: string; units: RefUnit[] } };
type RevUnit = { span?: string; assertion?: string; nonAssertionKind?: string | null; claim?: string | null; entityScope?: string[]; temporalScope?: string | null; verdict?: string; sourceRefs?: string[]; reason?: string };

const manifest = JSON.parse(readFileSync(join(protoDir, "reviewer-pilot-v2.json"), "utf8"));
const requests = JSON.parse(readFileSync(rawPath.replace(/-raw\.jsonl$/, "-requests.json"), "utf8"));
const sourcesById = new Map<string, Record<string, unknown>>(
  requests.requests.map((r: { caseId: string; body: { messages: { content: string }[] } }) => [r.caseId, JSON.parse(r.body.messages[0].content).sources]),
);
const answerById = new Map<string, string>(
  requests.requests.map((r: { caseId: string; body: { messages: { content: string }[] } }) => [r.caseId, JSON.parse(r.body.messages[0].content).answer]),
);
const raw = readFileSync(rawPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rawById = new Map(raw.map((r) => [r.caseId, r]));

const norm = (s: string) =>
  s.normalize("NFKC").replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

function overlapRatio(ref: string, rev: string): number {
  const a = norm(ref), b = norm(rev);
  if (!a || !b) return 0;
  if (b.includes(a)) return 1;
  const at = a.split(" "), bt = new Set(b.split(" "));
  return at.filter((t) => bt.has(t)).length / at.length;
}

function resolvePath(sources: Record<string, unknown>, path: string): boolean {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  // record ids contain hyphens, never dots — the first part is the record key
  let cur: unknown = sources;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return false;
  }
  return true;
}

const SEVERITY = ["CONTRADICTED", "UNCERTAIN", "INSUFFICIENT_EVIDENCE", "SUPPORTED"];
// Report rows are heterogeneous (E8 rows carry no units); typed loosely for display only.
type ReportRow = {
  id: string; locale: string; group: string; dangerous: boolean; e8: string | null;
  reference: { caseVerdict: string; units: RefUnit[] }; caseVerdict: string;
  coverage: { allTextReviewed?: boolean; notes?: string }; logged: string[];
  units: (RevUnit & { i: number; inventedRefs: string[]; effectiveVerdict?: string })[];
  candidates: { refUnit: number; refSpan: string; refAssertion: string; refVerdict: string; required: boolean;
    candidates: { unit: number; ratio: number; assertion?: string; verdict?: string }[] }[];
};

const report = (manifest.cases as PilotCase[]).map((k) => {
  const r = rawById.get(k.id);
  const out: Record<string, unknown> = { id: k.id, group: k.group, locale: k.locale, dangerous: !!k.dangerous, reference: k.reference };
  if (!r) return { ...out, e8: "no attempt recorded" };
  if (r.httpStatus !== 200) return { ...out, e8: `http ${r.httpStatus}` };
  if (r.stopReason === "max_tokens") return { ...out, e8: "stop_reason max_tokens" };
  let resp: { content?: { type: string; text?: string }[] };
  try { resp = JSON.parse(r.rawResponse); } catch { return { ...out, e8: "raw response not JSON" }; }
  const text = (resp.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const fenced = /^\s*```/.test(text);
  const body = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  let parsed: { caseId?: string; units?: RevUnit[]; coverage?: { allTextReviewed?: boolean; notes?: string } };
  try { parsed = JSON.parse(body); } catch { return { ...out, e8: "reviewer text is not a single JSON object", text: text.slice(0, 300) }; }
  if (!Array.isArray(parsed.units) || !parsed.coverage || !parsed.caseId) return { ...out, e8: "schema: missing caseId/units/coverage" };
  const badUnit = parsed.units.find((u) => !u.span || !u.assertion || !u.verdict || !Array.isArray(u.sourceRefs));
  if (badUnit) return { ...out, e8: "schema: unit missing span/assertion/verdict/sourceRefs" };

  const sources = sourcesById.get(k.id) ?? {};
  const answer = answerById.get(k.id) ?? "";
  const logged: string[] = [];
  if (fenced) logged.push("format note: markdown fence around JSON");
  if (parsed.caseId !== k.id) logged.push(`caseId echo mismatch: ${parsed.caseId}`);
  const units = parsed.units.map((u, i) => {
    const invented = (u.sourceRefs ?? []).filter((p) => !resolvePath(sources, p));
    const spanVerbatim = answer.includes(u.span ?? "");
    if (!spanVerbatim) logged.push(`unit ${i}: span not verbatim in answer`);
    if (u.assertion === "NON_ASSERTION" && u.verdict !== "NON_ASSERTION") logged.push(`unit ${i}: NON_ASSERTION with verdict ${u.verdict}`);
    if (u.assertion === "ASSERTED" && u.verdict === "NON_ASSERTION") logged.push(`unit ${i}: ASSERTED with verdict NON_ASSERTION`);
    const effectiveVerdict = invented.length ? "REVIEWER_UNCERTAIN" : u.verdict;
    return { i, ...u, inventedRefs: invented, effectiveVerdict };
  });
  const asserted = units.filter((u) => u.assertion === "ASSERTED");
  let caseVerdict = "NON_ASSERTION";
  if (asserted.length) {
    const vs = asserted.map((u) => (u.effectiveVerdict === "REVIEWER_UNCERTAIN" ? "UNCERTAIN" : u.effectiveVerdict as string));
    caseVerdict = SEVERITY.find((s) => vs.includes(s)) ?? "UNCERTAIN";
  }
  const candidates = k.reference.units.map((ru, ri) => {
    const c = units
      .map((u) => ({ unit: u.i, ratio: overlapRatio(ru.span, u.span ?? ""), assertion: u.assertion, verdict: u.effectiveVerdict, claim: u.claim }))
      .filter((c) => c.ratio >= 0.5)
      .sort((a, b) => b.ratio - a.ratio);
    return { refUnit: ri, refSpan: ru.span, refAssertion: ru.assertion, refVerdict: ru.verdict, required: ru.required, candidates: c };
  });
  return {
    ...out, e8: null, usage: r.usage, stopReason: r.stopReason, caseVerdict,
    coverage: parsed.coverage, logged, units, candidates,
  };
});

if (!finalMode) {
  const file = rawPath.replace(/-raw\.jsonl$/, "-mechanical.json");
  writeFileSync(file, JSON.stringify(report, null, 2));
  for (const c of report as unknown as ReportRow[]) {
    console.log(`\n### ${c.id} [${c.locale}/${c.group}]${c.dangerous ? " DANGEROUS" : ""} ref=${c.reference.caseVerdict} reviewer=${c.e8 ? "E8:" + c.e8 : c.caseVerdict}`);
    if (c.e8) continue;
    for (const u of c.units) console.log(`   u${u.i} ${u.assertion}/${u.effectiveVerdict}${u.inventedRefs.length ? " INVENTED:" + u.inventedRefs.join(",") : ""} | "${(u.span ?? "").slice(0, 70)}" | claim: ${(u.claim ?? "-").slice(0, 90)} | refs: ${(u.sourceRefs ?? []).join(",")}`);
    for (const cd of c.candidates) console.log(`   ref${cd.refUnit} [${cd.refAssertion}/${cd.refVerdict}${cd.required ? "" : " optional"}] "${cd.refSpan.slice(0, 50)}" → ${cd.candidates.length ? cd.candidates.map((x) => `u${x.unit}(${x.ratio.toFixed(2)} ${x.assertion}/${x.verdict})`).join(" ") : "NO CANDIDATE"}`);
    if (c.logged.length) console.log(`   logged: ${c.logged.join(" | ")}`);
    console.log(`   coverage: allTextReviewed=${c.coverage.allTextReviewed} notes="${(c.coverage.notes ?? "").slice(0, 80)}"`);
  }
  console.log(`\nmechanical report: ${file}`);
}

if (finalMode) {
  const adj = JSON.parse(readFileSync(join(protoDir, "reviewer-pilot-v2-adjudication.json"), "utf8"));
  type Adj = { refUnit: number; decision: "COVERED" | "OMITTED" | "REVIEW_NEEDED"; reviewerUnit: number | null; reviewerVerdict: string | null; note: string };
  type CaseAdj = { id: string; units: Adj[]; spurious: { reviewerUnit: number; note: string }[] };
  const adjById = new Map<string, CaseAdj>(adj.cases.map((c: CaseAdj) => [c.id, c]));
  const E: Record<string, string[]> = { E1: [], E2: [], E3: [], E4: [], E5: [], E6: [], E7: [], E8: [], REVIEW_NEEDED: [] };
  let caseAgree = 0;
  const caseRows: string[] = [];
  for (const c of report as unknown as ReportRow[]) {
    if (c.e8) { E.E8.push(`${c.id}: ${c.e8}`); caseRows.push(`${c.id} ref=${c.reference.caseVerdict} reviewer=E8`); continue; }
    for (const u of c.units) if (u.inventedRefs.length) E.E6.push(`${c.id} u${u.i}: ${u.inventedRefs.join(",")}`);
    for (const u of c.units) if (u.effectiveVerdict === "REVIEWER_UNCERTAIN") E.E7.push(`${c.id} u${u.i}`);
    const a = adjById.get(c.id);
    if (!a) { E.REVIEW_NEEDED.push(`${c.id}: no adjudication`); continue; }
    for (const s of a.spurious) E.E5.push(`${c.id} u${s.reviewerUnit}: ${s.note}`);
    for (const au of a.units) {
      const ru = c.reference.units[au.refUnit] as RefUnit;
      if (au.decision === "REVIEW_NEEDED") { E.REVIEW_NEEDED.push(`${c.id} ref${au.refUnit}: ${au.note}`); continue; }
      if (au.decision === "OMITTED") { if (ru.required && ru.assertion === "ASSERTED") E.E4.push(`${c.id} ref${au.refUnit}: ${au.note}`); continue; }
      if (ru.assertion !== "ASSERTED") continue;
      const v = au.reviewerVerdict;
      if (v === "SUPPORTED" && (ru.verdict === "CONTRADICTED" || ru.verdict === "INSUFFICIENT_EVIDENCE")) E.E1.push(`${c.id} ref${au.refUnit}: reviewer SUPPORTED vs ${ru.verdict}`);
      if (v === "INSUFFICIENT_EVIDENCE" && ru.verdict === "CONTRADICTED") E.E2.push(`${c.id} ref${au.refUnit}: reviewer INSUFFICIENT vs CONTRADICTED`);
      if ((v === "CONTRADICTED" || v === "INSUFFICIENT_EVIDENCE") && ru.verdict === "SUPPORTED") E.E3.push(`${c.id} ref${au.refUnit}: reviewer ${v} vs SUPPORTED`);
    }
    const agree = c.caseVerdict === c.reference.caseVerdict;
    if (agree) caseAgree++;
    caseRows.push(`${c.id} [${c.locale}] ref=${c.reference.caseVerdict} reviewer=${c.caseVerdict} ${agree ? "agree" : "DISAGREE"}`);
  }
  const criteria = {
    E1_zero: E.E1.length === 0, E2_zero: E.E2.length === 0, E6_zero: E.E6.length === 0,
    E4_zero_on_required: E.E4.length === 0, E8_zero: E.E8.length === 0, caseAgreement_ge_23: caseAgree >= 23,
    noUnresolvedReview: E.REVIEW_NEEDED.length === 0,
  };
  const meets = Object.values(criteria).every(Boolean);
  const final = { caseAgreement: `${caseAgree}/24`, errors: E, criteria, verdict: meets ? "MEETS PILOT CRITERIA" : "DOES NOT MEET", caseRows };
  writeFileSync(rawPath.replace(/-raw\.jsonl$/, "-final-score.json"), JSON.stringify(final, null, 2));
  console.log(JSON.stringify(final, null, 2));
}
