/**
 * EVALUATOR V4 — HELD-OUT SEMANTIC BASELINE (read-only)
 *
 * Measures the CURRENT prototype against the permanently held-out set, with no
 * change to the prototype. Publishes claim-detection recall, dangerous-claim
 * recall, the false-positive rate on non-material units, and the proposed
 * NO_CLAIM_FORMED criterion.
 *
 * NO_CLAIM_FORMED (designed here, NOT implemented in production):
 *   for every material assertion unit, if expectedClaimTypes.length > 0 and the
 *   detector forms zero claims → NO_CLAIM_FORMED. Non-assertions never trigger
 *   it. A future gate must treat NO_CLAIM_FORMED as a hard recall failure, so
 *   silent non-detection can never be mistaken for a clean answer.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-heldout-baseline.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { allEntities, segment } from "../benchmarks/evaluator-v4-proto/segment";
import { aggregate, claimsForUnit, RecordBag, type Claim, type Verdict } from "../benchmarks/evaluator-v4-proto/claims";

const here = dirname(fileURLToPath(import.meta.url));
const set = JSON.parse(readFileSync(join(here, "..", "benchmarks", "evaluator-v4-proto", "heldout-v1.json"), "utf8"));

type Case = {
  id: string; family: string; locale: string; class: string; modality: string;
  materiality: "material" | "non-material"; mustFormClaim: boolean; dangerous: boolean;
  text: string; facts: Record<string, unknown>;
  expectedClaimTypes: string[]; expectedScope: string[]; expectedVerdict: Verdict;
  arabicStructure?: string;
};

const cases: Case[] = set.cases;

type Result = {
  c: Case; claims: Claim[]; verdict: Verdict; detected: boolean;
  noClaimFormed: boolean; verdictAgrees: boolean; typeHit: boolean;
};

const results: Result[] = cases.map((c) => {
  const units = segment(c.text);
  const bag = new RecordBag(c.facts, allEntities(c.text));
  const claims = units.flatMap((u) => claimsForUnit(u, bag));
  const scored = claims.filter((x) => x.verdict !== "OUT_OF_SCOPE");
  const verdict = aggregate(claims);
  const detected = scored.length > 0;
  return {
    c, claims, verdict, detected,
    noClaimFormed: c.materiality === "material" && c.expectedClaimTypes.length > 0 && !detected,
    verdictAgrees: verdict === c.expectedVerdict,
    typeHit: c.expectedClaimTypes.length === 0 ? !detected : claims.some((x) => c.expectedClaimTypes.includes(x.type)),
  };
});

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const material = results.filter((r) => r.c.materiality === "material" && r.c.expectedClaimTypes.length > 0);
const nonMaterial = results.filter((r) => r.c.materiality === "non-material");
const dangerous = results.filter((r) => r.c.dangerous);
const failedVerdict = (v: Verdict) => v === "CONTRADICTED" || v === "INSUFFICIENT_EVIDENCE";

console.log(`${set.set} — ${set.status}`);
console.log(`cases ${cases.length} · material ${material.length} · non-material ${nonMaterial.length} · dangerous ${dangerous.length}\n`);

console.log("COMPOSITION");
for (const key of ["locale", "family", "modality", "class"] as const) {
  const m = new Map<string, number>();
  for (const c of cases) m.set(String(c[key]), (m.get(String(c[key])) ?? 0) + 1);
  console.log(`  by ${key}: ${[...m.entries()].sort().map(([k, n]) => `${k}=${n}`).join(" · ")}`);
}
const verdictDist = new Map<string, number>();
for (const c of cases) verdictDist.set(c.expectedVerdict, (verdictDist.get(c.expectedVerdict) ?? 0) + 1);
console.log(`  by expected verdict: ${[...verdictDist.entries()].sort().map(([k, n]) => `${k}=${n}`).join(" · ")}`);
console.log(`  arabic structures tagged: ${cases.filter((c) => c.arabicStructure).length}\n`);

console.log("BASELINE — CURRENT PROTOTYPE, UNCHANGED");
console.log(`  claim-detection recall (material)    : ${material.filter((r) => r.detected).length}/${material.length}  ${pct(material.filter((r) => r.detected).length, material.length)}`);
console.log(`  correct claim TYPE formed            : ${material.filter((r) => r.typeHit).length}/${material.length}  ${pct(material.filter((r) => r.typeHit).length, material.length)}`);
console.log(`  dangerous-claim detection recall     : ${dangerous.filter((r) => r.detected).length}/${dangerous.length}  ${pct(dangerous.filter((r) => r.detected).length, dangerous.length)}`);
console.log(`  dangerous correctly REJECTED         : ${dangerous.filter((r) => failedVerdict(r.verdict)).length}/${dangerous.length}  ${pct(dangerous.filter((r) => failedVerdict(r.verdict)).length, dangerous.length)}`);
console.log(`  NO_CLAIM_FORMED                      : ${results.filter((r) => r.noClaimFormed).length}`);
console.log(`  false positives on non-material      : ${nonMaterial.filter((r) => failedVerdict(r.verdict)).length}/${nonMaterial.length}  ${pct(nonMaterial.filter((r) => failedVerdict(r.verdict)).length, nonMaterial.length)}`);
console.log(`  overall verdict agreement            : ${results.filter((r) => r.verdictAgrees).length}/${results.length}  ${pct(results.filter((r) => r.verdictAgrees).length, results.length)}\n`);

function group(label: string, keyOf: (r: Result) => string) {
  const m = new Map<string, Result[]>();
  for (const r of results) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(r);
  }
  console.log(label);
  for (const [k, rs] of [...m.entries()].sort()) {
    const mat = rs.filter((r) => r.c.materiality === "material" && r.c.expectedClaimTypes.length > 0);
    console.log(
      `  ${k.padEnd(18)} verdict ${String(rs.filter((r) => r.verdictAgrees).length).padStart(2)}/${String(rs.length).padEnd(2)} ${pct(rs.filter((r) => r.verdictAgrees).length, rs.length).padStart(6)}` +
      `   detection ${String(mat.filter((r) => r.detected).length).padStart(2)}/${String(mat.length).padEnd(2)} ${pct(mat.filter((r) => r.detected).length, mat.length).padStart(6)}`,
    );
  }
  console.log();
}
group("BY LOCALE", (r) => r.c.locale);
group("BY MODALITY", (r) => r.c.modality);
group("BY CLAIM FAMILY", (r) => r.c.family);

console.log("EVERY DANGEROUS MISS (dangerous case not correctly rejected)");
const dangerMisses = dangerous.filter((r) => !failedVerdict(r.verdict));
for (const r of dangerMisses) {
  console.log(`  ✗ ${r.c.id} [${r.c.locale}] ${r.c.family}`);
  console.log(`      text    : ${r.c.text.replace(/\n/g, " ⏎ ")}`);
  console.log(`      expected: ${r.c.expectedVerdict} via ${r.c.expectedClaimTypes.join("/")}`);
  console.log(`      got     : ${r.verdict}${r.noClaimFormed ? "  ← NO_CLAIM_FORMED" : ""} claims=[${r.claims.map((c) => `${c.type}:${c.verdict}`).join(",") || "none"}]`);
}
console.log(`  dangerous misses: ${dangerMisses.length}/${dangerous.length}\n`);

console.log("ALL NO_CLAIM_FORMED CASES (silent non-detection on material assertions)");
for (const r of results.filter((x) => x.noClaimFormed)) {
  console.log(`  ${r.c.id} [${r.c.locale}] ${r.c.dangerous ? "DANGEROUS " : ""}${r.c.family} — expected ${r.c.expectedClaimTypes.join("/")} · ${r.c.text.slice(0, 70).replace(/\n/g, " ⏎ ")}`);
}
console.log();

console.log("NON-MATERIAL FALSE POSITIVES (must stay clean)");
const nmFp = nonMaterial.filter((r) => failedVerdict(r.verdict));
if (!nmFp.length) console.log("  none");
for (const r of nmFp) console.log(`  ${r.c.id} got ${r.verdict} claims=[${r.claims.map((c) => `${c.type}:${c.verdict}`).join(",")}]`);

console.log("\nBASELINE IS IMMUTABLE EVIDENCE — the prototype was not modified for this run.");
