/**
 * HYBRID REVIEWER — FULL-ANSWER VALIDATION: SCORING CORE (pure; no I/O)
 *
 * Same rules as the calibration scorer (reviewer-pilot-v2.json → comparison):
 * parse rules, E1–E8, severity aggregation, source-path resolution. Added only
 * what the full-answer reference needs: absorbedSpans, split units (the
 * replaced parent is never in `units`), an UNDECIDABLE_IN_SCOPE unit and the
 * separate denominators.
 *
 * Span overlap only NOMINATES matches. A reference unit is matched
 * automatically only when its candidates are unshared and unanimous; anything
 * else is ADJUDICATION_REQUIRED and is never a pass.
 */

export type RefUnit = {
  unitId: string; span: string; assertion: "ASSERTED" | "NON_ASSERTION"; required: boolean; verdict: string;
  sourceRef?: string; absorbedSpans?: { span: string }[];
};
export type RefCase = { id: string; locale: string; origin: string; units: RefUnit[] };
export type RevUnit = { span?: string; assertion?: string; verdict?: string; sourceRefs?: string[]; claim?: string | null };
export type RawRecord = { httpStatus: number; stopReason: string | null; rawResponse: string } | undefined;
export type Adjudication = Record<string, { decision: "COVERED" | "OMITTED"; reviewerUnits: number[]; note: string }>;

export const UNDECIDABLE = "UNDECIDABLE_IN_SCOPE";
const SEVERITY = ["CONTRADICTED", "UNCERTAIN", "INSUFFICIENT_EVIDENCE", "SUPPORTED"];

export const norm = (s: string) =>
  s.normalize("NFKC").replace(/[\u064B-\u0652\u0670\u0640]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
const toks = (s: string) => norm(s).split(" ").filter(Boolean);
function share(a: string[], b: string[]) {
  const bs = new Set(b);
  return a.length ? a.filter((t) => bs.has(t)).length / a.length : 0;
}

function resolves(sources: Record<string, unknown>, receipts: unknown, path: string): boolean {
  const p = path.replace(/^sources\./, "");
  const root: unknown = /^receipts[.[]/.test(p) ? { receipts } : sources;
  let cur: unknown = root;
  for (const part of p.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return false;
  }
  return true;
}

export function referenceCaseVerdict(c: RefCase): string {
  const v = c.units.filter((u) => u.assertion === "ASSERTED").map((u) => u.verdict);
  if (v.includes(UNDECIDABLE)) return "INCOMPLETE";
  if (!v.length) return "NON_ASSERTION";
  return SEVERITY.find((s) => v.includes(s)) ?? "UNCERTAIN";
}

export function parseResponse(raw: RawRecord): { e8: string | null; units: RevUnit[]; logged: string[] } {
  if (!raw) return { e8: "no attempt recorded", units: [], logged: [] };
  if (raw.httpStatus !== 200) return { e8: `http ${raw.httpStatus}`, units: [], logged: [] };
  if (raw.stopReason === "max_tokens") return { e8: "stop_reason max_tokens (truncated)", units: [], logged: [] };
  let resp: { content?: { type: string; text?: string }[] };
  try { resp = JSON.parse(raw.rawResponse); } catch { return { e8: "raw response not JSON", units: [], logged: [] }; }
  const text = (resp.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  const logged = /^\s*```/.test(text) ? ["format note: markdown fence around JSON"] : [];
  let parsed: { caseId?: string; units?: RevUnit[]; coverage?: unknown };
  try { parsed = JSON.parse(text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); } catch {
    return { e8: "reviewer text is not a single JSON object", units: [], logged };
  }
  if (!Array.isArray(parsed.units) || !parsed.coverage || !parsed.caseId) return { e8: "schema: missing caseId/units/coverage", units: [], logged };
  if (parsed.units.some((u) => !u.span || !u.assertion || !u.verdict || !Array.isArray(u.sourceRefs))) {
    return { e8: "schema: unit missing span/assertion/verdict/sourceRefs", units: [], logged };
  }
  return { e8: null, units: parsed.units, logged };
}

type UnitResult = {
  unitId: string; required: boolean; refAssertion: string; refVerdict: string;
  status: "AUTO_COVERED" | "AUTO_OMITTED" | "ADJUDICATION_REQUIRED" | "ADJUDICATED_COVERED" | "ADJUDICATED_OMITTED";
  reviewerUnits: number[]; reviewerAssertion: string | null; reviewerVerdict: string | null; why: string; errors: string[];
};

export function scoreCase(ref: RefCase, sources: Record<string, unknown>, receipts: unknown, answer: string, raw: RawRecord, adj: Adjudication = {}) {
  const parsed = parseResponse(raw);
  const base = { id: ref.id, locale: ref.locale, origin: ref.origin, referenceCaseVerdict: referenceCaseVerdict(ref) };
  if (parsed.e8) return { ...base, e8: parsed.e8, reviewerCaseVerdict: null, units: [] as UnitResult[], reviewer: [], spurious: [] as number[], absorbed: [], logged: parsed.logged };

  const logged = [...parsed.logged];
  const rev = parsed.units.map((u, i) => {
    const invented = (u.sourceRefs ?? []).filter((p) => !resolves(sources, receipts, p));
    if (!answer.includes(u.span ?? "")) logged.push(`u${i}: span not verbatim in answer`);
    return { i, ...u, invented, eff: invented.length ? "REVIEWER_UNCERTAIN" : (u.verdict as string) };
  });

  // absorbed tokens (e.g. a bare "No."): attached to the absorbing unit, never a separate claim
  const absorbedTo = new Map<number, string>();
  for (const r of rev) {
    const rn = norm(r.span ?? "");
    for (const u of ref.units) for (const a of u.absorbedSpans ?? []) {
      if (rn && norm(a.span).split(" ").includes(rn)) absorbedTo.set(r.i, u.unitId);
    }
  }
  // an exact (normalized) span match binds that reviewer unit to that reference unit only
  const exact = new Map<number, string>();
  for (const r of rev) {
    const hit = ref.units.filter((u) => norm(u.span) === norm(r.span ?? ""));
    if (hit.length === 1) exact.set(r.i, hit[0].unitId);
  }
  const cands = new Map<string, number[]>();
  const claimedBy = new Map<number, string[]>();
  for (const u of ref.units) {
    const ut = toks(u.span);
    const list = rev.filter((r) => !absorbedTo.has(r.i) && (!exact.has(r.i) || exact.get(r.i) === u.unitId)).filter((r) => {
      if (exact.get(r.i) === u.unitId) return true;
      const rt = toks(r.span ?? "");
      return norm(r.span ?? "").includes(norm(u.span)) || share(ut, rt) >= 0.5 || share(rt, ut) >= 0.8;
    }).map((r) => r.i);
    cands.set(u.unitId, list);
    for (const i of list) claimedBy.set(i, [...(claimedBy.get(i) ?? []), u.unitId]);
  }

  const units: UnitResult[] = ref.units.map((u) => {
    const out: UnitResult = { unitId: u.unitId, required: u.required, refAssertion: u.assertion, refVerdict: u.verdict, status: "AUTO_OMITTED", reviewerUnits: [], reviewerAssertion: null, reviewerVerdict: null, why: "", errors: [] };
    const a = adj[u.unitId];
    const c = cands.get(u.unitId) ?? [];
    const pick = (ids: number[]) => {
      const rs = rev.filter((r) => ids.includes(r.i));
      return { as: [...new Set(rs.map((r) => r.assertion as string))], vs: [...new Set(rs.map((r) => r.eff))] };
    };
    if (a) {
      out.status = a.decision === "COVERED" ? "ADJUDICATED_COVERED" : "ADJUDICATED_OMITTED";
      out.reviewerUnits = a.reviewerUnits; out.why = `runner adjudication: ${a.note}`;
      if (a.decision === "COVERED") {
        const p = pick(a.reviewerUnits);
        if (p.as.length !== 1 || p.vs.length !== 1) { out.status = "ADJUDICATION_REQUIRED"; out.why += " (adjudicated units disagree)"; return out; }
        out.reviewerAssertion = p.as[0]; out.reviewerVerdict = p.vs[0];
      }
    } else if (!c.length) {
      out.why = "no reviewer unit overlaps this span";
    } else {
      const shared = c.filter((i) => (claimedBy.get(i) ?? []).length > 1);
      const p = pick(c);
      const absorbedConflict = rev.filter((r) => absorbedTo.get(r.i) === u.unitId && p.vs.length === 1 && r.eff !== p.vs[0]);
      out.reviewerUnits = c;
      if (shared.length) { out.status = "ADJUDICATION_REQUIRED"; out.why = `reviewer unit(s) ${shared.map((i) => "u" + i).join(",")} also overlap other reference units`; return out; }
      if (p.as.length !== 1 || p.vs.length !== 1) { out.status = "ADJUDICATION_REQUIRED"; out.why = "candidate units differ in assertion or verdict"; return out; }
      if (absorbedConflict.length) { out.status = "ADJUDICATION_REQUIRED"; out.why = `absorbed span judged differently (u${absorbedConflict.map((r) => r.i).join(",u")})`; return out; }
      out.status = "AUTO_COVERED"; out.reviewerAssertion = p.as[0]; out.reviewerVerdict = p.vs[0]; out.why = "unshared, unanimous candidates";
    }
    // ---- errors (never for the undecidable unit) ----
    const covered = out.status === "AUTO_COVERED" || out.status === "ADJUDICATED_COVERED";
    if (u.verdict === UNDECIDABLE) return out;
    if (!covered) { if (u.assertion === "ASSERTED" && u.required) out.errors.push("E4"); return out; }
    if (u.assertion === "NON_ASSERTION") { if (out.reviewerAssertion === "ASSERTED") out.errors.push("E5"); return out; }
    if (out.reviewerAssertion === "NON_ASSERTION") { if (u.required) out.errors.push("E4"); return out; }
    const v = out.reviewerVerdict, r = u.verdict;
    if (v === "SUPPORTED" && (r === "CONTRADICTED" || r === "INSUFFICIENT_EVIDENCE")) out.errors.push("E1");
    else if (v === "INSUFFICIENT_EVIDENCE" && r === "CONTRADICTED") out.errors.push("E2");
    else if ((v === "CONTRADICTED" || v === "INSUFFICIENT_EVIDENCE") && r === "SUPPORTED") out.errors.push("E3");
    else if (v === "CONTRADICTED" && r === "INSUFFICIENT_EVIDENCE") out.errors.push("MISMATCH_C_vs_IE");
    return out;
  });

  const spurious = rev.filter((r) => r.assertion === "ASSERTED" && !absorbedTo.has(r.i) && !claimedBy.has(r.i)).map((r) => r.i);
  const vs = rev.filter((r) => r.assertion === "ASSERTED" && !absorbedTo.has(r.i)).map((r) => (r.eff === "REVIEWER_UNCERTAIN" ? "UNCERTAIN" : r.eff));
  const reviewerCaseVerdict = vs.length ? SEVERITY.find((s) => vs.includes(s)) ?? "UNCERTAIN" : "NON_ASSERTION";
  return {
    ...base, e8: null, reviewerCaseVerdict, units, spurious, logged,
    absorbed: [...absorbedTo].map(([i, unitId]) => ({ reviewerUnit: i, unitId })),
    reviewer: rev.map((r) => ({ i: r.i, span: r.span, assertion: r.assertion, verdict: r.verdict, effectiveVerdict: r.eff, invented: r.invented, sourceRefs: r.sourceRefs })),
  };
}

export type CaseScore = ReturnType<typeof scoreCase>;

export function summarize(refCases: RefCase[], scores: CaseScore[]) {
  const all = refCases.flatMap((c) => c.units);
  const req = all.filter((u) => u.required);
  const den = {
    cases: refCases.length, units: all.length, materialRequired: req.length,
    decidableRequired: req.filter((u) => u.verdict !== UNDECIDABLE).length,
    undecidable: all.filter((u) => u.verdict === UNDECIDABLE).map((u) => u.unitId),
  };
  const E: Record<string, string[]> = { E1: [], E2: [], E3: [], E4: [], E5: [], E6: [], E7: [], E8: [], MISMATCH_C_vs_IE: [], ADJUDICATION_REQUIRED: [] };
  const undecidableRecord: unknown[] = [];
  let covered = 0, omitted = 0, pending = 0;
  for (const s of scores) {
    if (s.e8) { E.E8.push(`${s.id}: ${s.e8}`); continue; }
    for (const r of s.reviewer) {
      if (r.invented.length) E.E6.push(`${s.id} u${r.i}: ${r.invented.join(",")}`);
      // E7 = REVIEWER_UNCERTAIN on any unit: voided by E6 or emitted by the reviewer itself
      if (r.effectiveVerdict === "REVIEWER_UNCERTAIN") E.E7.push(`${s.id} u${r.i}${r.invented.length ? " (voided by E6)" : " (emitted)"}`);
    }
    for (const i of s.spurious) E.E5.push(`${s.id} u${i}: asserted, no reference unit`);
    for (const u of s.units) {
      for (const e of u.errors) E[e].push(`${u.unitId}: ${u.reviewerAssertion ?? "-"}/${u.reviewerVerdict ?? "-"} vs ${u.refAssertion}/${u.refVerdict}`);
      if (u.status === "ADJUDICATION_REQUIRED") { E.ADJUDICATION_REQUIRED.push(`${u.unitId}: ${u.why}`); }
      if (u.refVerdict === UNDECIDABLE) undecidableRecord.push({ unitId: u.unitId, status: u.status, reviewerAssertion: u.reviewerAssertion, reviewerVerdict: u.reviewerVerdict, scored: false });
      if (!u.required) continue;
      if (u.status === "AUTO_COVERED" || u.status === "ADJUDICATED_COVERED") covered++;
      else if (u.status === "ADJUDICATION_REQUIRED") pending++;
      else omitted++;
    }
  }
  const byId = new Map(scores.map((s) => [s.id, s]));
  const decidableCases = refCases.filter((c) => referenceCaseVerdict(c) !== "INCOMPLETE");
  const agreeIds = decidableCases.filter((c) => { const s = byId.get(c.id); return s && !s.e8 && s.reviewerCaseVerdict === referenceCaseVerdict(c); }).map((c) => c.id);
  const unitStatus = (id: string) => scores.flatMap((s) => s.units).find((u) => u.unitId === id);
  const perturbed = refCases.filter((c) => c.origin !== "HISTORICAL").flatMap((c) => c.units.filter((u) => u.verdict === "CONTRADICTED").map((u) => u.unitId));
  const detect = (ids: string[], want: string) => ids.map((id) => {
    const u = unitStatus(id);
    const st = !u ? "E8" : u.status === "ADJUDICATION_REQUIRED" ? "PENDING" : u.reviewerVerdict === want && (u.status === "AUTO_COVERED" || u.status === "ADJUDICATED_COVERED") ? "DETECTED" : "MISSED";
    return { unitId: id, result: st, reviewerVerdict: u?.reviewerVerdict ?? null };
  });
  const pert = detect(perturbed, "CONTRADICTED");
  const ie = detect(req.filter((u) => u.verdict === "INSUFFICIENT_EVIDENCE").map((u) => u.unitId), "INSUFFICIENT_EVIDENCE");
  const anyPending = E.ADJUDICATION_REQUIRED.length > 0;
  const crit = (fail: boolean) => (fail ? "FAIL" : anyPending ? "PENDING" : "PASS");
  const criteria = {
    E1_zero: crit(E.E1.length > 0), E2_zero: crit(E.E2.length > 0), E6_zero: E.E6.length ? "FAIL" : "PASS",
    E4_zero_on_required: crit(E.E4.length > 0), E8_zero: E.E8.length ? "FAIL" : "PASS",
    perturbations_7_of_7: pert.some((p) => p.result === "MISSED" || p.result === "E8") ? "FAIL" : pert.some((p) => p.result === "PENDING") ? "PENDING" : "PASS",
    agreement_all_decidable: agreeIds.length === decidableCases.length ? "PASS" : "FAIL",
    no_open_adjudication: anyPending ? "PENDING" : "PASS",
  };
  const vals = Object.values(criteria);
  const verdict = vals.includes("FAIL") ? "DOES NOT MEET STUDY CRITERIA" : vals.includes("PENDING") ? "INCOMPLETE" : "MEETS STUDY CRITERIA";
  const locales = [...new Set(refCases.map((c) => c.locale))].map((l) => {
    const cs = decidableCases.filter((c) => c.locale === l);
    return { locale: l, decidableCases: cs.length, agree: cs.filter((c) => agreeIds.includes(c.id)).length };
  });
  return {
    denominators: den,
    responseCompleteness: `${scores.filter((s) => !s.e8).length}/${refCases.length}`,
    agreement: `${agreeIds.length}/${decidableCases.length}`,
    verdictCoverage: `${decidableCases.length}/${refCases.length}`,
    claimCoverage: { requiredMaterial: den.materialRequired, covered, omitted, pending },
    perturbationDetection: pert, insufficientEvidenceDetection: ie, undecidableUnit: undecidableRecord,
    errors: E, criteria, verdict, locales,
    caseRows: refCases.map((c) => { const s = byId.get(c.id); return { id: c.id, locale: c.locale, reference: referenceCaseVerdict(c), reviewer: s?.e8 ? `E8: ${s.e8}` : s?.reviewerCaseVerdict ?? null, agreement: referenceCaseVerdict(c) === "INCOMPLETE" ? "NOT SCORED (reference incomplete)" : agreeIds.includes(c.id) ? "agree" : "DISAGREE" }; }),
  };
}
