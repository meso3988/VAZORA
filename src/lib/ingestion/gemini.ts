import "server-only";

import { registerExtractionProvider, type ContractExtractionProvider, type ContractExtractionResult } from "@/lib/ingestion/extractor";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompts";

/**
 * Native Google Gemini API adapter (generateContent). Independent of the
 * OpenAI shape — system instruction is passed as systemInstruction, and
 * output constrained to JSON via response mime type.
 *
 * Env:
 *   VAZORA_GEMINI_API_KEY   — never committed
 *   VAZORA_GEMINI_MODEL     — e.g. gemini-3.8-flash
 */
export function makeGeminiProvider(defaultModel: string): ContractExtractionProvider {
  return {
    id: "gemini-native",
    model: defaultModel,
    async extractChunk({ chunk, contractTitle }): Promise<ContractExtractionResult> {
      const key = process.env.VAZORA_GEMINI_API_KEY;
      if (!key) return { ok: false, error: "Gemini not configured — VAZORA_GEMINI_API_KEY missing" };
      const model = process.env.VAZORA_GEMINI_MODEL ?? defaultModel;
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      const list = chunk.segments
        .map((s, i) => `SEGMENT ${i + 1}${s.clauseNumber ? ` [${s.clauseNumber}]` : ""}${s.heading ? ` — ${s.heading}` : ""}${s.pageNumber != null ? ` (p.${s.pageNumber})` : ""}\n${s.text}`)
        .join("\n\n");

      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: `Contract: ${contractTitle}\n\n<<<CONTRACT_CHUNK>>>\n${list}\n<<<END_CHUNK>>>` }] }],
            generationConfig: { responseMimeType: "application/json" },
          }),
        });
      } catch (e) {
        return { ok: false, error: `gemini network: ${e instanceof Error ? e.message : "unknown"}` };
      }

      if (!res.ok) {
        return { ok: false, error: `gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }

      const payload = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const content = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!content) return { ok: false, error: "gemini empty response" };

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { ok: false, error: "gemini returned non-JSON content" };
      }
      const obligations = (parsed as { obligations?: unknown[] }).obligations ?? [];
      return {
        ok: true,
        obligations: obligations as never[],
        model,
        durationMs: Date.now() - t0,
        usage: {
          inputTokens: payload.usageMetadata?.promptTokenCount,
          outputTokens: payload.usageMetadata?.candidatesTokenCount,
        },
      };
    },
  };
}

registerExtractionProvider("gemini", () => makeGeminiProvider("gemini-3.8-flash"));
registerExtractionProvider("gemini-3.8-flash", () => makeGeminiProvider("gemini-3.8-flash"));
