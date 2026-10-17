/**
 * Phase 4A — AI Contract Officer view models.
 *
 * The Officer is a persistent organizational role, not a chat widget. These
 * types describe what it may say, cite, remember and propose. The same
 * response model must serve a future realtime voice interface, so an
 * assistant turn is structured data — never a formatted string.
 */

/** Everything the Officer is allowed to point at as a source. */
export type CitationTarget =
  | "contract"
  | "clause"
  | "obligation"
  | "evidence_requirement"
  | "evidence_item"
  | "evidence_version"
  | "verification_run"
  | "verification_check"
  | "evidence_gap"
  | "verification_discrepancy"
  | "activity_event"
  | "officer_memory";

/**
 * A resolvable pointer into VAZORA state. `label` is display text only —
 * the id is what makes the claim checkable.
 */
export type OfficerCitation = {
  target: CitationTarget;
  id: string;
  label: string;
  /** contract the source belongs to, for navigation */
  contractId?: string | null;
  /** deep link into the workspace, built server-side */
  href?: string | null;
};

export type OfficerMessageRole = "user" | "assistant" | "tool" | "system";

/** One tool the Officer actually ran — shown so its reasoning is inspectable. */
export type OfficerToolInvocation = {
  tool: string;
  ok: boolean;
  /** short, non-confidential summary of what came back */
  summary: string;
  durationMs?: number;
};

export type OfficerMessageView = {
  id: string;
  conversationId: string;
  role: OfficerMessageRole;
  content: string;
  citations: OfficerCitation[];
  toolInvocations: OfficerToolInvocation[];
  proposedActionIds: string[];
  authorUserId: string | null;
  provider: string | null;
  model: string | null;
  createdAt: string;
};

export type OfficerConversationView = {
  id: string;
  scope: "organization" | "contract";
  contractId: string | null;
  title: string | null;
  createdBy: string | null;
  lastMessageAt: string | null;
  createdAt: string;
};

export type OfficerActionStatus =
  | "suggested"
  | "waiting_for_approval"
  | "approved"
  | "executing"
  | "completed"
  | "rejected"
  | "failed"
  | "cancelled";

export type OfficerRiskLevel = "low" | "medium" | "high";

/** A proposal. The Officer proposes; a human approves; the server re-checks. */
export type OfficerActionView = {
  id: string;
  contractId: string | null;
  obligationId: string | null;
  conversationId: string | null;
  actionType: string;
  arguments: Record<string, unknown>;
  reason: string;
  citations: OfficerCitation[];
  riskLevel: OfficerRiskLevel;
  requiresApproval: boolean;
  status: OfficerActionStatus;
  proposedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
};

export type OfficerMemoryOrigin =
  | "user_confirmed"
  | "human_note"
  | "system_derived"
  | "model_inference";

export type OfficerMemoryState = "confirmed" | "unconfirmed" | "invalidated";

export type OfficerMemoryView = {
  id: string;
  scope: "organization" | "contract" | "user";
  contractId: string | null;
  subjectUserId: string | null;
  kind: "fact" | "preference" | "promise" | "note";
  content: string;
  origin: OfficerMemoryOrigin;
  state: OfficerMemoryState;
  confidence: number | null;
  authorUserId: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type OfficerObservationView = {
  id: string;
  contractId: string | null;
  obligationId: string | null;
  evidenceRequirementId: string | null;
  kind: string;
  /** 1 critical … 4 monitoring */
  priority: number;
  /** machine-readable reasons, e.g. ["due_in_2_days","evidence_missing"] */
  priorityReason: string[];
  title: string;
  detail: string | null;
  citations: OfficerCitation[];
  status: "active" | "acknowledged" | "resolved" | "superseded";
  dedupeKey: string;
  firstDetectedAt: string;
  lastSeenAt: string;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
};

/**
 * TRUTH HIERARCHY — the Officer resolves conflicts in this order and never
 * lets a lower layer override a higher one.
 *
 *   1 approved contract / evidence / system state
 *   2 authorized human decisions
 *   3 structured organization data
 *   4 confirmed conversation memory
 *   5 model inference
 */
export const TRUTH_LAYERS = [
  "approved_system_state",
  "human_decision",
  "structured_org_data",
  "confirmed_memory",
  "model_inference",
] as const;

export type TruthLayer = (typeof TRUTH_LAYERS)[number];

export function truthRank(layer: TruthLayer): number {
  return TRUTH_LAYERS.indexOf(layer);
}

/** Does `candidate` outrank `incumbent`? Ties never displace the incumbent. */
export function outranks(candidate: TruthLayer, incumbent: TruthLayer): boolean {
  return truthRank(candidate) < truthRank(incumbent);
}
