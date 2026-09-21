/**
 * Phase 3 — Evidence Intelligence view models.
 *
 * These types describe the REAL verification state (evidence_items /
 * versions / runs / checks / gaps), deliberately richer than the flattened
 * `Evidence` list type in domain/types.ts which predates the engine.
 * Nothing here is a vendor format — the UI depends only on these shapes.
 */

export type EvidenceItemStatus =
  | "received"
  | "verification_pending"
  | "partially_verified"
  | "verified"
  | "needs_review"
  | "ocr_required"
  | "rejected";

export type CheckResult =
  | "verified"
  | "partial"
  | "missing"
  | "not_found"
  | "not_applicable"
  | "needs_human_review"
  | "unable_to_verify";

export type GapStatus =
  | "open"
  | "evidence_received"
  | "reverification_pending"
  | "resolved"
  | "dismissed_by_authorized_human";

export type CheckKind = "deterministic" | "ai_semantic";

export type VerificationCheckView = {
  id: string;
  requirementId: string | null;
  checkLabel: string;
  checkKind: CheckKind;
  result: CheckResult;
  confidence: number | null;
  reason: string | null;
  sourceExcerpt: string | null;
  sourceLocation: string | null;
  sourcePage: number | null;
  provider: string | null;
  model: string | null;
  /** Additive human override — the AI/deterministic result is never rewritten. */
  humanResult: CheckResult | null;
  humanReason: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
};

export type VerificationRunView = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  overall: string | null;
  evidenceVersionId: string;
  provider: string | null;
  model: string | null;
  checkCount: number;
  verifiedCount: number;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  checks: VerificationCheckView[];
};

export type EvidenceVersionView = {
  id: string;
  versionNumber: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string | null;
  uploadedAt: string;
};

export type EvidenceGapView = {
  id: string;
  requirementId: string | null;
  gapType: string;
  status: GapStatus;
  description: string | null;
  verificationRunId: string | null;
  closedByRunId: string | null;
  /** 'verification_run' or 'human_confirmed_verification_regression' */
  openedVia: string;
  createdAt: string;
};

/** Same-version weakening — a pending or decided VERIFICATION_DISCREPANCY. */
export type VerificationDiscrepancyView = {
  id: string;
  requirementId: string;
  evidenceVersionId: string;
  priorResult: CheckResult;
  currentResult: CheckResult;
  priorCheckId: string;
  currentCheckId: string;
  priorRunId: string;
  currentRunId: string;
  provider: string | null;
  model: string | null;
  status: "pending" | "kept_prior" | "regression_confirmed";
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

export type EvidenceRequirementView = {
  id: string;
  name: string;
  description: string | null;
  evidenceType: string;
  required: boolean;
  obligationId: string;
};

/** The proof chain — clause → obligation → requirement, traceable back. */
export type ObligationContext = {
  id: string;
  title: string;
  requirementText: string;
  clauseRef: string | null;
  clauseText: string | null;
  clausePage: number | null;
  documentId: string | null;
  dueContext: string | null;
};

export type EvidenceItemDetail = {
  id: string;
  contractId: string;
  contractTitle: string;
  obligationId: string | null;
  obligation: ObligationContext | null;
  title: string;
  evidenceType: string;
  status: EvidenceItemStatus;
  createdBy: string | null;
  createdAt: string;
  versions: EvidenceVersionView[];
  /** linked criteria this evidence is verified against */
  requirements: EvidenceRequirementView[];
  /** every requirement on the obligation — linked or not (linking UI + "what was required") */
  obligationRequirements: EvidenceRequirementView[];
  /** requirement id → linked version id (null = item-level link) */
  linkVersionByRequirement: Record<string, string | null>;
  runs: VerificationRunView[];
  gaps: EvidenceGapView[];
  discrepancies: VerificationDiscrepancyView[];
};

/**
 * EFFECTIVE OPERATIONAL STATE vs LATEST VERIFICATION RESULT.
 *
 * These are two different questions and must never collapse into one badge:
 *
 *   operational — what the organization should act on right now. A pending
 *                 (or human-retained) same-version discrepancy keeps the
 *                 previously accepted result in force.
 *   latest      — what the newest verification run actually said. Always
 *                 shown honestly, never hidden to protect the operational
 *                 state.
 *
 * Phase 4 (AI Contract Officer) must read `operational` for decisions while
 * staying aware of `discrepancyStatus === "pending"`.
 */
export type EffectiveEvidenceStatus = {
  /** the state to operationally act on — NOT simply the newest model output */
  operational: CheckResult | null;
  /** the newest verification result, shown alongside, never instead */
  latest: CheckResult | null;
  /** true while operational is held above latest by a discrepancy */
  priorStateInForce: boolean;
  /** pending = awaiting authorized human review */
  discrepancyStatus: "pending" | "kept_prior" | "regression_confirmed" | null;
  /** how the operational state was established */
  source: "verification_run" | "human_override" | "prior_verified_retained" | "human_confirmed_regression" | "none";
};

/** One row of the contract Evidence Matrix. */
export type EvidenceMatrixRow = {
  requirement: EvidenceRequirementView;
  obligation: ObligationContext;
  linkedItemCount: number;
  latestResult: CheckResult | null;
  latestItemId: string | null;
  /** status of the newest linked item — a fresh unverified version stays visible */
  latestItemStatus: EvidenceItemStatus | null;
  effectiveHuman: boolean;
  gap: EvidenceGapView | null;
  /** operational vs latest — the row renders `effective.operational` as primary */
  effective: EffectiveEvidenceStatus;
};

/** Categorized inbox row — exceptions first, never a generic file list. */
export type EvidenceInboxRow = {
  itemId: string;
  title: string;
  contractId: string;
  contractTitle: string;
  obligationTitle: string | null;
  status: EvidenceItemStatus;
  version: number;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
  openGapCount: number;
  unlinkedCount: number;
  needsOverrideReview: boolean;
  /** same-version discrepancies awaiting authorized human review */
  pendingDiscrepancyCount: number;
  /** pending + human-retained — those still holding a prior verified state */
  heldDiscrepancyCount: number;
  /**
   * Operational item status. While a discrepancy holds the prior verified
   * state in force this stays "verified" even though `status` (the latest
   * run's verdict) reads "needs_review".
   */
  effectiveStatus: EvidenceItemStatus;
};

export type InboxCategory =
  | "needs_linking"
  | "needs_verification"
  | "needs_human_review"
  /** verifier disagreed with an accepted result on the SAME immutable evidence */
  | "verification_discrepancy"
  | "partial"
  | "missing"
  | "reverification_pending"
  | "recent"
  | "verified"
  | "all";
