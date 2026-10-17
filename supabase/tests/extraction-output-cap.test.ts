// Output ceilings reach the real request body, and a truncated or invalid
// extraction is a failure. fetch is stubbed — no network, no model call.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/extraction-output-cap.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

process.env.VAZORA_AI_API_KEY = "test-key-not-real";
process.env.VAZORA_AI_BASE_URL = "http://stub.invalid/v1";
process.env.VAZORA_EXTRACTION_MODEL = "gpt-5.6-sol";
process.env.VAZORA_OFFICER_MODEL = "gpt-5.6-sol";

const sent: Record<string, unknown>[] = [];
let reply: unknown = {};
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  sent.push(JSON.parse(init?.body ?? "{}"));
  return new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const chunkInput = {
  organizationId: "o", contractId: "c", contractTitle: "T",
  chunk: { chunkIndex: 0, documentIds: ["d"], documentNames: ["f"], segments: [{ clauseNumber: "1", heading: "H", text: "The contractor shall report monthly.", pageNumber: 1 }] },
};

async function main() {
  const { openAiCompatProvider } = await import("../../src/lib/ingestion/openai-compat");
  const { makeOpenAiCompatOfficer } = await import("../../src/lib/officer/providers/openai-compat");

  process.env.VAZORA_EXTRACTION_MAX_OUTPUT_TOKENS = "12000";
  reply = { model: "gpt-5.6-sol", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ obligations: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
  const ok = await openAiCompatProvider.extractChunk(chunkInput as never);
  check("extraction: configured ceiling reaches the body as max_completion_tokens", sent.at(-1)?.max_completion_tokens === 12000, JSON.stringify({ max_completion_tokens: sent.at(-1)?.max_completion_tokens }));
  check("extraction: model from config in the body", sent.at(-1)?.model === "gpt-5.6-sol");
  check("extraction: complete JSON response succeeds", ok.ok === true);

  reply = { choices: [{ finish_reason: "length", message: { content: "{\"obligations\": [{\"title\": \"Monthly rep" } }] };
  const cut = await openAiCompatProvider.extractChunk(chunkInput as never);
  check("extraction: finish_reason=length is a visible failure, not a partial result", cut.ok === false && /truncated/.test(cut.ok ? "" : cut.error), cut.ok ? "" : cut.error);

  reply = { choices: [{ finish_reason: "stop", message: { content: "{\"obligations\": [" } }] };
  const bad = await openAiCompatProvider.extractChunk(chunkInput as never);
  check("extraction: incomplete JSON is a failure", bad.ok === false);

  delete process.env.VAZORA_EXTRACTION_MAX_OUTPUT_TOKENS;
  reply = { choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ obligations: [] }) } }] };
  await openAiCompatProvider.extractChunk(chunkInput as never);
  check("extraction: no ceiling configured → field absent (unchanged default behavior)", !("max_completion_tokens" in (sent.at(-1) ?? {})));

  reply = { model: "gpt-5.6-sol", choices: [{ finish_reason: "stop", message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
  await makeOpenAiCompatOfficer().complete({ system: "s", messages: [{ role: "user", content: "q" }], tools: [], maxOutputTokens: 1500 });
  check("officer: per-request ceiling reaches the body as max_completion_tokens", sent.at(-1)?.max_completion_tokens === 1500);

  const run = src("src/lib/ingestion/run.ts");
  check("ingestion run fails on a chunk error before saving obligations", run.includes('if (!result.ok) return fail("extraction_failed"'));
  check("extraction prompt not changed by this work", src("src/lib/ingestion/openai-compat.ts").includes("const SYSTEM = EXTRACTION_SYSTEM_PROMPT;"));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
