/**
 * V4 MATERIALITY DETECTOR — DEV RUN (development corpus only)
 *
 * The ONLY corpus the detector may be debugged against. heldout-v1.json is not
 * read by this file at all.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { segment } from "../benchmarks/evaluator-v4-proto/segment";
import { classifyMateriality, rollUp, type Materiality } from "../benchmarks/evaluator-v4-proto/materiality";

const here = dirname(fileURLToPath(import.meta.url));
const dev = JSON.parse(readFileSync(join(here, "..", "benchmarks", "evaluator-v4-proto", "materiality-dev-v1.json"), "utf8"));

type Case = { id: string; locale: string; construction: string; text: string; expected: Materiality; note?: string };
const cases: Case[] = dev.cases;

const rows = cases.map((c) => {
  const units = segment(c.text);
  const perUnit = units.map((u) => ({ u, r: classifyMateriality(u) }));
  const label = rollUp(perUnit.map((x) => x.r));
  return { c, label, perUnit, ok: label === c.expected };
});

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const mat = rows.filter((r) => r.c.expected === "MATERIAL_ASSERTION");
const non = rows.filter((r) => r.c.expected === "NON_MATERIAL");

console.log(`${dev.set} — ${dev.status}`);
console.log(`cases ${cases.length} · expected material ${mat.length} · non-material ${non.length} · uncertain ${rows.length - mat.length - non.length}\n`);

console.log("DEV RESULTS");
console.log(`  material recall         : ${mat.filter((r) => r.label === "MATERIAL_ASSERTION").length}/${mat.length}  ${pct(mat.filter((r) => r.label === "MATERIAL_ASSERTION").length, mat.length)}`);
console.log(`  material → NON_MATERIAL : ${mat.filter((r) => r.label === "NON_MATERIAL").length}   (unsafe misses)`);
console.log(`  material → UNCERTAIN    : ${mat.filter((r) => r.label === "UNCERTAIN").length}   (safe but not success)`);
console.log(`  non-material false alarm: ${non.filter((r) => r.label === "MATERIAL_ASSERTION").length}/${non.length}  ${pct(non.filter((r) => r.label === "MATERIAL_ASSERTION").length, non.length)}`);
console.log(`  overall agreement       : ${rows.filter((r) => r.ok).length}/${rows.length}  ${pct(rows.filter((r) => r.ok).length, rows.length)}\n`);

for (const loc of ["en", "ar", "mixed"]) {
  const rs = rows.filter((r) => r.c.locale === loc);
  const m = rs.filter((r) => r.c.expected === "MATERIAL_ASSERTION");
  console.log(`  ${loc.padEnd(6)} agreement ${String(rs.filter((r) => r.ok).length).padStart(2)}/${String(rs.length).padEnd(2)} ${pct(rs.filter((r) => r.ok).length, rs.length).padStart(6)} · material recall ${m.filter((r) => r.label === "MATERIAL_ASSERTION").length}/${m.length}`);
}

const bad = rows.filter((r) => !r.ok);
console.log(`\nDEV DISAGREEMENTS: ${bad.length}`);
for (const r of bad) {
  console.log(`  ✗ ${r.c.id} [${r.c.locale}] ${r.c.construction}`);
  console.log(`      text    : ${r.c.text.replace(/\n/g, " ⏎ ")}`);
  console.log(`      expected ${r.c.expected} · got ${r.label}`);
  for (const { u, r: res } of r.perUnit) console.log(`      unit "${u.text.slice(0, 60)}" → ${res.label} (${res.reason}) [${res.signals.join(",")}]`);
}

process.exitCode = bad.length ? 1 : 0;
