import "server-only";

import { registerExtractionProvider, type ContractExtractionProvider, type ContractExtractionResult } from "@/lib/ingestion/extractor";
import { EXTRACTION_SYSTEM_PROMPT } from "./prompts";

const SYSTEM = EXTRACTION_SYSTEM_PROMPT;

/**
 * Generic OpenAI-compatible chat-completions provider. Any vendor exposing
 * that API shape (OpenAI, Azure OpenAI, Together, Groq? …) can be used by
 * setting:
 *   VAZORA_EXTRACTION_PROVIDER=openai-match
 *   VAZORA_AI_BASE_URL=…            default https://api.openai.com/v1
 *   VAZORA_AI_API_KEY=…            server-only secret
 *   VAZORA_EXTRACTION_MODEL=…      default gpt-4o-mini
 *
 * Prompt-injection defense: contract text is wrapped in explicit data
 * delimiters and the system prompt forbids treating any of it as an
 * instruction. Nothing from the document can approve, submit or alter the
 * tenant scope — the running code decides actions separately.
 */

const BASE = process.env.VAZORA_AI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.VAZORA_EXTRACTION_MODEL ?? "gpt-4o-mini";
const API_KEY = process.env.VAZORA_AI_API_KEY;
// Some model families (o-series, gpt-5.*) reject temperature. Omit it unless configured and supported.
const TEMPERATURE = process.env.VAZORA_EXTRACTION_TEMPERATURE !== undefined
  ? Number(process.env.VAZORA_EXTRACTION_TEMPERATURE)
  : undefined;

export const openAiCompatProvider: ContractExtractionProvider = {
  id: "openai-compat",
  model: MODEL,
  async extractChunk({ chunk, contractTitle }): Promise<ContractExtractionResult> {
    if (!API_KEY) return { ok: false, error: "AI extraction unavailable — VAZORA_AI_API_KEY not configured" };

    const list = chunk.segments
      .map((s, i) => {
        const clauseRef = s.clauseNumber ? `[${s.clauseNumber}] ` : "";
        const heading = s.heading ? ` — ${s.heading}` : "";
        const page = s.pageNumber != null ? ` (p.${s.pageNumber})` : "";
        return `SEGMENT ${i + 1}: ${clauseRef}${heading}${page}\n${s.text}`;
      })
      .join("\n\n");

    const userContent = [
      `Contract: ${contractTitle}`,
      ``,
      `<<<CONTRACT_CHUNK>>>`,
      list,
      `<<<END_CHUNK>>>`,
    ].join("\n");

    const t0 = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          ...(TEMPERATURE !== undefined ? { temperature: TEMPERATURE } : {}),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userContent },
          ],
        }),
      });
    } catch (e) {
      return { ok: false, error: `provider network error: ${e instanceof Error ? e.message : "unknown"}` };
    }

    if (!res.ok) {
      return { ok: false, error: `provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }

    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "empty provider response" };

    if (process.env.VAZORA_DEBUG_EXTRACTION === "1") {
      console.log("RAW PROVIDER OUTPUT (first 1500 chars):", content.slice(0, 1500));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "provider returned non-JSON content" };
    }
    const obligations = (parsed as { obligations?: unknown[] }).obligations ?? [];
    return {
      ok: true,
      obligations: obligations as never[],
      model: payload.model ?? MODEL,
      durationMs: Date.now() - t0,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
    };
  },
};

// Register under several friendly ids so VAZORA_EXTRACTION_PROVIDER is forgiving.
for (const id of ["openai-compat", "openai", "azure-openai-compat"]) {
  registerExtractionProvider(id, () => openAiCompatProvider);
}
