import "server-only";

import {
  registerOfficerProvider,
  type ContractOfficerProvider,
  type OfficerCompletion,
  type OfficerToolCall,
} from "@/lib/officer/provider";
import { describeFailure, officerFetch } from "@/lib/officer/transport";

/**
 * OpenAI-compatible Contract Officer adapter — any vendor exposing the
 * chat-completions shape with tool calling.
 *
 *   VAZORA_OFFICER_PROVIDER=openai-compat-officer
 *   VAZORA_AI_BASE_URL=…       default https://api.openai.com/v1
 *   VAZORA_AI_API_KEY=…        server-only secret
 *   VAZORA_OFFICER_MODEL=…     default gpt-4o-mini
 *   VAZORA_OFFICER_REASONING_EFFORT=…  optional; some reasoning models reject
 *                              function tools unless this is "none" on
 *                              /v1/chat/completions.
 */
const BASE = () => process.env.VAZORA_AI_BASE_URL ?? "https://api.openai.com/v1";
const MODEL = () => process.env.VAZORA_OFFICER_MODEL ?? "gpt-4o-mini";
const REASONING = () => process.env.VAZORA_OFFICER_REASONING_EFFORT;

export function makeOpenAiCompatOfficer(): ContractOfficerProvider {
  return {
    id: "openai-compat-officer",
    model: MODEL(),
    supportsTools: true,
    async complete(input): Promise<OfficerCompletion> {
      const key = process.env.VAZORA_AI_API_KEY;
      if (!key) return { ok: false, error: "officer unavailable — VAZORA_AI_API_KEY not configured" };

      const messages: Record<string, unknown>[] = [{ role: "system", content: input.system }];
      for (const m of input.messages) {
        if (m.role === "tool") {
          messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
        } else if (m.role === "assistant") {
          messages.push({
            role: "assistant",
            content: m.content || null,
            ...(m.toolCalls?.length
              ? {
                  tool_calls: m.toolCalls.map((t) => ({
                    id: t.id, type: "function",
                    function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) },
                  })),
                }
              : {}),
          });
        } else {
          messages.push({ role: "user", content: m.content });
        }
      }

      const t0 = Date.now();
      const sent = await officerFetch(`${BASE().replace(/\/+$/, "")}/chat/completions`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: MODEL(),
            messages,
            max_completion_tokens: input.maxOutputTokens ?? 1500,
            ...(REASONING() ? { reasoning_effort: REASONING() } : {}),
            tools: input.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: "auto",
        }),
      });
      if (!sent.ok) return { ok: false, error: describeFailure(sent.failure), failure: sent.failure };

      const payload = (await sent.response.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const msg = payload.choices?.[0]?.message;
      if (!msg) return { ok: false, error: "empty provider response" };

      const toolCalls: OfficerToolCall[] = (msg.tool_calls ?? []).map((c, i) => {
        let args: unknown = {};
        try {
          args = c.function?.arguments ? JSON.parse(c.function.arguments) : {};
        } catch {
          // Malformed arguments are passed through verbatim so the registry
          // rejects them with a precise error instead of us guessing.
          args = { __unparsable: c.function?.arguments ?? "" };
        }
        return { id: c.id ?? `call_${i}`, name: c.function?.name ?? "", arguments: args };
      });

      return {
        ok: true,
        text: msg.content ?? "",
        toolCalls,
        model: payload.model ?? MODEL(),
        usage: { inputTokens: payload.usage?.prompt_tokens, outputTokens: payload.usage?.completion_tokens },
        durationMs: Date.now() - t0,
      };
    },
  };
}

for (const id of ["openai-compat-officer", "openai-officer", "azure-openai-officer"]) {
  registerOfficerProvider(id, makeOpenAiCompatOfficer);
}
