import "server-only";

import { VERIFICATION_SYSTEM_PROMPT } from "@/lib/evidence/prompts";
import { registerVerificationProvider, type EvidenceVerificationProvider, type VerificationResult } from "@/lib/evidence/verifier";

/**
 * Native Anthropic Messages API adapter for evidence verification.
 * Independent from the extraction adapter — verification model selection is
 * a separate decision (VAZORA_VERIFICATION_PROVIDER / _MODEL).
 *
 * Env:
 *   VAZORA_ANTHROPIC_API_KEY    — server-only secret
 *   VAZORA_VERIFICATION_MODEL   — e.g. claude-opus-5 (falls back to the
 *                                 registered default)
 */
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export function makeAnthropicVerifier(defaultModel: string): EvidenceVerificationProvider {
  return {
    id: "anthropic-native",
    model: defaultModel,
    async verify(input): Promise<VerificationResult> {
      const key = process.env.VAZORA_ANTHROPIC_API_KEY;
      if (!key) return { ok: false, error: "Anthropic not configured — VAZORA_ANTHROPIC_API_KEY missing" };
      const model = process.env.VAZORA_VERIFICATION_MODEL ?? defaultModel;

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
            system: VERIFICATION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent }],
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
      const checks = (parsed as { checks?: unknown[] }).checks ?? [];
      return {
        ok: true,
        checks: checks as never[],
        model: payload.model ?? model,
        durationMs: Date.now() - t0,
        usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens },
      };
    },
  };
}

registerVerificationProvider("anthropic", () => makeAnthropicVerifier("claude-fable-5"));
registerVerificationProvider("anthropic-claude-fable-5", () => makeAnthropicVerifier("claude-fable-5"));
registerVerificationProvider("anthropic-claude-opus-5", () => makeAnthropicVerifier("claude-opus-5"));
