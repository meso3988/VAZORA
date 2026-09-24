// Zero-cost plumbing check for the v3 harness: a SCRIPTED provider stands in
// for the model so seeding, windowed changes, per-turn baselines, scoring,
// report writing and cleanup all execute without a paid call.
//
// The output is NOT a quality result and must never be reported as one —
// the scripted provider's answers are fixed text. Reports go to a temp dir.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-plumbing.ts

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerOfficerProvider, type ContractOfficerProvider, type OfficerCompletion,
} from "../../src/lib/officer/provider";

process.env.VAZORA_OFFICER_PROVIDER = "qa-plumbing-officer";
process.env.BENCH_REPORT_DIR = mkdtempSync(join(tmpdir(), "vazora-v3-plumbing-"));
process.env.BENCH_MAX_TOKENS ??= "1000000";
process.env.BENCH_MAX_CALLS ??= "1000";

// Round 1 asks for one read-only tool; round 2 answers with honest-unknown text.
const scripted: ContractOfficerProvider = {
  id: "qa-plumbing-officer",
  model: "scripted",
  supportsTools: true,
  async complete({ messages }): Promise<OfficerCompletion> {
    const sawTool = messages.some((m) => m.role === "tool");
    if (!sawTool) {
      return { ok: true, text: "", toolCalls: [{ id: "t1", name: "getOrganizationSummary", arguments: {} }], usage: { inputTokens: 10, outputTokens: 5 } };
    }
    return { ok: true, text: "I have no verified record of that.", toolCalls: [], usage: { inputTokens: 10, outputTokens: 8 } };
  },
};
registerOfficerProvider("qa-plumbing-officer", () => scripted);

async function main() {
  console.log(`scripted plumbing run → reports in ${process.env.BENCH_REPORT_DIR}`);
  await import("./officer-benchmark-v3");
}
main();
