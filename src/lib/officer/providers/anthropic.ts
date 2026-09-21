import "server-only";

import {
  registerOfficerProvider,
  type ContractOfficerProvider,
  type OfficerCompletion,
  type OfficerToolCall,
} from "@/lib/officer/provider";

/**
 * Native Anthropic Messages adapter for the Contract Officer.
 *
 *   VAZORA_OFFICER_PROVIDER=anthropic-officer
 *   VAZORA_ANTHROPIC_API_KEY=…   server-only secret
 *   VAZORA_OFFICER_MODEL=…       e.g. claude-opus-5
 */
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL = () => process.env.VAZORA_OFFICER_MODEL ?? "claude-opus-5";

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

export function makeAnthropicOfficer(): ContractOfficerProvider {
  return {
    id: "anthropic-officer",
    model: MODEL(),
    supportsTools: true,
    async complete(input): Promise<OfficerCompletion> {
      const key = process.env.VAZORA_ANTHROPIC_API_KEY;
      if (!key) return { ok: false, error: "officer unavailable — VAZORA_ANTHROPIC_API_KEY not configured" };

      // Anthropic carries tool results as user-role content blocks.
      const messages: { role: "user" | "assistant"; content: AnthropicBlock[] }[] = [];
      for (const m of input.messages) {
        if (m.role === "tool") {
          const last = messages[messages.length - 1];
          const block: AnthropicBlock = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
          if (last?.role === "user") last.content.push(block);
          else messages.push({ role: "user", content: [block] });
        } else if (m.role === "assistant") {
          const blocks: AnthropicBlock[] = [];
          if (m.content) blocks.push({ type: "text", text: m.content });
          for (const t of m.toolCalls ?? []) {
            blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.arguments ?? {} });
          }
          if (blocks.length) messages.push({ role: "assistant", content: blocks });
        } else {
          messages.push({ role: "user", content: [{ type: "text", text: m.content }] });
        }
      }

      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODEL(),
            max_tokens: input.maxOutputTokens ?? 1500,
            system: input.system,
            messages,
            tools: input.tools.map((t) => ({
              name: t.name, description: t.description, input_schema: t.parameters,
            })),
          }),
        });
      } catch (e) {
        return { ok: false, error: `provider network error: ${e instanceof Error ? e.message : "unknown"}` };
      }
      if (!res.ok) {
        return { ok: false, error: `provider HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }

      const payload = (await res.json()) as {
        content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      const blocks = payload.content ?? [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      const toolCalls: OfficerToolCall[] = blocks
        .filter((b) => b.type === "tool_use")
        .map((b, i) => ({ id: b.id ?? `call_${i}`, name: b.name ?? "", arguments: b.input ?? {} }));

      return {
        ok: true,
        text,
        toolCalls,
        model: payload.model ?? MODEL(),
        usage: { inputTokens: payload.usage?.input_tokens, outputTokens: payload.usage?.output_tokens },
        durationMs: Date.now() - t0,
      };
    },
  };
}

registerOfficerProvider("anthropic-officer", makeAnthropicOfficer);
