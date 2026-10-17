// QA-only recording proxy for the live delivery journey. NOT product code.
// The QA server points VAZORA_AI_BASE_URL at this proxy; it forwards to the
// real OpenAI endpoint and:
//   - records every request body and the full raw response (the
//     Authorization header is forwarded, never written anywhere);
//   - enforces a hard request count and a hard USD budget BEFORE forwarding:
//     worst case = estimated input (body chars / 2.5) at the input price +
//     max_completion_tokens at the output price; a request without
//     max_completion_tokens or for another model is refused (never sent);
//   - reconciles spend from the provider's reported usage after each reply.
// No retries: one upstream attempt per request.
//
// Run: QP_MAX_REQUESTS=9 QP_BUDGET_USD=1.00 node --import tsx supabase/tests/qa-model-proxy.mts

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const UPSTREAM = process.env.QP_UPSTREAM ?? "https://api.openai.com/v1";
const PORT = Number(process.env.QP_PORT ?? 8787);
const MODEL = process.env.QP_MODEL ?? "gpt-5.6-sol";
const MAX_REQUESTS = Number(process.env.QP_MAX_REQUESTS ?? 9);
const BUDGET = Number(process.env.QP_BUDGET_USD ?? 1.0);
// Documented OpenAI prices for gpt-5.6-sol, short context, USD per 1M tokens.
const PRICE_IN = Number(process.env.QP_PRICE_IN ?? 4.0);
const PRICE_OUT = Number(process.env.QP_PRICE_OUT ?? 20.0);
const OUT_DIR = process.env.QP_OUT ?? "/tmp/live-journey";
mkdirSync(OUT_DIR, { recursive: true });
const LOG = `${OUT_DIR}/proxy-log.jsonl`;

let sent = 0;
let spent = 0;
const usd = (inTok: number, outTok: number) => (inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6;
const state = () => writeFileSync(`${OUT_DIR}/proxy-state.json`, JSON.stringify({ sent, maxRequests: MAX_REQUESTS, spentUsd: Number(spent.toFixed(6)), budgetUsd: BUDGET, priceIn: PRICE_IN, priceOut: PRICE_OUT }, null, 2));
state();

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const path = (req.url ?? "").replace(/^\/v1/, "");
  const ts = new Date().toISOString();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw || "{}"); } catch { /* refused below */ }
  const maxOut = Number(body.max_completion_tokens);
  const estIn = Math.ceil(raw.length / 2.5);
  const worst = usd(estIn, Number.isFinite(maxOut) ? maxOut : 0);
  const refuse = (reason: string) => {
    appendFileSync(LOG, JSON.stringify({ ts, path, refused: reason, model: body.model, max_completion_tokens: body.max_completion_tokens, estInputTokens: estIn, worstUsd: worst, spentUsd: spent, sent }) + "\n");
    res.writeHead(402, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `QA budget guard: ${reason}` } }));
  };
  if (req.method !== "POST" || path !== "/chat/completions") return refuse(`unsupported ${req.method} ${path}`);
  if (body.model !== MODEL) return refuse(`model ${String(body.model)} is not the approved ${MODEL}`);
  if (!Number.isInteger(maxOut) || maxOut <= 0) return refuse("request has no max_completion_tokens (unbounded output)");
  if (sent >= MAX_REQUESTS) return refuse(`request ceiling ${MAX_REQUESTS} reached`);
  if (spent + worst > BUDGET) return refuse(`worst case $${worst.toFixed(4)} exceeds remaining $${(BUDGET - spent).toFixed(4)}`);

  sent++;
  const seq = sent;
  state();
  let status = 0;
  let text = "";
  try {
    const up = await fetch(`${UPSTREAM}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: String(req.headers.authorization ?? "") },
      body: raw,
    });
    status = up.status;
    text = await up.text();
  } catch (e) {
    status = 599;
    text = JSON.stringify({ error: { message: `upstream network error: ${e instanceof Error ? e.message : "unknown"}` } });
  }
  let usage: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } = {};
  let finish: string | null = null;
  try { const j = JSON.parse(text); usage = j.usage ?? {}; finish = j.choices?.[0]?.finish_reason ?? null; } catch { /* raw kept */ }
  const cost = usd(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0);
  spent += cost;
  state();
  appendFileSync(LOG, JSON.stringify({
    seq, ts, path, model: body.model, max_completion_tokens: maxOut, estInputTokens: estIn, worstUsd: worst,
    status, finish_reason: finish, usage, costUsd: cost, cumulativeUsd: spent, request: body, rawResponse: text,
  }) + "\n");
  console.log(`#${seq} ${status} finish=${finish} in=${usage.prompt_tokens} out=${usage.completion_tokens} cost=$${cost.toFixed(4)} total=$${spent.toFixed(4)}`);
  res.writeHead(status === 599 ? 502 : status, { "Content-Type": "application/json" });
  res.end(text);
}).listen(PORT, "127.0.0.1", () => console.log(`qa-model-proxy on 127.0.0.1:${PORT} → ${UPSTREAM} · model ${MODEL} · ≤${MAX_REQUESTS} requests · ≤$${BUDGET}`));
