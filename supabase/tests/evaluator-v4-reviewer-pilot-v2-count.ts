/**
 * HYBRID SEMANTIC REVIEWER PILOT v2 — INPUT TOKEN COUNTING (no generation)
 *
 * Counts the exact input tokens of each of the 24 reviewer requests using
 * Anthropic's /v1/messages/count_tokens endpoint, which performs no generation
 * and is not billed. Nothing here sends a generation request. The API key is
 * read from .env.local and never printed or written.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-reviewer-pilot-v2-count.ts
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const key = process.env.VAZORA_ANTHROPIC_API_KEY;
if (!key) { console.error("BLOCKED: VAZORA_ANTHROPIC_API_KEY not configured"); process.exit(2); }

const manifestBytes = readFileSync(join(protoDir, "reviewer-pilot-v2.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const promptText = readFileSync(join(protoDir, manifest.reviewer.promptFile), "utf8");
if (sha(promptText) !== manifest.reviewer.promptSha256) { console.error("BLOCKED: prompt hash mismatch"); process.exit(2); }
const datasetBytes = readFileSync(manifest.source.dataset);
if (sha(datasetBytes) !== manifest.source.datasetSha256) { console.error("BLOCKED: dataset hash mismatch"); process.exit(2); }

type DatasetCase = { id: string; text: string; factBag?: Record<string, unknown> };
const dataset: Record<string, DatasetCase> = Object.fromEntries(
  (JSON.parse(datasetBytes.toString("utf8")) as DatasetCase[]).map((c) => [c.id, c]),
);

function reviewerInput(caseId: string) {
  const c = dataset[caseId];
  if (!c) throw new Error(`case ${caseId} not in dataset`);
  const { recordAsOf, ...sources } = (c.factBag ?? {}) as { recordAsOf?: string } & Record<string, unknown>;
  return { caseId, request: null, referenceClock: recordAsOf ?? null, answer: c.text, sources, receipts: [] };
}

async function main() {
  const rows: { caseId: string; inputTokens: number | null; error?: string }[] = [];
  for (const k of manifest.cases as { id: string }[]) {
    const body = {
      model: manifest.reviewer.model,
      system: promptText,
      thinking: manifest.reviewer.parameters.thinking,
      messages: [{ role: "user", content: JSON.stringify(reviewerInput(k.id)) }],
    };
    const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) { rows.push({ caseId: k.id, inputTokens: null, error: `HTTP ${res.status} ${text.slice(0, 200)}` }); continue; }
    rows.push({ caseId: k.id, inputTokens: (JSON.parse(text) as { input_tokens: number }).input_tokens });
  }
  const ok = rows.filter((r) => r.inputTokens !== null) as { caseId: string; inputTokens: number }[];
  const total = ok.reduce((n, r) => n + r.inputTokens, 0);
  const out = {
    countedAt: new Date().toISOString(),
    endpoint: "/v1/messages/count_tokens (no generation, not billed)",
    model: manifest.reviewer.model,
    manifestSha256: sha(manifestBytes),
    promptSha256: manifest.reviewer.promptSha256,
    datasetSha256: manifest.source.datasetSha256,
    counted: ok.length,
    failed: rows.length - ok.length,
    inputTokensTotal: total,
    inputTokensMax: Math.max(...ok.map((r) => r.inputTokens)),
    inputTokensMin: Math.min(...ok.map((r) => r.inputTokens)),
    perCase: rows,
  };
  const file = join(protoDir, "reports", `${out.countedAt.replace(/[:.]/g, "-")}-reviewer-pilot-v2-token-count.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`generation requests sent: 0`);
  console.log(`counted ${out.counted}/24 · failed ${out.failed}`);
  console.log(`input tokens: total ${total} · max ${out.inputTokensMax} · min ${out.inputTokensMin}`);
  for (const r of rows) if (r.error) console.log(`  ${r.caseId} ${r.error}`);
  console.log(`written ${file}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
