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
import { claimObligation, classifyMateriality, rollUp, type ClaimObligation, type Materiality } from "../benchmarks/evaluator-v4-proto/materiality";

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
  materiality: Materiality; obligation: ClaimObligation;
};

const results: Result[] = cases.map((c) => {
  const units = segment(c.text);
  const bag = new RecordBag(c.facts, allEntities(c.text));
  const claims = units.flatMap((u) => claimsForUnit(u, bag));
  const scored = claims.filter((x) => x.verdict !== "OUT_OF_SCOPE");
  const verdict = aggregate(claims);
  const detected = scored.length > 0;
  const materiality = rollUp(units.map((u) => classifyMateriality(u)));
  return {
    c, claims, verdict, detected, materiality,
    obligation: claimObligation(materiality, scored.length),
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

// ---------------------------------------------------------------------------
// MATERIALITY DETECTOR — single frozen-heldout evaluation
// ---------------------------------------------------------------------------
const matExpected = results.filter((r) => r.c.materiality === "material");
const nonExpected = results.filter((r) => r.c.materiality === "non-material");
const isMat = (r: Result) => r.materiality === "MATERIAL_ASSERTION";

console.log("\n==================== MATERIALITY DETECTOR ON FROZEN HELDOUT ====================");
console.log(`  material recall (MATERIAL_ASSERTION) : ${matExpected.filter(isMat).length}/${matExpected.length}  ${pct(matExpected.filter(isMat).length, matExpected.length)}`);
console.log(`  material → UNCERTAIN (safe, not success): ${matExpected.filter((r) => r.materiality === "UNCERTAIN").length}`);
console.log(`  material → NON_MATERIAL (UNSAFE MISS)   : ${matExpected.filter((r) => r.materiality === "NON_MATERIAL").length}`);
console.log(`  dangerous recall                        : ${dangerous.filter(isMat).length}/${dangerous.length}  ${pct(dangerous.filter(isMat).length, dangerous.length)}`);
console.log(`  dangerous → UNCERTAIN                   : ${dangerous.filter((r) => r.materiality === "UNCERTAIN").length}`);
console.log(`  dangerous → NON_MATERIAL (UNSAFE)       : ${dangerous.filter((r) => r.materiality === "NON_MATERIAL").length}`);
console.log(`  non-material false alarms               : ${nonExpected.filter(isMat).length}/${nonExpected.length}  ${pct(nonExpected.filter(isMat).length, nonExpected.length)}`);
console.log(`  total UNCERTAIN                         : ${results.filter((r) => r.materiality === "UNCERTAIN").length}`);

for (const loc of ["en", "ar", "mixed"]) {
  const m = matExpected.filter((r) => r.c.locale === loc);
  const n = nonExpected.filter((r) => r.c.locale === loc);
  console.log(`  ${loc.padEnd(6)} material recall ${String(m.filter(isMat).length).padStart(2)}/${String(m.length).padEnd(2)} ${pct(m.filter(isMat).length, m.length).padStart(6)} · false alarms ${n.filter(isMat).length}/${n.length}`);
}

const qc = results.filter((r) => r.c.modality === "QUESTION" || r.c.modality === "CONDITIONAL");
console.log(`  questions + conditionals kept non-material: ${qc.filter((r) => r.materiality === "NON_MATERIAL").length}/${qc.length}`);

console.log("\nCLAIM-OBLIGATION CONTRACT");
const obl = new Map<string, number>();
for (const r of results) obl.set(r.obligation, (obl.get(r.obligation) ?? 0) + 1);
for (const [k, n] of [...obl.entries()].sort()) console.log(`  ${k.padEnd(24)} ${n}`);

console.log("\nTHE 14 PREVIOUS DANGEROUS MISSES UNDER THE CONTRACT (must never be a silent pass)");
for (const r of dangerMisses) {
  console.log(`  ${r.c.id.padEnd(5)} materiality=${r.materiality.padEnd(19)} → ${r.obligation}`);
}
const silent = dangerMisses.filter((r) => r.obligation === "NOT_REQUIRED" || r.obligation === "OK");
console.log(`  silent passes among them: ${silent.length}${silent.length ? " — " + silent.map((r) => r.c.id).join(",") : ""}`);

console.log("\nMATERIAL CASES CLASSIFIED NON_MATERIAL (unsafe misses, if any)");
const unsafe = matExpected.filter((r) => r.materiality === "NON_MATERIAL");
if (!unsafe.length) console.log("  none");
for (const r of unsafe) console.log(`  ${r.c.id} [${r.c.locale}] ${r.c.dangerous ? "DANGEROUS " : ""}${r.c.family} — ${r.c.text.slice(0, 80).replace(/\n/g, " ⏎ ")}`);

console.log("\nUNCERTAIN CASES");
const unc = results.filter((r) => r.materiality === "UNCERTAIN");
if (!unc.length) console.log("  none");
for (const r of unc) console.log(`  ${r.c.id} [${r.c.locale}] expected-materiality=${r.c.materiality} → ${r.obligation} — ${r.c.text.slice(0, 70).replace(/\n/g, " ⏎ ")}`);

console.log("\nNON-MATERIAL FALSE ALARMS (detector said MATERIAL)");
const fa = nonExpected.filter(isMat);
if (!fa.length) console.log("  none");
for (const r of fa) console.log(`  ${r.c.id} [${r.c.locale}] ${r.c.class} — ${r.c.text.slice(0, 80)}`);

console.log("\nBASELINE IS IMMUTABLE EVIDENCE — the claims prototype was not modified for this run.");
