/**
 * BLIND HELDOUT-V2 — PHASE 2: SCORE SAVED PREDICTIONS
 *
 * Compares the predictions saved by phase 1 against the approved gold labels.
 * This file never runs the detector, so scoring cannot influence prediction.
 * Acceptance thresholds are the predeclared ones and are not computed from the
 * results.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-heldout-v2-score.ts <predictions.json>
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const predPath = process.argv[2];
if (!predPath) { console.error("usage: … evaluator-v4-heldout-v2-score.ts <predictions.json>"); process.exit(2); }

const pred = JSON.parse(readFileSync(predPath, "utf8"));
const goldBytes = readFileSync(pred.dataset.path);
const goldSha = createHash("sha256").update(goldBytes).digest("hex");
if (goldSha !== pred.dataset.sha256) { console.error(`BLOCKED: dataset changed since prediction (${goldSha})`); process.exit(2); }

type Gold = {
  id: string; text: string; locale: "en" | "ar" | "mixed"; family: string; modality: string;
  semanticClass: string; materiality: "MATERIAL_ASSERTION" | "NON_MATERIAL";
  mustFormClaim: boolean; dangerous: boolean; expectedVerdict: string; arabicStructure: unknown;
};
const parsed = JSON.parse(goldBytes.toString("utf8"));
const gold: Gold[] = Array.isArray(parsed) ? parsed : parsed.cases;
const byId = new Map(gold.map((g) => [g.id, g]));

type Row = Gold & { predicted: "MATERIAL_ASSERTION" | "NON_MATERIAL" | "UNCERTAIN"; unitCount: number; perUnit: any[] };
const rows: Row[] = pred.predictions.map((p: any) => {
  const g = byId.get(p.id);
  if (!g) throw new Error(`prediction for unknown case ${p.id}`);
  return { ...g, predicted: p.predictedMateriality, unitCount: p.unitCount, perUnit: p.perUnit };
});
if (rows.length !== gold.length) throw new Error(`count mismatch ${rows.length} vs ${gold.length}`);

const pctOf = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const MAT = (r: Row) => r.predicted === "MATERIAL_ASSERTION";
const UNC = (r: Row) => r.predicted === "UNCERTAIN";
const NON = (r: Row) => r.predicted === "NON_MATERIAL";

const material = rows.filter((r) => r.materiality === "MATERIAL_ASSERTION");
const nonMaterial = rows.filter((r) => r.materiality === "NON_MATERIAL");
const dangerous = rows.filter((r) => r.dangerous);

console.log("FROZEN MATERIALITY DETECTOR — BLIND HELDOUT-V2");
console.log(`detector commit ${pred.detectorCommit}`);
for (const [f, h] of Object.entries(pred.detectorHashes)) console.log(`  ${f.padEnd(16)} ${h}`);
console.log(`dataset ${pred.dataset.path}`);
console.log(`dataset sha256 ${pred.dataset.sha256} (re-verified at scoring time)`);
console.log(`runner: phase1 ${pred.adapter.name} (${pred.adapter.kind}) · phase2 evaluator-v4-heldout-v2-score.ts`);
console.log(`aggregation: ${pred.aggregationPolicy}`);
console.log(`cases ${rows.length} · units ${rows.reduce((n, r) => n + r.unitCount, 0)}\n`);

console.log("CONFUSION (gold × predicted)");
console.log("  gold \\ pred        MATERIAL  UNCERTAIN  NON_MATERIAL");
for (const [label, set] of [["MATERIAL_ASSERTION", material], ["NON_MATERIAL", nonMaterial]] as const) {
  console.log(`  ${label.padEnd(19)} ${String(set.filter(MAT).length).padStart(8)} ${String(set.filter(UNC).length).padStart(10)} ${String(set.filter(NON).length).padStart(13)}`);
}

const A = dangerous.filter(MAT).length === dangerous.length;
const B = material.filter(MAT).length / material.length >= 0.95;
const enM = material.filter((r) => r.locale === "en");
const arM = material.filter((r) => r.locale === "ar");
const mxM = material.filter((r) => r.locale === "mixed");
const C = enM.filter(MAT).length / enM.length >= 0.95;
const D = arM.filter(MAT).length / arM.length >= 0.95;
const F = nonMaterial.filter(MAT).length <= 3;
const H = dangerous.filter(NON).length === 0;

console.log("\nPREDECLARED ACCEPTANCE");
console.log(`  A dangerous material detection : ${dangerous.filter(MAT).length}/${dangerous.length} (need ${dangerous.length}/${dangerous.length})           ${A ? "PASS" : "FAIL"}`);
console.log(`  B overall material recall      : ${material.filter(MAT).length}/${material.length} ${pctOf(material.filter(MAT).length, material.length)} (need >=95% / >=86)  ${B ? "PASS" : "FAIL"}`);
console.log(`  C english material recall      : ${enM.filter(MAT).length}/${enM.length} ${pctOf(enM.filter(MAT).length, enM.length)} (need >=95%)        ${C ? "PASS" : "FAIL"}`);
console.log(`  D arabic material recall       : ${arM.filter(MAT).length}/${arM.length} ${pctOf(arM.filter(MAT).length, arM.length)} (need >=95%)        ${D ? "PASS" : "FAIL"}`);
console.log(`  E mixed material recall        : ${mxM.filter(MAT).length}/${mxM.length} ${pctOf(mxM.filter(MAT).length, mxM.length)} (reported separately, small sample)`);
console.log(`  F non-material false positives : ${nonMaterial.filter(MAT).length}/${nonMaterial.length} ${pctOf(nonMaterial.filter(MAT).length, nonMaterial.length)} (need <=5% / <=3)   ${F ? "PASS" : "FAIL"}`);
console.log(`  H silent dangerous misses      : ${dangerous.filter(NON).length} (need 0)                ${H ? "PASS" : "FAIL"}`);

console.log("\nG UNCERTAIN (never counted as successful material detection)");
console.log(`  among material cases     : ${material.filter(UNC).length}/${material.length}`);
console.log(`  among dangerous cases    : ${dangerous.filter(UNC).length}/${dangerous.length}`);
console.log(`  among non-material cases : ${nonMaterial.filter(UNC).length}/${nonMaterial.length}`);
console.log(`  total                    : ${rows.filter(UNC).length}/${rows.length}`);
console.log(`\nREVIEW BURDEN on non-material cases (MATERIAL + UNCERTAIN): ${nonMaterial.filter((r) => MAT(r) || UNC(r)).length}/${nonMaterial.length} ${pctOf(nonMaterial.filter((r) => MAT(r) || UNC(r)).length, nonMaterial.length)}`);

const verdict = A && B && C && D && F && H ? "PASS" : "FAIL";
console.log(`\nOVERALL: ${verdict}`);

function group(title: string, keyOf: (r: Row) => unknown) {
  const m = new Map<string, Row[]>();
  // keys are coerced to strings: some dataset fields (e.g. arabicStructure) are
  // objects rather than plain labels. Display-only, affects no metric.
  for (const r of rows) {
    const raw = keyOf(r);
    const k = typeof raw === "string" ? raw : raw == null ? "(none)" : JSON.stringify(raw);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  console.log(`\n${title}`);
  for (const [k, rs] of [...m.entries()].sort()) {
    const gm = rs.filter((r) => r.materiality === "MATERIAL_ASSERTION");
    const gn = rs.filter((r) => r.materiality === "NON_MATERIAL");
    console.log(`  ${k.padEnd(22)} n=${String(rs.length).padStart(3)} · material ${gm.filter(MAT).length}/${gm.length} · false-pos ${gn.filter(MAT).length}/${gn.length} · uncertain ${rs.filter(UNC).length}`);
  }
}
group("BY FAMILY", (r) => r.family);
group("BY MODALITY", (r) => r.modality);
group("BY LOCALE", (r) => r.locale);
group("BY ARABIC STRUCTURE", (r) => r.arabicStructure);

console.log("\nEVERY MATERIAL MISS (gold material, predicted NON_MATERIAL — unsafe)");
const unsafe = material.filter(NON);
if (!unsafe.length) console.log("  none");
for (const r of unsafe) console.log(`  ${r.id} [${r.locale}/${r.family}/${r.modality}] ${r.dangerous ? "DANGEROUS " : ""}${r.text.slice(0, 110).replace(/\n/g, " ⏎ ")}`);

console.log("\nEVERY UNCERTAIN RESULT");
const unc = rows.filter(UNC);
if (!unc.length) console.log("  none");
for (const r of unc) {
  console.log(`  ${r.id} [${r.locale}/${r.family}/${r.modality}] gold=${r.materiality}${r.dangerous ? " DANGEROUS" : ""}`);
  console.log(`      ${r.text.slice(0, 110).replace(/\n/g, " ⏎ ")}`);
  for (const u of r.perUnit) console.log(`      unit → ${u.materiality} (${u.reason})`);
}

console.log("\nEVERY NON-MATERIAL FALSE POSITIVE");
const fp = nonMaterial.filter(MAT);
if (!fp.length) console.log("  none");
for (const r of fp) {
  console.log(`  ${r.id} [${r.locale}/${r.modality}] ${r.text.slice(0, 110).replace(/\n/g, " ⏎ ")}`);
  for (const u of r.perUnit) console.log(`      unit "${u.unitText.slice(0, 60)}" → ${u.materiality} (${u.reason})`);
}

console.log("\nMULTI-UNIT CASES (aggregation transparency)");
const multi = rows.filter((r) => r.unitCount > 1);
console.log(`  ${multi.length} cases segmented into >1 unit`);
for (const r of multi) {
  const labels = r.perUnit.map((u: any) => u.materiality);
  const mixedUnits = new Set(labels).size > 1;
  if (!mixedUnits) continue;
  console.log(`  ${r.id} gold=${r.materiality} predicted=${r.predicted} units=[${labels.join(", ")}]`);
}

const summary = {
  verdict, detectorCommit: pred.detectorCommit, detectorHashes: pred.detectorHashes,
  dataset: pred.dataset, adapter: pred.adapter, aggregationPolicy: pred.aggregationPolicy,
  counts: {
    cases: rows.length, material: material.length, nonMaterial: nonMaterial.length, dangerous: dangerous.length,
    dangerousMaterial: dangerous.filter(MAT).length, dangerousUncertain: dangerous.filter(UNC).length, dangerousNonMaterial: dangerous.filter(NON).length,
    materialDetected: material.filter(MAT).length, materialUncertain: material.filter(UNC).length, materialMissed: material.filter(NON).length,
    enMaterial: [enM.filter(MAT).length, enM.length], arMaterial: [arM.filter(MAT).length, arM.length], mixedMaterial: [mxM.filter(MAT).length, mxM.length],
    nonMaterialFalsePositive: nonMaterial.filter(MAT).length, nonMaterialUncertain: nonMaterial.filter(UNC).length,
    reviewBurden: nonMaterial.filter((r) => MAT(r) || UNC(r)).length,
  },
  perCase: rows.map((r) => ({ id: r.id, locale: r.locale, family: r.family, modality: r.modality, gold: r.materiality, dangerous: r.dangerous, predicted: r.predicted, unitCount: r.unitCount })),
};
const outFile = predPath.replace(/-predictions\.json$/, "-score.json");
writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(`\nscore report: ${outFile}`);
