import type { LocalizedText, Obligation } from "@/domain/types";

/**
 * AI boundary. VAZORA's domain services talk to this interface only, so the
 * underlying model vendor can change (or be mixed per task) without touching
 * UI or domain code.
 */

export type ExtractedObligation = Pick<
  Obligation,
  "clauseRef" | "requirement" | "cadence" | "requiredEvidence"
> & { confidence: number; sourceExcerpt: string };

export type EvidenceAssessment = {
  status: "verified" | "partial" | "rejected";
  summary: LocalizedText;
  checks: { label: LocalizedText; passed: boolean; rationale?: string }[];
};

export type OfficerBriefing = {
  headline: LocalizedText;
  items: { obligationId?: string; claimId?: string; message: LocalizedText; priority: 1 | 2 | 3 }[];
};

export interface AIProvider {
  readonly id: string;
  /** Turn contract text into structured obligation candidates. */
  extractObligations(input: { contractId: string; text: string }): Promise<ExtractedObligation[]>;
  /** Judge whether an evidence file satisfies a requirement. */
  assessEvidence(input: {
    obligation: Obligation;
    evidenceText: string;
  }): Promise<EvidenceAssessment>;
  /** Produce the proactive daily briefing for the AI Contract Officer. */
  briefOfficer(input: { organizationId: string; obligations: Obligation[] }): Promise<OfficerBriefing>;
}

export type AIProviderFactory = () => AIProvider;
