/* eslint-disable @typescript-eslint/no-explicit-any */
// Offline RE-SCORING of the saved full v3 GATE report — no model, no network.
//
// Extends officer-benchmark-v3-rescore.ts to every run in the report: each of
// the 3 runs persisted its own tenant identity (fixtureIdentity), so gap rows,
// entity citations and reference dates are reconstructed PER RUN. Every saved
// answer is scored under frozen r5 modules (PARITY — must reproduce the live
// verdicts), frozen r6 modules, and the live r7 modules.
//
// Live-only facts (DB invariants, citation re-validation, blocked citations,
// action deltas) are carried from the saved report exactly as recorded.
// Scenarios without a saved answer stay NOT ASSESSED. Historical reports are
// never modified; output is written to a NEW report file.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
//   supabase/tests/officer-benchmark-v3-gate-rescore.ts \
//   [report.json] [out.json]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r5ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/fact-ledger";
import * as r5scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/scoring";
import * as r5gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/ground-truth";
import { scoreAnswer as scoreAnswerR5 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r5/evaluate";
import * as r6ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/fact-ledger";
import * as r6scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/scoring";
import * as r6gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/ground-truth";
import { scoreAnswer as scoreAnswerR6 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r6/evaluate";
import * as r7ledger from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import * as r7scoring from "../benchmarks/contract-officer-benchmark-v3/scoring";
import * as r7gt from "../benchmarks/contract-officer-benchmark-v3/ground-truth";
import { scoreAnswer } from "../benchmarks/contract-officer-benchmark-v3/evaluate";
import { buildCitationFamilies, buildEntityCitations } from "./officer-benchmark-v3-env";
import { localDate } from "../../src/lib/officer/time";

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = process.argv[2] ?? join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports", "2026-09-26T01-04-33-893Z-r5-gate.json");
const outPath = process.argv[3];
const report = JSON.parse(readFileSync(reportPath, "utf8"));

/** gap rows exactly as the model saw them in THIS run (same source the harness uses). */
function gapRowsFor(results: any[]): any[] {
  return results.flatMap((s: any) => (s.turns ?? []).flatMap((t: any) => (t.trace ?? [])
    .filter((x: any) => x.tool === "getEvidenceGaps" && x.ok)
    .flatMap((x: any) => { try { return JSON.parse(x.payload).data ?? []; } catch { return []; } })));
}

const hasUndefined = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x === undefined ? "__UNDEF__" : x)).includes("__UNDEF__") || /:undefined\b/.test(JSON.stringify(v));

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

function referenceDateFor(fx: any): { date: string | null; basis: string } {
  if (!fx?.today || !fx?.timezone || !report.ranAt) return { date: null, basis: "no seeded date / timezone / completion time" };
  const end = localDate(new Date(report.ranAt), fx.timezone);
  return end === fx.today
    ? { date: fx.today, basis: `fixture seeded ${fx.today}; run completed ${report.ranAt} = ${end} (${fx.timezone})` }
    : { date: null, basis: `seed ${fx.today} ≠ completion ${end} (${fx.timezone}) — day boundary crossed` };
}

function carriedLive(s: any, orgId: string | null, refDate: string | null) {
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
    orgId, referenceDate: refDate,
  };
}

const REVS = {
  r5: { mods: { ledger: r5ledger, scoring: r5scoring, gt: r5gt }, score: scoreAnswerR5 as typeof scoreAnswer },
  r6: { mods: { ledger: r6ledger, scoring: r6scoring, gt: r6gt }, score: scoreAnswerR6 as typeof scoreAnswer },
  r7: { mods: { ledger: r7ledger, scoring: r7scoring, gt: r7gt }, score: scoreAnswer },
};
const expsBy = (gt: any) => new Map<string, any>(gt.EXPECTATIONS.map((e: any) => [e.id, e]));

console.log(`full-gate re-score: ${reportPath.split("/").pop()} (recorded at revision ${report.provenance?.manifest?.revision}) · r5 parity → r6 frozen → r7`);

const rows: any[] = [];
let parityOk = true;
const parityDiffs: any[] = [];

for (const run of report.runs) {
  const persisted = run.fixtureIdentity;
  const fx: any = persisted
    ? { ...persisted, gapRows: gapRowsFor(run.results) }
    : null;
  if (!fx) { console.log(`run ${run.run ?? "?"}: NO persisted fixtureIdentity — cannot re-score`); continue; }
  const ref = referenceDateFor(fx);
  const entityToIds = buildEntityCitations(fx);
  const families = buildCitationFamilies(fx);

  for (const s of run.results) {
    const tag = `r${s.run} ${s.id}`;
    if (s.status !== "answered") {
      rows.push({ run: s.run, id: s.id, status: s.status });
      console.log(`${tag.padEnd(8)} ${String(s.status).toUpperCase()} — NOT ASSESSED (no saved answer)`);
      continue;
    }
    const turns = s.turns.map((t: any) => ({ ...t, citations: (t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })) }));
    const out: any = {};
    for (const key of ["r5", "r6", "r7"] as const) {
      const rev = REVS[key];
      const notAssessed: string[] = [];
      const exp = restrict(expsBy(rev.mods.gt).get(s.id), fx, notAssessed);
      const r = rev.score({
        mods: rev.mods, exp, fx, question: turns[0].question, turns,
        env: { entityMap: rev.mods.ledger.buildEntityMap(fx), entityToIds, families },
        live: carriedLive(s, fx.orgId, ref.date), r4: true,
      });
      r.notAssessed.push(...notAssessed);
      out[key] = r;
    }
    const live = [...s.productFailures, ...s.securityFailures].sort();
    const off = [...out.r5.productFailures, ...out.r5.securityFailures].sort();
    const parity = JSON.stringify(live) === JSON.stringify(off);
    if (!parity) {
      parityOk = false;
      parityDiffs.push({ run: s.run, id: s.id, liveOnly: live.filter((f) => !off.includes(f)), offlineOnly: off.filter((f) => !live.includes(f)) });
    }
    const r6f = [...out.r6.productFailures, ...out.r6.securityFailures];
    const r7f = [...out.r7.productFailures, ...out.r7.securityFailures];
    rows.push({
      run: s.run, id: s.id, status: "answered",
      liveR5: s.correctnessPass ? "PASS" : `FAIL(${live.length})`, parity,
      r6: out.r6.correctnessPass ? "PASS" : `FAIL(${r6f.length})`,
      r7: out.r7.correctnessPass ? "PASS" : `FAIL(${r7f.length})`,
      removed: live.filter((f: string) => !r7f.includes(f)),
      added: r7f.filter((f) => !live.includes(f)),
      r6Failures: r6f, r7Failures: r7f, r7Security: out.r7.securityFailures,
      notAssessed: out.r7.notAssessed,
      metrics: out.r7.metrics, referenceDate: ref.date,
    });
    console.log(`${tag.padEnd(8)} live r5 ${rows[rows.length - 1].liveR5.padEnd(8)} · parity ${parity ? "✓" : "✗"} · r6 ${rows[rows.length - 1].r6.padEnd(8)} · r7 ${rows[rows.length - 1].r7}`);
    for (const f of rows[rows.length - 1].removed) console.log(`         − ${f}`);
    for (const f of rows[rows.length - 1].added) console.log(`         + ${f}`);
    for (const n of rows[rows.length - 1].notAssessed) console.log(`         NOT ASSESSED ${n}`);
  }
}

const answered = rows.filter((r) => r.status === "answered");
const sum = (k: string) => answered.reduce((n, r) => n + (Number(r.metrics?.[k]) || 0), 0);
console.log(`\nscenario-runs: ${rows.length} · answered: ${answered.length} · not answered: ${rows.length - answered.length}`);
console.log(`parity with live r5: ${parityOk ? "ALL MATCH" : `MISMATCHES (${parityDiffs.length})`}`);
console.log(`r5 (live)      correct ${answered.filter((r) => r.liveR5 === "PASS").length}/${answered.length}`);
console.log(`r6 (re-scored) correct ${answered.filter((r) => r.r6 === "PASS").length}/${answered.length}`);
console.log(`r7 (re-scored) correct ${answered.filter((r) => r.r7 === "PASS").length}/${answered.length} · unsupported claims ${sum("unsupportedClaims")} · claim-citation support ${sum("claimSupportSatisfied")}/${sum("claimSupportTotal")} · security failures ${answered.reduce((n, r) => n + (r.r7Security?.length ?? 0), 0)}`);

if (outPath) {
  writeFileSync(outPath, JSON.stringify({
    source: reportPath.split("/").pop(),
    sourceRevision: report.provenance?.manifest?.revision,
    rescoreRevisions: [5, 6, 7], frozenEvaluatorsUnchanged: true,
    sourceRanAt: report.ranAt,
    scenarioRuns: rows.length, answered: answered.length,
    parityWithLiveR5: parityOk, parityDiffs,
    r5LiveCorrect: answered.filter((r) => r.liveR5 === "PASS").length,
    r6Correct: answered.filter((r) => r.r6 === "PASS").length,
    r7Correct: answered.filter((r) => r.r7 === "PASS").length,
    rows,
  }, null, 1));
  console.log(`\nwrote ${outPath}`);
}
