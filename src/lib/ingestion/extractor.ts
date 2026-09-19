import "server-only";

import { validateChunkExtraction, type ObligationExtraction } from "@/lib/ingestion/schema";

/**
 * Contract-extraction provider interface. Separate from the Phase 1
 * AIProvider so extraction can be swapped independently of officer/brief
 * behavior. Implementations receive untrusted document text — content is
 * DATA ONLY and must never act as instructions (prompt-injection guard is
 * in the system prompt design).
 */
export type ExtractionChunk = {
  chunkIndex: number;
  documentIds: string[];
  segments: { clauseNumber: string | null; heading: string | null; text: string; pageNumber: number | null }[];
};

export type ContractExtractionResult =
  | { ok: true; obligations: ObligationExtraction[] }
  | { ok: false; error: string };

export interface ContractExtractionProvider {
  readonly id: string;
  readonly model: string;
  extractChunk(input: {
    organizationId: string;
    contractId: string;
    chunk: ExtractionChunk;
    contractTitle: string;
  }): Promise<ContractExtractionResult>;
}

const registry: Record<string, () => ContractExtractionProvider> = {};

export function registerExtractionProvider(id: string, factory: () => ContractExtractionProvider) {
  registry[id] = factory;
}

/**
 * Picks a provider from VAZORA_EXTRACTION_PROVIDER. No default mock for real
 * tenants — absence of configuration is an explicit failure state, surfaced
 * to the user as "AI extraction unavailable".
 */
export function getExtractionProvider(): ContractExtractionProvider | null {
  const id = process.env.VAZORA_EXTRACTION_PROVIDER;
  if (!id) return null;
  const factory = registry[id];
  return factory ? factory() : null;
}

/**
 * Runs one chunk through the provider and validates the structured output.
 * Invalid output is a hard failure — partial extraction NEVER reaches the DB.
 */
export async function extractChunkValidated(
  provider: ContractExtractionProvider,
  input: Parameters<ContractExtractionProvider["extractChunk"]>[0],
): Promise<ContractExtractionResult> {
  const result = await provider.extractChunk(input);
  if (!result.ok) return result;
  const checked = validateChunkExtraction({ obligations: result.obligations });
  if (!checked.ok) {
    return { ok: false, error: `schema: ${checked.issues.slice(0, 3).join("; ")}` };
  }
  return { ok: true, obligations: checked.obligations };
}
