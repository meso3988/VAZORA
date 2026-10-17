// One minimal live completion through the EXACT VAZORA Officer provider path.
// Health gate only — never a substitute for the benchmark.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// Adapters self-register on import — same side-effect order as converse.ts.
import "../../src/lib/officer/providers/anthropic";
import "../../src/lib/officer/providers/openai-compat";
import { getOfficerProvider } from "../../src/lib/officer/provider";

async function main() {
  const p = getOfficerProvider();
  if (!p) { console.log("HEALTH FAIL: no Officer provider configured"); process.exit(1); }
  console.log(`provider = ${p.id}`);
  console.log(`model    = ${p.model}`);
  const r = await p.complete({
    system: "You are a health probe. Answer with exactly one word.",
    messages: [{ role: "user", content: "Reply with the single word: ready" }],
    tools: [],
    maxOutputTokens: 32,
  });
  if (!r.ok) {
    const e = String(r.error);
    console.log(`HEALTH FAIL: ${e.slice(0, 300)}`);
    if (/credit|quota|insufficient/i.test(e)) console.log("→ classification: CREDIT/QUOTA");
    else if (/401|403|api key|unauthor/i.test(e)) console.log("→ classification: AUTH");
    else console.log("→ classification: OTHER");
    process.exit(1);
  }
  console.log(`HEALTH PASS: HTTP 200 · text="${(r.text ?? "").trim().slice(0, 40)}" · tokens in/out ${r.usage?.inputTokens ?? "?"}/${r.usage?.outputTokens ?? "?"}`);
}

main().catch((e) => { console.error("HEALTH FAIL (threw):", e); process.exit(1); });
