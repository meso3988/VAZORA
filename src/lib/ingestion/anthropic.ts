import "server-only";

import { registerExtractionProvider, type ContractExtractionProvider, type ContractExtractionResult } from "@/lib/ingestion/extractor";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompts";

/**
 * Native Anthropic Messages API adapter. Independent from OpenAI-compat —
 * parameters and headers match the Anthropic API exactly.
 *
 * Env:
 *   VAZORA_ANTHROPIC_API_KEY   — never committed
 *   VAZORA_ANTHROPIC_MODEL     — e.g. claude-fable-5, claude-opus-5
 */
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export function makeAnthropicProvider(defaultModel: string): ContractExtractionProvider {
  return {
    id: "anthropic-native",
    model: defaultModel,
    async extractChunk({ chunk, contractTitle }): Promise<ContractExtractionResult> {
      const key = process.env.VAZORA_ANTHROPIC_API_KEY;
      if (!key) return { ok: false, error: "Anthropic not configured — VAZORA_ANTHROPIC_API_KEY missing" };
      const model = process.env.VAZORA_ANTHROPIC_MODEL ?? defaultModel;

      const list = chunk.segments
        .map((s, i) => `SEGMENT ${i + 1}${s.clauseNumber ? ` [${s.clauseNumber}]` : ""}${s.heading ? ` — ${s.heading}` : ""}${s.pageNumber != null ? ` (p.${s.pageNumber})` : ""}\n${s.text}`)
        .join("\n\n");

      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 8192,
            system: EXTRACTION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: `Contract: ${contractTitle}\n\n<<<CONTRACT_CHUNK>>>\n${list}\n<<<END_CHUNK>>>` }],
          }),
        });
      } catch (e) {
        return { ok: false, error: `anthropic network: ${e instanceof Error ? e.message : "unknown"}` };
      }

      if (!res.ok) {
        return { ok: false, error: `anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }

      const payload = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      const content = payload.content?.find((c) => c.type === "text")?.text;
      if (!content) return { ok: false, error: "anthropic empty response" };

      let parsed: unknown;
      try {
        parsed = JSON.parse(content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
      } catch {
        return { ok: false, error: "anthropic returned non-JSON content" };
      }
      const obligations = (parsed as { obligations?: unknown[] }).obligations ?? [];
      return {
        ok: true,
        obligations: obligations as never[],
        model: payload.model ?? model,
        durationMs: Date.now() - t0,
        usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens },
      };
    },
  };
}

registerExtractionProvider("anthropic", () => makeAnthropicProvider("claude-fable-5"));
registerExtractionProvider("anthropic-claude-fable-5", () => makeAnthropicProvider("claude-fable-5"));
registerExtractionProvider("anthropic-claude-opus-5", () => makeAnthropicProvider("claude-opus-5"));
