import "server-only";

/**
 * Contract Officer provider boundary — deliberately separate from
 * ContractExtractionProvider ("what does the contract require?") and
 * EvidenceVerificationProvider ("does THIS evidence prove THAT criterion?").
 *
 * The Officer is a conversational, tool-calling role: different prompts,
 * different model economics, different lifecycle. Nothing here selects a
 * permanent model — configure with:
 *
 *   VAZORA_OFFICER_PROVIDER   adapter id (e.g. anthropic-officer, openai-compat-officer)
 *   VAZORA_OFFICER_MODEL      model id for that adapter
 *
 * Secrets are read server-side only and never cross the network to a client.
 */

/** A tool the model is allowed to request, in provider-neutral form. */
export type OfficerToolSpec = {
  name: string;
  description: string;
  /** JSON Schema object for the arguments */
  parameters: Record<string, unknown>;
};

export type OfficerTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: OfficerToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type OfficerToolCall = {
  id: string;
  name: string;
  /** raw, unvalidated model arguments — validated by the tool registry */
  arguments: unknown;
};

export type OfficerCompletion =
  | {
      ok: true;
      /** assistant prose; may be empty when the model only asked for tools */
      text: string;
      toolCalls: OfficerToolCall[];
      model?: string;
      usage?: { inputTokens?: number; outputTokens?: number };
      durationMs?: number;
    }
  | { ok: false; error: string };

export interface ContractOfficerProvider {
  readonly id: string;
  readonly model: string;
  /** supports native tool calling? adapters without it are refused */
  readonly supportsTools: boolean;
  complete(input: {
    system: string;
    messages: OfficerTurn[];
    tools: OfficerToolSpec[];
    /** hard cap so a runaway answer cannot burn the budget */
    maxOutputTokens?: number;
  }): Promise<OfficerCompletion>;
}

const registry: Record<string, () => ContractOfficerProvider> = {};

export function registerOfficerProvider(id: string, factory: () => ContractOfficerProvider) {
  registry[id] = factory;
}

/**
 * Resolve the configured Officer provider. No silent default — an
 * unconfigured Officer is an explicit, visible failure ("the Contract
 * Officer is unavailable"), never a fabricated answer.
 */
export function getOfficerProvider(): ContractOfficerProvider | null {
  const id = process.env.VAZORA_OFFICER_PROVIDER;
  if (!id) return null;
  const factory = registry[id];
  return factory ? factory() : null;
}

export function officerProviderConfigured(): boolean {
  return getOfficerProvider() !== null;
}
