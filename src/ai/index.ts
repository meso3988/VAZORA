import "server-only";

import type { AIProvider, AIProviderFactory } from "./provider";
import { mockAIProvider } from "./providers/mock";

/**
 * Registry of model providers. Add a vendor by registering a factory here
 * (e.g. `openai`, `anthropic`, `google`, `azure`) and selecting it with
 * VAZORA_AI_PROVIDER. Nothing outside src/ai should know which vendor runs.
 */
const registry: Record<string, AIProviderFactory> = {
  mock: () => mockAIProvider,
};

export function getAIProvider(): AIProvider {
  const id = process.env.VAZORA_AI_PROVIDER ?? "mock";
  const factory = registry[id];
  if (!factory) {
    throw new Error(`Unknown AI provider "${id}". Registered: ${Object.keys(registry).join(", ")}`);
  }
  return factory();
}

export type { AIProvider, EvidenceAssessment, ExtractedObligation, OfficerBriefing } from "./provider";
