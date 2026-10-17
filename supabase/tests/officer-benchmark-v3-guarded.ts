/* eslint-disable @typescript-eslint/no-explicit-any */
// Per-request budget guard for a paid v3 diagnostic. Test infrastructure
// only: no product, prompt, scoring, fixture or frozen-harness change.
//
// Wraps the SAME configured provider (same id, model and settings). Before
// EVERY provider request it checks:
//     remaining calls ≥ 1   AND   remaining tokens ≥ estimatedInput + maxOutput
// where estimatedInput is deliberately conservative (ASCII chars / 2 +
// non-ASCII chars × 1 — UUID-heavy JSON and Arabic both tokenize densely)
// and maxOutput is the request's own max_completion_tokens cap. A request
// that might not fit is REFUSED before it is sent. Actual API-reported usage
// is then booked. Every request is written to a ledger file next to the report.
//
// Run: GUARD_MAX_TOKENS=… GUARD_MAX_CALLS=… (plus the normal BENCH_* env) \
//   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-guarded.ts

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import "../../src/lib/officer/providers/openai-compat";
import { getOfficerProvider, registerOfficerProvider, type ContractOfficerProvider } from "../../src/lib/officer/provider";

const MAX_TOKENS = Number(process.env.GUARD_MAX_TOKENS ?? 0);
const MAX_CALLS = Number(process.env.GUARD_MAX_CALLS ?? 0);
const DEFAULT_MAX_OUTPUT = 1500; // openai-compat.ts: max_completion_tokens default
if (!(MAX_TOKENS > 0 && MAX_CALLS > 0)) { console.error("GUARD_MAX_TOKENS and GUARD_MAX_CALLS are required"); process.exit(1); }

const id = process.env.VAZORA_OFFICER_PROVIDER!;
const found = getOfficerProvider();
if (!found || found.id !== id) { console.error(`provider ${id} not available`); process.exit(1); }
const real: ContractOfficerProvider = found;

function estimateTokens(s: string): number {
  let ascii = 0, other = 0;
  for (const ch of s) { if (ch.charCodeAt(0) < 128) ascii++; else other++; }
  return Math.ceil(ascii / 2 + other);
}

const ledger: any[] = [];
const used = { tokens: 0, calls: 0 };
const ledgerDir = process.env.BENCH_REPORT_DIR ?? join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports");
const ledgerPath = join(ledgerDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-guard-ledger.json`);
const flush = () => { mkdirSync(ledgerDir, { recursive: true }); writeFileSync(ledgerPath, `${JSON.stringify({ provider: real.id, model: real.model, maxTokens: MAX_TOKENS, maxCalls: MAX_CALLS, used, requests: ledger }, null, 2)}\n`); };

const guarded: ContractOfficerProvider = {
  id: real.id, model: real.model, supportsTools: real.supportsTools,
  async complete(input) {
    const maxOut = input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT;
    const estIn = estimateTokens(input.system + JSON.stringify(input.messages) + JSON.stringify(input.tools));
    const remaining = { tokens: MAX_TOKENS - used.tokens, calls: MAX_CALLS - used.calls };
    const entry: any = { n: ledger.length + 1, at: new Date().toISOString(), estimatedInput: estIn, maxOutput: maxOut, remainingBefore: remaining };
    ledger.push(entry);
    if (remaining.calls < 1 || remaining.tokens < estIn + maxOut) {
      entry.refused = true;
      flush();
      return { ok: false, error: `budget_guard: request refused before sending (needs ≤${estIn + maxOut} tokens, ${remaining.tokens} left; ${remaining.calls} calls left)` };
    }
    used.calls += 1;
    const r = await real.complete(input);
    if (r.ok) {
      entry.actualInput = r.usage?.inputTokens ?? null;
      entry.actualOutput = r.usage?.outputTokens ?? null;
      entry.estimateHeld = typeof entry.actualInput === "number" ? entry.actualInput <= estIn : null;
      used.tokens += (r.usage?.inputTokens ?? estIn) + (r.usage?.outputTokens ?? maxOut);
    } else {
      entry.error = r.error.slice(0, 200);
      used.tokens += 0; // a failed request returns no usage; the call is still counted
    }
    flush();
    return r;
  },
};
registerOfficerProvider(id, () => guarded);
process.on("exit", flush);

async function main() {
  console.log(`budget guard on ${real.id}/${real.model}: ≤${MAX_TOKENS} tokens, ≤${MAX_CALLS} requests → ${ledgerPath}`);
  await import("./officer-benchmark-v3");
}
main();
