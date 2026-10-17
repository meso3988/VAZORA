/**
 * V4 MATERIALITY DETECTOR — DEV RUN (development corpora only)
 *
 * Runs materiality-dev-v1 (regression) and materiality-dev-v2 (fresh probes for
 * the morphology + predicate-frame stage). heldout-v1.json is not read here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { segment } from "../benchmarks/evaluator-v4-proto/segment";
import { claimObligation, classifyMateriality, rollUp, type Materiality } from "../benchmarks/evaluator-v4-proto/materiality";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));

type Case = {
  id: string; locale: string; text: string; expected: Materiality;
  construction?: string; frame?: string; dangerous?: boolean;
};

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

function run(setFile: string) {
  const set = load(setFile);
  const cases: Case[] = set.cases;
  const rows = cases.map((c) => {
    const units = segment(c.text);
    const perUnit = units.map((u) => ({ u, r: classifyMateriality(u) }));
    const label = rollUp(perUnit.map((x) => x.r));
    return { c, label, perUnit, ok: label === c.expected };
  });

  const mat = rows.filter((r) => r.c.expected === "MATERIAL_ASSERTION");
  const non = rows.filter((r) => r.c.expected === "NON_MATERIAL");
  const dang = rows.filter((r) => r.c.dangerous);
  const isMat = (r: (typeof rows)[number]) => r.label === "MATERIAL_ASSERTION";

  console.log(`\n================ ${set.set} ================`);
  console.log(`cases ${cases.length} · material ${mat.length} · non-material ${non.length} · dangerous-tagged ${dang.length}`);
  console.log(`  material recall          : ${mat.filter(isMat).length}/${mat.length}  ${pct(mat.filter(isMat).length, mat.length)}`);
  console.log(`  material → NON_MATERIAL  : ${mat.filter((r) => r.label === "NON_MATERIAL").length}   (UNSAFE)`);
  console.log(`  material → UNCERTAIN     : ${mat.filter((r) => r.label === "UNCERTAIN").length}   (fail-safe, not success)`);
  if (dang.length) {
    console.log(`  dangerous recall         : ${dang.filter(isMat).length}/${dang.length}  ${pct(dang.filter(isMat).length, dang.length)}`);
    console.log(`  dangerous → NON_MATERIAL : ${dang.filter((r) => r.label === "NON_MATERIAL").length}   (UNSAFE)`);
  }
  console.log(`  non-material false alarm : ${non.filter(isMat).length}/${non.length}  ${pct(non.filter(isMat).length, non.length)}`);
  console.log(`  UNCERTAIN rate (all)     : ${rows.filter((r) => r.label === "UNCERTAIN").length}/${rows.length}  ${pct(rows.filter((r) => r.label === "UNCERTAIN").length, rows.length)}`);
  console.log(`  overall agreement        : ${rows.filter((r) => r.ok).length}/${rows.length}  ${pct(rows.filter((r) => r.ok).length, rows.length)}`);

  console.log("  by locale:");
  for (const loc of ["en", "ar", "mixed"]) {
    const rs = rows.filter((r) => r.c.locale === loc);
    if (!rs.length) continue;
    const m = rs.filter((r) => r.c.expected === "MATERIAL_ASSERTION");
    const n = rs.filter((r) => r.c.expected === "NON_MATERIAL");
    console.log(`    ${loc.padEnd(6)} agreement ${String(rs.filter((r) => r.ok).length).padStart(2)}/${String(rs.length).padEnd(3)} ${pct(rs.filter((r) => r.ok).length, rs.length).padStart(6)} · material ${m.filter(isMat).length}/${m.length} · false alarms ${n.filter(isMat).length}/${n.length}`);
  }

  const frames = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.c.frame ?? r.c.construction ?? "unlabelled";
    if (!frames.has(k)) frames.set(k, []);
    frames.get(k)!.push(r);
  }
  if ([...frames.keys()].some((k) => /^[A-H]$|modality/.test(k))) {
    console.log("  by frame:");
    for (const [k, rs] of [...frames.entries()].sort()) {
      const m = rs.filter((r) => r.c.expected === "MATERIAL_ASSERTION");
      console.log(`    ${k.padEnd(10)} agreement ${String(rs.filter((r) => r.ok).length).padStart(2)}/${String(rs.length).padEnd(2)} · material ${m.filter(isMat).length}/${m.length}`);
    }
  }

  const bad = rows.filter((r) => !r.ok);
  console.log(`  DISAGREEMENTS: ${bad.length}`);
  for (const r of bad) {
    console.log(`    ✗ ${r.c.id} [${r.c.locale}] ${r.c.frame ?? r.c.construction ?? ""}`);
    console.log(`        text    : ${r.c.text.replace(/\n/g, " ⏎ ")}`);
    console.log(`        expected ${r.c.expected} · got ${r.label} · obligation(0 claims)=${claimObligation(r.label, 0)}`);
    for (const { u, r: res } of r.perUnit) console.log(`        unit "${u.text.slice(0, 58)}" → ${res.label} (${res.reason}) frames=[${res.frames.join(",")}]`);
  }
  return bad.length;
}

const bad = run("materiality-dev-v1.json") + run("materiality-dev-v2.json");
console.log(`\nTOTAL DEV DISAGREEMENTS: ${bad}`);
process.exitCode = bad ? 1 : 0;
