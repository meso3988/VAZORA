/* eslint-disable @typescript-eslint/no-explicit-any */
// Offline RE-SCORING of a saved v3 diagnostic report — no model, no network.
//
// The same saved answers and tool traces are scored twice through the shared
// core (evaluate.ts): once with the frozen r3 rules (PARITY — must reproduce
// the live r3 verdicts, otherwise the reconstruction is not trusted), once
// with the current r4 rules. This is re-scoring, not a product evaluation:
// product fixes made after the run cannot change these responses.
//
// The r3 report did not persist the tenant identity (r4 does). It is rebuilt
// ONLY from ids that appear in the saved tool results, plus the fixture's
// constant labels (fixture.ts). An expectation needing an id that never
// appeared is NOT ASSESSED — never passed.
//
// Live-only facts (DB invariants, citation re-validation, blocked-citation
// count, action deltas) are carried from the saved report, as recorded.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-rescore.ts [report.json]

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r3ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r3/fact-ledger";
import * as r3scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r3/scoring";
import * as r3gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r3/ground-truth";
import * as r4ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/fact-ledger";
import * as r4scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/scoring";
import * as r4gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/ground-truth";
import { scoreAnswer as scoreAnswerR4 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/evaluate";
import * as curLedger from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import * as curScoring from "../benchmarks/contract-officer-benchmark-v3/scoring";
import * as curGt from "../benchmarks/contract-officer-benchmark-v3/ground-truth";
import { INJECTIONS } from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { scoreAnswer, type RuleModules } from "../benchmarks/contract-officer-benchmark-v3/evaluate";

// FROM = the revision the saved report was scored with (parity target);
// the comparison target is always the current revision.
const FROM = (process.env.RESCORE_FROM ?? "r3") as "r3" | "r4";
import { localDate } from "../../src/lib/officer/time";

const here = dirname(fileURLToPath(import.meta.url));
const REPORTS = join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports");
const reportPath = process.argv[2] ?? join(REPORTS, readdirSync(REPORTS).filter((f) => f.endsWith(".json")).sort()[0]);
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const results: any[] = report.runs[0].results;

// ---------- identity reconstruction from saved tool results ---------------------
// Constant fixture labels (fixture.ts): contract key → requirement names / evidence titles.
const FIXTURE: Record<string, { number: string; reqs: { name: string; evidenceTitle: string; kpi?: boolean }[] }> = {
  a: { number: "ALPHA-100", reqs: [{ name: "Monthly maintenance summary", evidenceTitle: "Monthly report" }] },
  b: { number: "BETA-200", reqs: [{ name: "تقرير مستوى الخدمة الموقّع", evidenceTitle: "تقرير سبتمبر" }] },
  c: { number: "GAMMA-300", reqs: [{ name: "Client acknowledgement", evidenceTitle: "Monthly report" }] },
  d: { number: "DELTA-400", reqs: [{ name: "Signed asset register", evidenceTitle: "Asset register — September" }, { name: "KPI results table", evidenceTitle: "KPI table — September", kpi: true }] },
  e: { number: "EPSILON-500", reqs: [{ name: "Security compliance statement", evidenceTitle: "Monthly report" }] },
  f: { number: "ZETA-600", reqs: [{ name: "Monthly logistics report", evidenceTitle: INJECTIONS.evidenceTitle }] },
};

function parse(payload: string): any {
  try {
    const p = JSON.parse(payload);
    return p?.truncated === true && typeof p.data === "string" ? { data: r4ledger.completeObjects(p.data) } : p;
  } catch { return null; }
}

function reconstruct() {
  const all: { tool: string; data: any }[] = [];
  for (const s of results) for (const t of s.turns ?? []) for (const x of t.trace ?? []) {
    const p = parse(x.payload);
    if (p) all.push({ tool: x.tool, data: p.data });
  }
  const rows = (tool: string): any[] => all.filter((x) => x.tool === tool).flatMap((x) => (Array.isArray(x.data) ? x.data : [x.data])).filter(Boolean);
  const byNumber = new Map<string, any>();
  const contracts: any = {};
  for (const [k, f] of Object.entries(FIXTURE)) { contracts[k] = { number: f.number }; byNumber.set(f.number, contracts[k]); }
  for (const c of rows("listContracts")) { const t = byNumber.get(c.contract_number); if (t) { t.contractId = c.id; t.title = c.title; } }
  for (const o of rows("listObligations")) {
    const t = byNumber.get(o.contract_number); if (!t) continue;
    t.obligationId = o.id; t.obligationTitle = o.title; t.contractId ??= o.contract_id; t.title ??= o.contract_title;
  }
  const byObligation = () => new Map(Object.values<any>(contracts).filter((c) => c.obligationId).map((c) => [c.obligationId, c]));
  for (const g of rows("getObligation")) {
    const t = byNumber.get(g.contract_number);
    const ref = (g.sourceRefs ?? [])[0];
    if (t && ref) { t.clauseId = ref.clause_id; t.clauseNumber = ref.clause_number; }
  }
  for (const cl of rows("getContractClause")) {
    const t = Object.values<any>(contracts).find((c) => c.contractId === cl.contract_id);
    if (t) { t.clauseId = cl.id; t.clauseNumber = cl.clause_number; }
  }
  // requirements: name → contract via obligation
  const reqRows: any[] = [
    ...rows("getEvidenceStatus").flatMap((x) => x.requirements ?? []).map((r: any) => ({ reqId: r.requirementId, name: r.name, obligationId: r.obligationId })),
    ...rows("getVerificationDiscrepancies").map((d: any) => ({ reqId: d.evidence_requirement_id, name: d.requirement_name, discrepancy: d })),
    ...rows("getEvidenceGaps").map((g: any) => ({ reqId: g.evidence_requirement_id, obligationId: g.obligation_id })),
  ];
  for (const [k, f] of Object.entries(FIXTURE)) {
    const c = contracts[k];
    for (const spec of f.reqs) {
      const hit = reqRows.find((r) => r.name === spec.name) ??
        (f.reqs.length === 1 && c.obligationId ? reqRows.find((r) => r.obligationId === c.obligationId) : undefined);
      const req: any = { reqId: hit?.reqId, name: spec.name, evidenceTitle: spec.evidenceTitle };
      const d = reqRows.find((r) => r.reqId && r.reqId === hit?.reqId && r.discrepancy)?.discrepancy;
      if (d) { req.itemId = d.evidence_item_id; req.checkId = d.prior_check_id; req.versionId = d.evidence_version_id; req.runId = d.prior_run_id; c.discrepancyId = d.id; }
      if (spec.kpi) c.kpiReq = req; else c.req = req;
    }
  }
  // activity events: item ids / overridden check ids that were visible
  for (const ev of rows("getRecentActivity").flatMap((x) => x.events ?? (Array.isArray(x) ? x : [x]))) {
    if (ev?.event_type === "evidence.version_uploaded" && ev.metadata?.contract && ev.entity_id) {
      const c = byNumber.get(ev.metadata.contract); if (c?.req && !c.req.itemId) c.req.itemId = ev.entity_id;
    }
    if (ev?.event_type === "evidence.human_override" && ev.entity_id && contracts.d.kpiReq) contracts.d.kpiReq.checkId ??= ev.entity_id;
  }
  const members = rows("getOrganizationMembers");
  const orgId = rows("getVerificationDiscrepancies").find((d: any) => d.organization_id)?.organization_id ?? null;
  const owner = members.find((m: any) => m.role === "owner");
  void byObligation;
  return {
    orgId, userId: owner?.userId, email: owner?.email, memberEmails: members.map((m: any) => m.email).filter(Boolean),
    today: localDate(new Date(report.ranAt), "Asia/Riyadh"), contracts,
    gapRows: rows("getEvidenceGaps"),
  };
}

// ---------- citation scopes (identical to the harness) ---------------------------
function buildEntityCitations(fx: any): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const put = (key: string, ids: (string | null | undefined)[]) => m.set(key, new Set(ids.filter(Boolean) as string[]));
  for (const c of Object.values<any>(fx.contracts)) {
    const reqIds = [c.req, c.kpiReq].filter(Boolean).flatMap((r: any) => [r.reqId, r.itemId, r.checkId, r.versionId]);
    put(`contract:${c.number}`, [c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqIds]);
    put(`clause:${c.clauseId}`, [c.clauseId, c.docId]);
    put(`obligation:${c.obligationId}`, [c.obligationId, c.clauseId, c.discrepancyId, ...reqIds]);
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      put(`requirement:${r.reqId}`, [r.reqId, r.itemId, r.checkId, r.versionId, c.obligationId, c.discrepancyId]);
      if (r.itemId) put(`evidence_item:${r.itemId}`, [r.itemId, r.versionId, r.checkId, r.reqId, c.obligationId, c.discrepancyId]);
      put(`evidence_item:${r.reqId}`, [r.reqId, c.obligationId]);
    }
  }
  for (const e of fx.memberEmails ?? []) put(`member:${e}`, [fx.userId]);
  for (const g of fx.gapRows ?? []) {
    for (const key of [`requirement:${g.evidence_requirement_id}`, `obligation:${g.obligation_id}`,
      g.contract_id && `contract:${Object.values<any>(fx.contracts).find((c) => c.contractId === g.contract_id)?.number}`,
    ].filter(Boolean) as string[]) m.set(key, new Set([...(m.get(key) ?? []), g.id]));
  }
  return m;
}
function buildCitationFamilies(fx: any): Map<string, Set<string>> {
  const fam = new Map<string, Set<string>>();
  const add = (id: string | null | undefined, ...ids: (string | null | undefined)[]) => {
    if (!id) return;
    fam.set(id, new Set([id, ...(fam.get(id) ?? []), ...(ids.filter(Boolean) as string[])]));
  };
  for (const c of Object.values<any>(fx.contracts)) {
    const reqItems: string[] = [];
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      const rIds = [r.reqId, r.itemId, r.checkId, r.versionId, r.runId].filter(Boolean) as string[];
      reqItems.push(...rIds);
      add(r.reqId, r.itemId, r.checkId, r.versionId, r.runId);
      for (const x of rIds) if (x !== r.reqId) add(x, r.reqId);
    }
    add(c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqItems);
    add(c.obligationId, c.clauseId, c.discrepancyId, ...reqItems);
    add(c.clauseId, c.docId);
    if (c.discrepancyId) add(c.discrepancyId, c.obligationId);
  }
  for (const g of fx.gapRows ?? []) {
    add(g.id); add(g.evidence_requirement_id, g.id); add(g.obligation_id, g.id);
    const c = Object.values<any>(fx.contracts).find((x) => x.contractId === g.contract_id);
    if (c) add(c.contractId, g.id);
  }
  return fam;
}

// ---------- expectations restricted to reconstructable ids -------------------------
const hasUndefined = (v: unknown) => JSON.stringify(v, (_k, x) => (x === undefined ? "__UNDEF__" : x)).includes("__UNDEF__") || /:undefined\b/.test(JSON.stringify(v));
function restrict(exp: any, fx: any, notAssessed: string[]) {
  const out = { ...exp };
  for (const key of ["expectedArgs", "expectedCitations", "expectedFacts", "forbiddenFacts"] as const) {
    if (!exp[key]) continue;
    const list = exp[key](fx) as any[];
    const kept = list.filter((x) => !hasUndefined(x));
    if (kept.length < list.length) notAssessed.push(`${key}: ${list.length - kept.length} item(s) need ids absent from the saved tool results`);
    out[key] = () => kept;
  }
  return out;
}

function carriedLive(s: any, orgId: string | null) {
  const displayedInvalid = s.securityFailures.filter((f: string) => f.startsWith("invalid citation surfaced") || f.startsWith("unauthorized disclosure")).map((f: string) => f);
  const dbFails = s.securityFailures.filter((f: string) => f.startsWith("db invariant")).map((f: string) => {
    const m = f.match(/^db invariant (\S+): (.*)$/); return { name: m?.[1] ?? "?", pass: false, detail: m?.[2] ?? "" };
  });
  const passed = Number(s.metrics.dbChecksPassed ?? 0);
  // r4+ reports persist the server's blocked list (with reasons); r3 only a count
  const blocked = Array.isArray(s.blockedCitations) && Array.isArray(s.turns?.[0]?.rejectedCitations)
    ? s.turns[0].rejectedCitations.map((b: any) => ({ id: b.id, target: b.target, reason: b.reason }))
    : Math.max(0, Number(s.metrics.citationsRejected ?? 0) - displayedInvalid.length);
  return {
    displayedInvalid, displayedValidCount: Number(s.metrics.citationsValid ?? 0), blocked,
    dbInvariants: [...dbFails, ...Array.from({ length: passed }, () => ({ name: "carried", pass: true, detail: "" }))],
    orgId,
  };
}

// ---------- run -----------------------------------------------------------------
// Prefer the identity the run persisted (r4+ harness); reconstruct only for r3 reports.
const persisted = report.runs[0].fixtureIdentity;
const fx: any = persisted
  ? { ...persisted, gapRows: reconstruct().gapRows }
  : reconstruct();
const entityToIds = buildEntityCitations(fx);
const families = buildCitationFamilies(fx);
type Rev = { label: string; mods: RuleModules; score: typeof scoreAnswer; r4: boolean };
const REVS: Record<"from" | "to", Rev> = {
  from: FROM === "r3"
    ? { label: "r3", mods: { ledger: r3ledger, scoring: r3scoring, gt: r3gt }, score: scoreAnswer, r4: false }
    : { label: "r4", mods: { ledger: r4ledger, scoring: r4scoring, gt: r4gt }, score: scoreAnswerR4 as typeof scoreAnswer, r4: true },
  to: { label: "r5", mods: { ledger: curLedger, scoring: curScoring, gt: curGt }, score: scoreAnswer, r4: true },
};
const expsBy = (gt: any) => new Map<string, any>(gt.EXPECTATIONS.map((e: any) => [e.id, e]));

console.log(`re-scoring ${reportPath.split("/").pop()} (recorded at revision ${report.provenance.manifest.revision}) · ${REVS.from.label} → ${REVS.to.label}`);
console.log(`identity: ${persisted ? "PERSISTED by the run (no reconstruction)" : "reconstructed from saved tool results"} · org ${fx.orgId ? "found" : "NOT FOUND"} · contracts ${Object.values<any>(fx.contracts).filter((c) => c.contractId).length}/6 · obligations ${Object.values<any>(fx.contracts).filter((c) => c.obligationId).length}/6 · clauses ${Object.values<any>(fx.contracts).filter((c) => c.clauseId).length}/6\n`);

const rows: any[] = [];
let parityOk = true;
for (const s of results) {
  if (s.status !== "answered") { rows.push({ id: s.id, status: s.status }); continue; }
  const turns = s.turns.map((t: any) => ({ ...t, citations: (t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })) }));
  const out: any = {};
  for (const key of ["from", "to"] as const) {
    const rev = REVS[key];
    const notAssessed: string[] = [];
    const exp = restrict(expsBy(rev.mods.gt).get(s.id), fx, notAssessed);
    const r = rev.score({
      mods: rev.mods, exp, fx, question: turns[0].question, turns,
      env: { entityMap: rev.mods.ledger.buildEntityMap(fx), entityToIds, families }, live: carriedLive(s, fx.orgId), r4: rev.r4,
    });
    r.notAssessed.push(...notAssessed);
    out[key] = r;
  }
  const live = [...s.productFailures, ...s.securityFailures].sort();
  const off = [...out.from.productFailures, ...out.from.securityFailures].sort();
  const parity = JSON.stringify(live) === JSON.stringify(off);
  if (!parity) parityOk = false;
  const toF = [...out.to.productFailures, ...out.to.securityFailures];
  rows.push({
    id: s.id, status: "answered", live: s.correctnessPass ? "PASS" : `FAIL(${live.length})`, parity,
    to: out.to.correctnessPass ? "PASS" : `FAIL(${toF.length})`,
    removed: live.filter((f: string) => !toF.includes(f)), added: toF.filter((f) => !live.includes(f)),
    parityDiff: parity ? null : { liveOnly: live.filter((f: string) => !off.includes(f)), offlineOnly: off.filter((f) => !live.includes(f)) },
    security: out.to.securityFailures, notAssessed: out.to.notAssessed, metrics: out.to.metrics,
  });
}

const [F, T] = [REVS.from.label, REVS.to.label];
for (const r of rows) {
  if (r.status !== "answered") { console.log(`${r.id.padEnd(4)} ${r.status.toUpperCase()} — NOT ASSESSED (no saved answer)`); continue; }
  console.log(`${r.id.padEnd(4)} live ${F} ${r.live.padEnd(8)} · offline ${F} parity ${r.parity ? "✓" : "✗"} · ${T} ${r.to}`);
  if (r.parityDiff) console.log(`       PARITY DIFF live-only=${JSON.stringify(r.parityDiff.liveOnly)} offline-only=${JSON.stringify(r.parityDiff.offlineOnly)}`);
  for (const f of r.removed) console.log(`       − ${f}`);
  for (const f of r.added) console.log(`       + ${f}`);
  for (const n of r.notAssessed) console.log(`       NOT ASSESSED ${n}`);
}
const answered = rows.filter((r) => r.status === "answered");
const sum = (k: string) => answered.reduce((n, r) => n + (Number(r.metrics[k]) || 0), 0);
console.log(`\nparity with live ${F}: ${parityOk ? "ALL MATCH" : "MISMATCHES — see PARITY DIFF"}`);
console.log(`${F} (live)      correct ${answered.filter((r) => r.live === "PASS").length}/${answered.length}`);
console.log(`${T} (re-scored) correct ${answered.filter((r) => r.to === "PASS").length}/${answered.length} · unsupported claims ${sum("unsupportedClaims")} · claim-citation support ${sum("claimSupportSatisfied")}/${sum("claimSupportTotal")} · security failures ${answered.reduce((n, r) => n + r.security.length, 0)} · blocked-before-disclosure ${sum("blockedBeforeDisclosure")} · unauthorized disclosures ${sum("unauthorizedDisclosures")} · unauthorized reads ${answered.some((r) => r.metrics.unauthorizedReads === null) ? "NOT ASSESSED (partial)" : sum("unauthorizedReads")}`);
