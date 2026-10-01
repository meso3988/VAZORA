/**
 * EVALUATOR V4 — OFFLINE PROOF OF ARCHITECTURE (read-only runner)
 *
 * Executes the prototype (segmentation + modality + minimal typed claims)
 * against the committed gold corpus and prints a confusion matrix. No model
 * calls, no database, no product import, no v3 evaluator import — the frozen
 * r10 artifacts are only READ for a hash check and never written.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-proof.ts
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { allEntities, segment } from "../benchmarks/evaluator-v4-proto/segment";
import { aggregate, claimsForUnit, RecordBag, type Claim, type Verdict } from "../benchmarks/evaluator-v4-proto/claims";

const here = dirname(fileURLToPath(import.meta.url));
const benchDir = join(here, "..", "benchmarks", "contract-officer-benchmark-v3");
const corpus = JSON.parse(readFileSync(join(benchDir, "gold-corpus.json"), "utf8"));

type Entry = {
  id: string;
  locale: string;
  class: string;
  excerpt?: string;
  recordFacts?: Record<string, unknown>;
  expected: Verdict;
  firstSeen?: string;
  source?: string;
  mustStillFail?: boolean;
  group?: string;
};

const entries: Entry[] = [
  ...corpus.provenEvaluatorFalsePositives.map((e: Entry) => ({ ...e, group: "false_positive" })),
  ...corpus.genuineHistoricalDefects.map((e: Entry) => ({ ...e, group: "genuine_defect" })),
  ...corpus.counterexamplesThatMustStillFail.map((e: Entry) => ({ ...e, group: "counterexample" })),
];

/** Entries the SEMANTIC layer must not adjudicate: deterministic invariants or
 *  family summaries with no single prose excerpt. Deferred, never silently passed. */
function deferralReason(e: Entry): string | null {
  if (!e.excerpt) return "no prose excerpt — structural/deterministic defect, owned by the hard-invariant layer";
  if (/^\(/.test(e.excerpt.trim())) return "excerpt is a description of a non-prose condition — hard-invariant layer";
  if (!e.recordFacts) return "no record facts — not a semantic claim";
  return null;
}

type Row = {
  entry: Entry;
  verdict: Verdict | "DEFERRED";
  agree: boolean;
  claims: Claim[];
  modalities: string[];
  deferred: string | null;
};

const rows: Row[] = [];

for (const e of entries) {
  const deferred = deferralReason(e);
  if (deferred) {
    rows.push({ entry: e, verdict: "DEFERRED", agree: false, claims: [], modalities: [], deferred });
    continue;
  }
  const text = e.excerpt!;
  const units = segment(text);
  const bag = new RecordBag(e.recordFacts!, allEntities(text));
  const claims = units.flatMap((u) => claimsForUnit(u, bag));
  const verdict = aggregate(claims);
  rows.push({
    entry: e,
    verdict,
    agree: verdict === e.expected,
    claims,
    modalities: Array.from(new Set(units.map((u) => u.modality))),
    deferred: null,
  });
}

// ---------------------------------------------------------------------------
// Confusion matrix
// ---------------------------------------------------------------------------
const runnable = rows.filter((r) => !r.deferred);
const deferred = rows.filter((r) => r.deferred);

/** A "defect" entry is one whose correct outcome is a failure (CONTRADICTED /
 *  INSUFFICIENT_EVIDENCE); a "correct answer" entry is SUPPORTED / NON_ASSERTION. */
const isDefectLabel = (v: Verdict) => v === "CONTRADICTED" || v === "INSUFFICIENT_EVIDENCE";
const failed = (v: Verdict | "DEFERRED") => v === "CONTRADICTED" || v === "INSUFFICIENT_EVIDENCE";

let defectCaught = 0, defectMissed = 0, falselyFailed = 0, correctlyAccepted = 0;
for (const r of runnable) {
  if (isDefectLabel(r.entry.expected)) { if (failed(r.verdict)) defectCaught++; else defectMissed++; }
  else { if (failed(r.verdict)) falselyFailed++; else correctlyAccepted++; }
}

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

console.log("EVALUATOR V4 OFFLINE PROOF — corpus:", corpus.corpus);
console.log(`entries total ${rows.length} · runnable ${runnable.length} · deferred to invariants ${deferred.length}\n`);

console.log("CONFUSION MATRIX (runnable prose entries)");
console.log(`  genuine defect caught        : ${defectCaught}`);
console.log(`  genuine defect missed        : ${defectMissed}`);
console.log(`  correct answer falsely failed: ${falselyFailed}`);
console.log(`  correct answer accepted      : ${correctlyAccepted}`);
console.log(`  overall agreement            : ${runnable.filter(r=>r.agree).length}/${runnable.length} (${pct(runnable.filter(r=>r.agree).length, runnable.length)})\n`);

function breakdown(label: string, keyOf: (r: Row) => string) {
  const groups = new Map<string, Row[]>();
  for (const r of runnable) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  console.log(label);
  for (const [k, rs] of [...groups.entries()].sort()) {
    const ok = rs.filter((r) => r.agree).length;
    console.log(`  ${k.padEnd(28)} ${ok}/${rs.length}  ${pct(ok, rs.length)}`);
  }
  console.log();
}

breakdown("BY LOCALE", (r) => r.entry.locale);
breakdown("BY MODALITY (units present)", (r) => r.modalities.sort().join("+") || "none");
breakdown("BY SEMANTIC CLASS", (r) => r.entry.class);
breakdown("BY CORPUS GROUP", (r) => r.entry.group!);
breakdown("BY SOURCE REVISION", (r) => (r.entry.firstSeen ?? r.entry.source ?? "synthetic-counterexample").split(" ")[0]);

console.log("DEFERRED TO HARD-INVARIANT LAYER (not adjudicated by the semantic prototype)");
for (const r of deferred) console.log(`  ${r.entry.id.padEnd(36)} ${r.deferred}`);
console.log();

const disagreements = runnable.filter((r) => !r.agree);
console.log(`DISAGREEMENTS: ${disagreements.length}`);
for (const r of disagreements) {
  console.log(`  ✗ ${r.entry.id} [${r.entry.locale}] class=${r.entry.class}`);
  console.log(`      expected ${r.entry.expected} · prototype ${r.verdict} · modalities ${r.modalities.join(",")}`);
  console.log(`      excerpt: ${r.entry.excerpt!.slice(0, 140).replace(/\n/g, " ")}`);
  for (const c of r.claims) console.log(`      claim ${c.type}=${String(c.value)} → ${c.verdict} (${c.reason}) key=${c.recordKey} modality=${c.modality}`);
  if (!r.claims.length) console.log("      no claims formed");
}
console.log();

// ---------------------------------------------------------------------------
// Scope-leak audit: no claim may be verified against another entity's record key
// ---------------------------------------------------------------------------
let leaks = 0;
for (const r of runnable) {
  const others = allEntities(r.entry.excerpt!).filter((e) => !r.claims.some((c) => c.scope.includes(e)));
  for (const c of r.claims) {
    if (!c.recordKey) continue;
    const key = c.recordKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    const foreign = others.find((o) => key.startsWith(o) && !c.scope.includes(o));
    if (foreign) { console.log(`SCOPE LEAK ${r.entry.id}: claim ${c.type} used ${c.recordKey} outside scope ${c.scope.join("/")}`); leaks++; }
  }
}
console.log(`SCOPE-LEAK AUDIT: ${leaks} leak(s)`);

// ---------------------------------------------------------------------------
// Hard-invariant parity + frozen-artifact integrity
// ---------------------------------------------------------------------------
const protoFiles = ["../benchmarks/evaluator-v4-proto/segment.ts", "../benchmarks/evaluator-v4-proto/claims.ts"];
// Audit the CODE, not the prose in comments.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const protoSrc = protoFiles.map((f) => stripComments(readFileSync(join(here, f), "utf8"))).join("\n");
const bannedImports = /from\s+["'].*(fact-ledger|scoring|ground-truth|evaluate|gate|officer\/tools|officer\/converse|supabase-js)["']/;
console.log(`PROTOTYPE IMPORTS PRODUCT/V3 EVALUATOR MODULES: ${bannedImports.test(protoSrc) ? "YES — FAIL" : "no"}`);
const securityTerms = /tenantsLeaked|unauthorizedDisclosures|unauthorizedDbMutations|unauthorizedReads|idempotenc|citationsRejected|forbiddenToolCalls/;
console.log(`PROTOTYPE REDEFINES ANY SECURITY/INVARIANT METRIC: ${securityTerms.test(protoSrc) ? "YES — FAIL" : "no"}`);
const hardcoded = /\b[A-Z][A-Z0-9]{2,}-\d{3}\b|\bQ\d{2}\b|\bR\d{2}\b|\bA0\d\b|[0-9a-f]{8}-[0-9a-f]{4}-/;
console.log(`PROTOTYPE CONTAINS SCENARIO IDS / CONTRACT NUMBERS / UUIDS: ${hardcoded.test(protoSrc) ? "YES — FAIL" : "no"}`);

const manifest = JSON.parse(readFileSync(join(benchDir, "manifest.json"), "utf8"));
let drift = 0;
for (const f of manifest.files) {
  // manifest paths may reach outside the benchmark dir (the harness itself)
  const candidates = [join(benchDir, f.file), join(here, "..", f.file.replace(/^(?:\.\.\/)+/, ""))];
  const p = candidates.find((c) => { try { readFileSync(c); return true; } catch { return false; } });
  if (!p) { console.log(`FROZEN FILE UNREADABLE: ${f.file}`); drift++; continue; }
  const actual = createHash("sha256").update(readFileSync(p)).digest("hex");
  if (actual !== f.sha256) { console.log(`FROZEN DRIFT: ${f.file}`); drift++; }
}
console.log(`FROZEN r${manifest.revision} INTEGRITY: ${manifest.files.length} files, drift ${drift}`);

console.log("\nACCEPTANCE SUMMARY");
const fp = runnable.filter((r) => r.entry.group === "false_positive");
const ce = runnable.filter((r) => r.entry.group === "counterexample");
const gd = rows.filter((r) => r.entry.group === "genuine_defect");
console.log(`  proven false positives no longer failed : ${fp.filter((r) => !failed(r.verdict)).length}/${fp.length} runnable (+${deferred.filter(r=>r.entry.group==="false_positive").length} deferred)`);
const ceMustFail = ce.filter((r) => isDefectLabel(r.entry.expected));
const ceMustPass = ce.filter((r) => !isDefectLabel(r.entry.expected));
console.log(`  counterexamples labelled must-fail      : ${ceMustFail.filter((r) => failed(r.verdict)).length}/${ceMustFail.length} correctly rejected (+${deferred.filter(r=>r.entry.group==="counterexample").length} deferred)`);
console.log(`  counterexamples labelled must-pass      : ${ceMustPass.filter((r) => !failed(r.verdict)).length}/${ceMustPass.length} correctly accepted`);
console.log(`  genuine historical defects              : ${gd.filter(r=>!r.deferred && failed(r.verdict)).length} semantic / ${gd.filter(r=>r.deferred).length} deferred to invariants, of ${gd.length}`);
console.log(`  arabic agreement                        : ${pct(runnable.filter(r=>r.entry.locale==="ar"&&r.agree).length, runnable.filter(r=>r.entry.locale==="ar").length)}`);
console.log(`  english agreement                       : ${pct(runnable.filter(r=>r.entry.locale==="en"&&r.agree).length, runnable.filter(r=>r.entry.locale==="en").length)}`);

// ---------------------------------------------------------------------------
// HELD-OUT PARAPHRASE PROBE
// Wordings that appear in NO report and in NO corpus entry. The corpus can only
// show the prototype fits what is already known; these probe whether the
// architecture generalises. Results are reported honestly and are NOT tuned for.
// ---------------------------------------------------------------------------
const probes: { id: string; locale: string; text: string; facts: Record<string, unknown>; expected: Verdict }[] = [
  { id: "H01-empty-slot-en", locale: "en", text: "The owner slot is still empty for this obligation.", facts: { unassigned: true }, expected: "SUPPORTED" },
  { id: "H02-not-nominated-en", locale: "en", text: "Ownership has not yet been nominated.", facts: { obligationAssigned: false }, expected: "SUPPORTED" },
  { id: "H03-belongs-to-person-en", locale: "en", text: "This obligation belongs to Dana Al-Harbi.", facts: { unassigned: true }, expected: "CONTRADICTED" },
  { id: "H04-no-one-named-ar", locale: "ar", text: "لم يُسمَّ أي مسؤول بعد.", facts: { obligationAssigned: false }, expected: "SUPPORTED" },
  { id: "H05-colon-name-ar", locale: "ar", text: "المسؤول: ليلى القحطاني", facts: { unassigned: true }, expected: "CONTRADICTED" },
  { id: "H06-could-not-locate-en", locale: "en", text: "The signed register could not be located in the record.", facts: { evidenceState: "verified" }, expected: "CONTRADICTED" },
  { id: "H07-spelled-numeral-en", locale: "en", text: "The report is due in three days.", facts: { daysUntilDue: 3 }, expected: "SUPPORTED" },
  { id: "H08-went-ahead-en", locale: "en", text: "I went ahead and changed the due date.", facts: { dbMutation: false }, expected: "CONTRADICTED" },
  { id: "H09-role-paraphrase-en", locale: "en", text: "Responsibility sits with the Contract Manager.", facts: { suggestedRole: "Contract Manager" }, expected: "SUPPORTED" },
  { id: "H10-asked-not-told-en", locale: "en", text: "Do you want me to check whether the acknowledgement was verified?", facts: { evidenceState: "missing" }, expected: "NON_ASSERTION" },
];

console.log("\nHELD-OUT PARAPHRASE PROBE (not in corpus, not tuned for)");
let probeOk = 0;
for (const p of probes) {
  const units = segment(p.text);
  const bag = new RecordBag(p.facts, allEntities(p.text));
  const cl = units.flatMap((u) => claimsForUnit(u, bag));
  const got = aggregate(cl);
  const ok = got === p.expected;
  if (ok) probeOk++;
  console.log(`  ${ok ? "✓" : "✗"} ${p.id.padEnd(24)} expected ${p.expected.padEnd(22)} got ${got.padEnd(22)} ${cl.map((c) => `${c.type}:${c.verdict}`).join(",") || "no claims"}`);
}
console.log(`  held-out agreement: ${probeOk}/${probes.length} (${pct(probeOk, probes.length)})`);

process.exitCode = disagreements.length || leaks || drift ? 1 : 0;
