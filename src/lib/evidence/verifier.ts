import "server-only";

import { validateVerificationOutput, type ProviderCheck } from "@/lib/evidence/schema";
import type { Criterion } from "@/lib/evidence/engine";

/**
 * Evidence-verification provider boundary — deliberately separate from
 * ContractExtractionProvider. Extraction asks "what does the contract
 * require?"; verification asks "does THIS evidence prove THAT criterion?".
 * Different job, different prompts, different provider lifecycle.
 *
 * Implementations receive untrusted document text (DATA ONLY). The worker
 * has no tools and cannot persist anything — it returns structured results;
 * the engine decides what reaches the database.
 */

export type VerificationInput = {
  organizationId: string;
  evidenceItemId: string;
  evidenceVersionId: string;
  fileName: string;
  /** extracted plain text of the evidence — untrusted data */
  documentText: string;
  /** PDF page offsets when the parser provided them */
  pageOffsets: { page: number; start: number; end: number }[];
  /** the criteria to evaluate — one check per criterion, never a file verdict */
  criteria: Criterion[];
  /** short context: contract title + obligation title per criterion */
  context: { contractTitle: string; obligations: Record<string, string> };
};

export type VerificationResult =
  | {
      ok: true;
      checks: ProviderCheck[];
      model?: string;
      durationMs?: number;
      retries?: number;
      usage?: { inputTokens?: number; outputTokens?: number };
    }
  | { ok: false; error: string };

export interface EvidenceVerificationProvider {
  readonly id: string;
  readonly model: string;
  verify(input: VerificationInput): Promise<VerificationResult>;
}

const registry: Record<string, () => EvidenceVerificationProvider> = {};

export function registerVerificationProvider(id: string, factory: () => EvidenceVerificationProvider) {
  registry[id] = factory;
}

/**
 * Picks a provider from VAZORA_VERIFICATION_PROVIDER. No silent default —
 * absence of configuration is an explicit failure, surfaced as
 * "verification unavailable" and never faked.
 */
export function getVerificationProvider(): EvidenceVerificationProvider | null {
  const id = process.env.VAZORA_VERIFICATION_PROVIDER;
  if (!id) return null;
  const factory = registry[id];
  return factory ? factory() : null;
}

/**
 * Run the provider and validate the structured output. Invalid output gets
 * ONE bounded retry; a second failure is a hard error — nothing is
 * persisted, nothing closes a gap.
 */
export async function verifyValidated(
  provider: EvidenceVerificationProvider,
  input: VerificationInput,
): Promise<VerificationResult> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.verify(input);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    const checked = validateVerificationOutput({ checks: result.checks });
    if (!checked.ok) {
      lastError = `schema: ${checked.issues.slice(0, 3).join("; ")}`;
      continue;
    }
    return {
      ok: true,
      checks: checked.output.checks,
      model: result.model,
      durationMs: result.durationMs,
      retries: attempt,
      usage: result.usage,
    };
  }
  return { ok: false, error: lastError || "provider produced no usable output" };
}
