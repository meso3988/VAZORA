/**
 * BLIND HELDOUT-V2 — PHASE 1: PREDICT ONLY
 *
 * Runs the FROZEN materiality detector (commit 8928ced) over the approved blind
 * dataset and writes predictions to disk. This file never reads a gold label:
 * the dataset is projected to { id, text } before anything is classified, and
 * the projected records are the only input the detector sees.
 *
 * FORMAT ADAPTER (format-only, recorded before execution):
 *   • the approved file is a bare JSON array of case objects (earlier drafts
 *     wrapped them in { cases: [...] }), so the array is accepted directly;
 *   • each case is projected to { id, text } — every other field (materiality,
 *     dangerous, mustFormClaim, expectedClaimTypes, expectedEntityScope,
 *     expectedVerdict, family, semanticClass, factBag, rationale,
 *     arabicStructure, locale) is dropped before prediction;
 *   • no classification rule is added here.
 *
 * The detector interface takes a segmented unit; `locale` is NOT part of that
 * interface, so no locale is supplied. Segmentation and aggregation are the
 * frozen ones (segment() and rollUp()).
 *
 * AGGREGATION POLICY (frozen rollUp, documented, not modified):
 *   any unit MATERIAL_ASSERTION → case MATERIAL_ASSERTION
 *   else any unit UNCERTAIN     → case UNCERTAIN
 *   else                        → case NON_MATERIAL
 * Per-unit predictions are preserved in the output so a detected clause can
 * never conceal a missed clause.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-heldout-v2-predict.ts
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyMateriality, rollUp } from "../benchmarks/evaluator-v4-proto/materiality";
import { segment } from "../benchmarks/evaluator-v4-proto/segment";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const DATASET = process.env.HV2_DATASET ?? "/Users/mayasahaldashsh/heldout-v2-final.json";
const APPROVED_SHA = "0b94875366b86814cdf6f95689fe2a14d92f72d22a40a07ab268f553f81f8ac7";

const bytes = readFileSync(DATASET);
const datasetSha = createHash("sha256").update(bytes).digest("hex");
if (datasetSha !== APPROVED_SHA) {
  console.error(`BLOCKED: dataset sha256 ${datasetSha} != approved ${APPROVED_SHA}`);
  process.exit(2);
}

const detectorFiles = ["arabic.ts", "frames.ts", "materiality.ts", "segment.ts"] as const;
const detectorHashes: Record<string, string> = {};
for (const f of detectorFiles) {
  detectorHashes[f] = createHash("sha256").update(readFileSync(join(protoDir, f))).digest("hex");
}

// ---- projection: drop every field except id and text -----------------------
const parsed = JSON.parse(bytes.toString("utf8"));
const rawCases: unknown[] = Array.isArray(parsed) ? parsed : parsed.cases;
const projected: { id: string; text: string }[] = rawCases.map((r) => {
  const { id, text } = r as { id: string; text: string };
  return { id, text };
});
// nothing beyond id/text may reach the detector
Object.freeze(projected);

const predictions = projected.map(({ id, text }) => {
  const units = segment(text);
  const perUnit = units.map((u) => {
    const r = classifyMateriality(u);
    return {
      unitText: u.text,
      itemIndex: u.itemIndex,
      scope: u.scope,
      modality: u.modality,
      modalityCue: u.modalityCue,
      materiality: r.label,
      reason: r.reason,
      frames: r.frames,
      signals: r.signals,
    };
  });
  return {
    id,
    unitCount: units.length,
    perUnit,
    predictedMateriality: rollUp(perUnit.map((p) => ({ label: p.materiality, reason: p.reason, signals: p.signals, frames: p.frames }))),
  };
});

const out = {
  run: "frozen-materiality-detector-vs-blind-heldout-v2",
  ranAt: new Date().toISOString(),
  detectorCommit: "8928ced",
  detectorHashes,
  dataset: { path: DATASET, sha256: datasetSha, caseCount: projected.length },
  adapter: {
    name: "evaluator-v4-heldout-v2-predict.ts",
    kind: "format-only",
    notes: [
      "accepts a bare top-level JSON array of cases",
      "projects each case to { id, text }; all label/metadata fields dropped before prediction",
      "no locale passed: the frozen detector interface does not accept one",
      "frozen segment() for segmentation and frozen rollUp() for aggregation",
      "no classification logic added",
    ],
  },
  aggregationPolicy: "any unit MATERIAL_ASSERTION -> MATERIAL_ASSERTION; else any UNCERTAIN -> UNCERTAIN; else NON_MATERIAL",
  predictions,
};

const reportsDir = join(protoDir, "reports");
mkdirSync(reportsDir, { recursive: true });
const stamp = out.ranAt.replace(/[:.]/g, "-");
const file = join(reportsDir, `${stamp}-heldout-v2-predictions.json`);
writeFileSync(file, JSON.stringify(out, null, 2));

const tally = predictions.reduce<Record<string, number>>((acc, p) => {
  acc[p.predictedMateriality] = (acc[p.predictedMateriality] ?? 0) + 1;
  return acc;
}, {});
console.log(`dataset sha256 VERIFIED ${datasetSha}`);
for (const f of detectorFiles) console.log(`detector ${f} ${detectorHashes[f]}`);
console.log(`cases predicted: ${predictions.length}`);
console.log(`prediction tally (no gold labels consulted): ${JSON.stringify(tally)}`);
console.log(`units total: ${predictions.reduce((n, p) => n + p.unitCount, 0)}`);
console.log(`predictions saved: ${file}`);
