/**
 * HYBRID SEMANTIC REVIEWER PILOT v2 — BUILD and RUN
 *
 *   build  offline: builds the 24 exact request bodies from the approved
 *          manifest, hashes each, records counted input tokens, writes the
 *          requests file. No network.
 *   run    sends EXACTLY the committed request bodies (every hash re-verified
 *          first), one attempt per case, with a budget guard checked BEFORE each
 *          request and reconciled with returned usage AFTER it. Every raw
 *          response is appended to a JSONL file immediately, before anything is
 *          parsed or scored. No retries, no extra requests, no provider change.
 *
 * The API key is read from .env.local and never printed or written.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-reviewer-pilot-v2-run.ts build
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-reviewer-pilot-v2-run.ts run <requests.json>
 */

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const mode = process.argv[2];

type DatasetCase = { id: string; text: string; factBag?: Record<string, unknown> };
type Body = {
  model: string; max_tokens: number; thinking: { type: string }; output_config: { effort: string };
  system: string; messages: { role: "user"; content: string }[];
};
type Built = { caseId: string; requestSha256: string; countedInputTokens: number; body: Body };

const manifestPath = join(protoDir, "reviewer-pilot-v2.json");

function build() {
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const promptText = readFileSync(join(protoDir, manifest.reviewer.promptFile), "utf8");
  if (sha(promptText) !== manifest.reviewer.promptSha256) throw new Error("prompt hash mismatch");
  const datasetBytes = readFileSync(manifest.source.dataset);
  if (sha(datasetBytes) !== manifest.source.datasetSha256) throw new Error("dataset hash mismatch");
  const dataset: Record<string, DatasetCase> = Object.fromEntries(
    (JSON.parse(datasetBytes.toString("utf8")) as DatasetCase[]).map((c) => [c.id, c]),
  );
  const counts = JSON.parse(readFileSync(join(protoDir, manifest.budget.inputCounted.source), "utf8"));
  const counted = new Map<string, number>(counts.perCase.map((r: { caseId: string; inputTokens: number }) => [r.caseId, r.inputTokens]));
  const p = manifest.reviewer.parameters;

  const requests: Built[] = (manifest.cases as { id: string }[]).map(({ id }) => {
    const c = dataset[id];
    const { recordAsOf, ...sources } = (c.factBag ?? {}) as { recordAsOf?: string } & Record<string, unknown>;
    const input = { caseId: id, request: null, referenceClock: recordAsOf ?? null, answer: c.text, sources, receipts: [] };
    const body: Body = {
      model: manifest.reviewer.model,
      max_tokens: p.max_tokens,
      thinking: p.thinking,
      output_config: p.output_config,
      system: promptText,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    };
    const n = counted.get(id);
    if (n === undefined) throw new Error(`no counted input tokens for ${id}`);
    return { caseId: id, requestSha256: sha(JSON.stringify(body)), countedInputTokens: n, body };
  });

  // forbidden-field audit on what is actually sent
  const forbidden = (manifest.source.mapping.neverSent as string[]).filter((f) => /^[a-zA-Z]+$/.test(f));
  const leaks = requests.flatMap((r) => forbidden.filter((f) => r.body.messages[0].content.includes(`"${f}"`)).map((f) => `${r.caseId}:${f}`));
  if (leaks.length) throw new Error(`leakage: ${leaks.join(",")}`);
  const banned = requests.filter((r) => /"(temperature|top_p|top_k|budget_tokens)"/.test(JSON.stringify(r.body)) || r.body.thinking.type !== "adaptive");
  if (banned.length) throw new Error("forbidden sampling/thinking parameter present");

  const out = {
    builtAt: new Date().toISOString(),
    networkCalls: 0,
    manifestSha256: sha(manifestBytes),
    promptSha256: manifest.reviewer.promptSha256,
    datasetSha256: manifest.source.datasetSha256,
    model: manifest.reviewer.model,
    settings: { max_tokens: p.max_tokens, thinking: p.thinking, output_config: p.output_config, omitted: p.omitted },
    limits: manifest.budget.approvedLimits,
    pricing: { inputUsdPerMillion: manifest.reviewer.pricingBasis.inputUsdPerMillion, outputUsdPerMillion: manifest.reviewer.pricingBasis.outputUsdPerMillion },
    leakageFindings: 0,
    requests,
  };
  const file = join(protoDir, "reports", `${out.builtAt.replace(/[:.]/g, "-")}-reviewer-pilot-v2-requests.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`network calls 0 · requests ${requests.length} · leakage 0 · forbidden params 0`);
  console.log(`manifest ${out.manifestSha256}`);
  for (const r of requests) console.log(`  ${r.caseId} ${r.requestSha256} in=${r.countedInputTokens}`);
  console.log(`written ${file}`);
}

async function run(requestsPath: string) {
  for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  const key = process.env.VAZORA_ANTHROPIC_API_KEY;
  if (!key) { console.error("BLOCKED: VAZORA_ANTHROPIC_API_KEY not configured"); process.exit(2); }

  const built = JSON.parse(readFileSync(requestsPath, "utf8"));
  // full-answer study requests name their own manifest; pilot requests use the pilot manifest
  const builtManifest = built.manifestPath ? join(here, "..", "..", built.manifestPath) : manifestPath;
  if (sha(readFileSync(builtManifest)) !== built.manifestSha256) { console.error("BLOCKED: manifest changed since build"); process.exit(2); }
  for (const r of built.requests as Built[]) {
    if (sha(JSON.stringify(r.body)) !== r.requestSha256) { console.error(`BLOCKED: request body hash mismatch ${r.caseId}`); process.exit(2); }
  }
  const L = built.limits;
  const P = built.pricing;
  if (/NOT APPROVED/i.test(L.approval ?? "")) { console.error("BLOCKED: limits in this requests file are not approved"); process.exit(2); }
  if ((built.requests as Built[]).some((r) => typeof r.countedInputTokens !== "number")) { console.error("BLOCKED: input tokens not counted for every request"); process.exit(2); }
  const cost = (i: number, o: number) => (i / 1e6) * P.inputUsdPerMillion + (o / 1e6) * P.outputUsdPerMillion;
  const used = { requests: 0, input: 0, output: 0, usd: 0 };
  const rawFile = requestsPath.replace(/-requests\.json$/, "-raw.jsonl");
  let outcome = "COMPLETE";

  for (const r of built.requests as Built[]) {
    // ---- PRE-REQUEST GUARD (ceilings, not targets) ----
    const inMargin = Math.ceil(r.countedInputTokens * 1.05);
    const maxOut = r.body.max_tokens;
    const fits =
      used.requests + 1 <= L.maxRequests &&
      used.input + inMargin <= L.maxInputTokens &&
      used.output + maxOut <= L.maxOutputTokensIncludingThinking &&
      used.usd + cost(inMargin, maxOut) <= L.maxCostUsdTotal;
    if (!fits) { outcome = "INCOMPLETE_BUDGET_GUARD"; console.log(`STOP before ${r.caseId}: budget guard`); break; }

    const startedAt = new Date().toISOString();
    const t0 = Date.now();
    let httpStatus = 0;
    let requestId: string | null = null;
    let rawText = "";
    let transportError: string | null = null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(r.body),
      });
      httpStatus = res.status;
      requestId = res.headers.get("request-id");
      rawText = await res.text();
    } catch (e) {
      transportError = String(e);
    }
    const durationMs = Date.now() - t0;
    used.requests += 1;

    let usage: { input_tokens?: number; output_tokens?: number } | null = null;
    let stopReason: string | null = null;
    let blockTypes: string[] = [];
    try {
      const j = JSON.parse(rawText);
      usage = j.usage ?? null;
      stopReason = j.stop_reason ?? null;
      blockTypes = Array.isArray(j.content) ? j.content.map((b: { type: string }) => b.type) : [];
    } catch { /* raw text kept verbatim below */ }

    // ---- SAVE RAW FIRST ----
    appendFileSync(rawFile, JSON.stringify({
      caseId: r.caseId, requestSha256: r.requestSha256, model: r.body.model, startedAt, durationMs,
      httpStatus, requestId, transportError, stopReason, usage, contentBlockTypes: blockTypes, rawResponse: rawText,
    }) + "\n");

    // ---- RECONCILE WITH ACTUAL USAGE ----
    const inTok = usage?.input_tokens ?? 0;
    const outTok = usage?.output_tokens ?? 0;
    used.input += inTok;
    used.output += outTok;
    used.usd += cost(inTok, outTok);
    console.log(`${r.caseId} http=${httpStatus} stop=${stopReason} in=${inTok} out=${outTok} cum$=${used.usd.toFixed(4)} ${durationMs}ms`);

    // ---- STOP RULES ----
    const lower = rawText.toLowerCase();
    if (httpStatus === 401 || httpStatus === 403 || /credit balance|billing|insufficient.*credit/.test(lower)) {
      outcome = "BLOCKED"; console.log(`BLOCKED at ${r.caseId}: authorization or credit`); break;
    }
    if (httpStatus === 400) { outcome = "INCOMPLETE_CONFIG_ERROR"; console.log(`STOP at ${r.caseId}: invalid_request (settings are fixed; not changed mid-run)`); break; }
  }

  const summary = { outcome, used: { ...used, usd: +used.usd.toFixed(4) }, limits: L, rawFile };
  writeFileSync(rawFile.replace(/-raw\.jsonl$/, "-run-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`OUTCOME ${outcome} · requests ${used.requests} · in ${used.input} · out ${used.output} · $${used.usd.toFixed(4)}`);
}

if (mode === "build") build();
else if (mode === "run" && process.argv[3]) run(process.argv[3]).catch((e) => { console.error(e); process.exit(1); });
else { console.error("usage: build | run <requests.json>"); process.exit(2); }
