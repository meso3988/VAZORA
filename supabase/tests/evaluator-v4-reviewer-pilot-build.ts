/**
 * HYBRID SEMANTIC REVIEWER PILOT — OFFLINE REQUEST BUILDER (no network)
 *
 * Builds the exact request bodies the pilot WOULD send, hashes each one, and
 * estimates token usage — so inputs are fixed and auditable before any spend.
 * This script makes no network call and never reads an API key.
 *
 * Only the reviewer-permitted fields are placed in a request: answer text,
 * reference clock, sources (fact bag without recordAsOf), null request and
 * empty receipts. Gold labels, flags, rationale, family and semanticClass are
 * never read into a request body.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-reviewer-pilot-build.ts
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

const manifest = JSON.parse(readFileSync(join(protoDir, "reviewer-pilot-v1.json"), "utf8"));
const promptText = readFileSync(join(protoDir, manifest.reviewer.promptFile), "utf8");
const datasetBytes = readFileSync(manifest.source.dataset);
if (sha(datasetBytes) !== manifest.source.datasetSha256) {
  console.error(`BLOCKED: dataset sha256 ${sha(datasetBytes)} != ${manifest.source.datasetSha256}`);
  process.exit(2);
}
type DatasetCase = { id: string; text: string; factBag?: Record<string, unknown> };
type PilotCase = { id: string; reference: { units: unknown[] } };
type ReviewerRequest = {
  caseId: string;
  requestSha256: string;
  body: { model: string; max_tokens: number; temperature: number; system: string; messages: { role: string; content: string }[] };
};
const dataset: Record<string, DatasetCase> = Object.fromEntries(
  (JSON.parse(datasetBytes.toString("utf8")) as DatasetCase[]).map((c) => [c.id, c]),
);

// The ONLY fields a reviewer request may carry.
function reviewerInput(caseId: string) {
  const c = dataset[caseId];
  if (!c) throw new Error(`case ${caseId} not in dataset`);
  const { recordAsOf, ...sources } = (c.factBag ?? {}) as { recordAsOf?: string } & Record<string, unknown>;
  return { caseId, request: null, referenceClock: recordAsOf ?? null, answer: c.text, sources, receipts: [] };
}

const params = manifest.reviewer.parameters;
const requests: ReviewerRequest[] = (manifest.cases as PilotCase[]).map((k) => {
  const input = reviewerInput(k.id);
  const body = {
    model: manifest.reviewer.model,
    max_tokens: params.max_tokens,
    temperature: params.temperature,
    system: promptText,
    messages: [{ role: "user", content: JSON.stringify(input) }],
  };
  const bodyJson = JSON.stringify(body);
  return { caseId: k.id, requestSha256: sha(bodyJson), body };
});

// Leakage audit: no forbidden key may appear in any request body.
const forbidden = manifest.source.mapping.neverSent.filter((f: string) => /^[a-zA-Z]+$/.test(f));
const leaks: string[] = [];
for (const r of requests) {
  const userContent = r.body.messages[0].content;
  for (const f of forbidden) if (userContent.includes(`"${f}"`)) leaks.push(`${r.caseId}:${f}`);
}

// Token estimate (heuristic, NOT a tokenizer): Arabic script is far denser in
// tokens per character than Latin script, so it is counted conservatively.
function estTokens(s: string): number {
  const arabic = (s.match(/[\u0600-\u06FF]/g) ?? []).length;
  return Math.ceil(arabic / 1.8 + (s.length - arabic) / 3.5);
}
const perRequest = requests.map((r) => ({
  caseId: r.caseId,
  inputTokensEst: estTokens(r.body.system) + estTokens(r.body.messages[0].content) + 20,
}));
const inputTotal = perRequest.reduce((n, p) => n + p.inputTokensEst, 0);
const refUnits = (manifest.cases as PilotCase[]).reduce((n, k) => n + Math.max(1, k.reference.units.length), 0);
// Output: ~60 tokens of envelope + ~170 per unit for span, claim, refs, reason;
// doubled for unit splitting the reviewer may do beyond the reference.
const outputExpected = requests.length * 60 + refUnits * 170 * 2;
const outputCeiling = requests.length * params.max_tokens;
const price = manifest.reviewer.pricingBasis;
const usd = (i: number, o: number) => (i / 1e6) * price.inputUsdPerMillion + (o / 1e6) * price.outputUsdPerMillion;
const limit = manifest.budget.proposedSharedLimit;

const out = {
  builtAt: new Date().toISOString(),
  pilot: manifest.pilot,
  networkCalls: 0,
  datasetSha256: manifest.source.datasetSha256,
  promptFile: manifest.reviewer.promptFile,
  promptSha256: sha(promptText),
  manifestSha256: sha(readFileSync(join(protoDir, "reviewer-pilot-v1.json"))),
  model: manifest.reviewer.model,
  leakageAudit: { forbiddenFieldsChecked: forbidden, leaks },
  estimates: {
    method: "character heuristic (Arabic 1.8 chars/token, other 3.5 chars/token); real usage will be taken from provider usage fields",
    requests: requests.length,
    inputTokensTotal: inputTotal,
    inputTokensMaxSingle: Math.max(...perRequest.map((p) => p.inputTokensEst)),
    outputTokensExpected: outputExpected,
    outputTokensCeiling: outputCeiling,
    costUsdExpected: +usd(inputTotal, outputExpected).toFixed(2),
    costUsdWorstCase: +usd(inputTotal, outputCeiling).toFixed(2),
    perRequest,
  },
  limitCheck: {
    proposed: limit,
    requestsWithin: requests.length <= limit.maxRequests,
    inputWithin: inputTotal <= limit.maxInputTokens,
    worstCaseOutputWithin: outputCeiling <= limit.maxOutputTokens,
    worstCaseCostWithin: usd(inputTotal, outputCeiling) <= limit.maxCostUsd,
  },
  requests,
};

mkdirSync(join(protoDir, "reports"), { recursive: true });
const file = join(protoDir, "reports", `${out.builtAt.replace(/[:.]/g, "-")}-reviewer-pilot-requests.json`);
writeFileSync(file, JSON.stringify(out, null, 2));

console.log(`network calls: 0 · api key read: no`);
console.log(`dataset sha256 VERIFIED ${out.datasetSha256}`);
console.log(`prompt sha256  ${out.promptSha256}`);
console.log(`requests built ${requests.length} · leakage findings ${leaks.length}${leaks.length ? " " + leaks.join(",") : ""}`);
console.log(`input tokens   ~${inputTotal} total · ~${out.estimates.inputTokensMaxSingle} max single`);
console.log(`output tokens  ~${outputExpected} expected · ${outputCeiling} ceiling (max_tokens × requests)`);
console.log(`cost           ~$${out.estimates.costUsdExpected} expected · $${out.estimates.costUsdWorstCase} worst case`);
console.log(`limit check    ${JSON.stringify(out.limitCheck)}`);
console.log(`written        ${file}`);
