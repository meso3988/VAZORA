import "server-only";

import { VERIFICATION_SYSTEM_PROMPT } from "@/lib/evidence/prompts";
import { registerVerificationProvider, type EvidenceVerificationProvider, type VerificationResult } from "@/lib/evidence/verifier";

/**
 * Generic OpenAI-compatible verification adapter — any vendor exposing the
 * chat-completions shape. Configure with:
 *   VAZORA_VERIFICATION_PROVIDER=openai-compat
 *   VAZORA_AI_BASE_URL=…            default https://api.openai.com/v1
 *   VAZORA_AI_API_KEY=…            server-only secret
 *   VAZORA_VERIFICATION_MODEL=…    default gpt-4o-mini
 */
const BASE = process.env.VAZORA_AI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = process.env.VAZORA_VERIFICATION_MODEL ?? "gpt-4o-mini";
const API_KEY = process.env.VAZORA_AI_API_KEY;
const TEMPERATURE = process.env.VAZORA_VERIFICATION_TEMPERATURE !== undefined
  ? Number(process.env.VAZORA_VERIFICATION_TEMPERATURE)
  : undefined;

export const openAiCompatVerifier: EvidenceVerificationProvider = {
  id: "openai-compat",
  model: MODEL,
  async verify(input): Promise<VerificationResult> {
    if (!API_KEY) return { ok: false, error: "verification unavailable — VAZORA_AI_API_KEY not configured" };

    const criteriaList = input.criteria
      .map((c, i) => {
        const ob = c.obligationId ? input.context.obligations[c.obligationId] : null;
        return `CRITERION ${i + 1} (id: ${c.requirementId})${c.required ? " [REQUIRED]" : " [optional]"}${ob ? `\n  obligation: ${ob}` : ""}\n  requirement: ${c.name}${c.description ? `\n  detail: ${c.description}` : ""}`;
      })
      .join("\n\n");

    const userContent = [
      `Contract: ${input.context.contractTitle}`,
      `Evidence file: ${input.fileName}`,
      ``,
      `REQUIRED CRITERIA — produce exactly one check per criterion id:`,
      criteriaList,
      ``,
      `<<<EVIDENCE_DOCUMENT>>>`,
      input.documentText.slice(0, 120000),
      `<<<END_EVIDENCE>>>`,
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
            { role: "system", content: VERIFICATION_SYSTEM_PROMPT },
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

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "provider returned non-JSON content" };
    }
    const checks = (parsed as { checks?: unknown[] }).checks ?? [];
    return {
      ok: true,
      checks: checks as never[],
      model: payload.model ?? MODEL,
      durationMs: Date.now() - t0,
      usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens },
    };
  },
};

for (const id of ["openai-compat", "openai", "azure-openai-compat"]) {
  registerVerificationProvider(id, () => openAiCompatVerifier);
}
