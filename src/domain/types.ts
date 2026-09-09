/**
 * VAZORA domain model.
 *
 * Every entity is scoped to an organization (tenant). Ids are opaque strings so
 * they can map 1:1 to Postgres uuids once Supabase is wired in.
 *
 * Text that users see (names, titles, summaries) is stored as `LocalizedText`
 * so demo data renders natively in both English and Arabic.
 */

export type LocalizedText = { en: string; ar: string };

export type ISODate = string;

export type Organization = {
  id: string;
  name: LocalizedText;
  slug: string;
  country: string;
  createdAt: ISODate;
};

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "contract_manager" | "member" | "viewer";
};

export type Project = {
  id: string;
  organizationId: string;
  name: LocalizedText;
  client: LocalizedText;
  sector: Sector;
};

export type Sector =
  | "operations_maintenance"
  | "construction"
  | "facilities_management"
  | "technology_services"
  | "supply"
  | "government";

export type ContractStatus = "active" | "at_risk" | "closeout" | "draft";

export type Contract = {
  id: string;
  organizationId: string;
  projectId: string;
  reference: string;
  title: LocalizedText;
  client: LocalizedText;
  sector: Sector;
  status: ContractStatus;
  value: number;
  currency: string;
  startDate: ISODate;
  endDate: ISODate;
  health: ContractHealth;
};

/** Top-level indicators. Each is grounded in counted objects, never a synthetic score. */
export type ContractHealth = {
  obligationsTotal: number;
  obligationsDueThisMonth: number;
  obligationsOverdue: number;
  evidenceCoverage: number; // 0..1 — obligations with at least one accepted evidence item
  risksOpen: number;
  riskExposure: number; // currency amount at risk (penalties + deductions)
  claimReadiness: number; // 0..1 — for the next claim
};

export type Clause = {
  id: string;
  contractId: string;
  ref: string; // e.g. "14.2"
  heading: LocalizedText;
  excerpt: LocalizedText;
  page: number;
};

export type ObligationStatus =
  | "verified"
  | "partial"
  | "missing"
  | "at_risk"
  | "pending"
  | "overdue";

export type ObligationCadence =
  | "one_time"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "milestone";

export type Obligation = {
  id: string;
  organizationId: string;
  contractId: string;
  clauseId: string;
  clauseRef: string;
  requirement: LocalizedText;
  ownerId: string;
  ownerName: string;
  status: ObligationStatus;
  cadence: ObligationCadence;
  dueDate: ISODate;
  requiredEvidence: LocalizedText[];
  evidenceIds: string[];
  claimId?: string;
  penaltyExposure?: number;
};

export type EvidenceStatus = "verified" | "partial" | "rejected" | "pending";

export type EvidenceCheck = {
  label: LocalizedText;
  passed: boolean;
};

export type Evidence = {
  id: string;
  organizationId: string;
  contractId: string;
  obligationId: string;
  fileName: string;
  fileType: "pdf" | "xlsx" | "docx" | "jpg" | "eml";
  uploadedBy: string;
  uploadedAt: ISODate;
  version: number;
  status: EvidenceStatus;
  verification: {
    summary: LocalizedText;
    checks: EvidenceCheck[];
  };
};

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type Risk = {
  id: string;
  organizationId: string;
  contractId: string;
  obligationId?: string;
  clauseRef: string;
  title: LocalizedText;
  description: LocalizedText;
  severity: RiskSeverity;
  exposure: number;
  daysToImpact: number;
  status: "open" | "mitigating" | "closed";
};

export type ActionItem = {
  id: string;
  organizationId: string;
  contractId: string;
  obligationId?: string;
  title: LocalizedText;
  ownerName: string;
  dueDate: ISODate;
  status: "open" | "in_progress" | "done";
};

export type ClaimRequirementStatus = "verified" | "partial" | "missing";

export type ClaimRequirement = {
  id: string;
  obligationId: string;
  clauseRef: string;
  label: LocalizedText;
  status: ClaimRequirementStatus;
  note?: LocalizedText;
};

export type Claim = {
  id: string;
  organizationId: string;
  contractId: string;
  number: number;
  period: LocalizedText;
  amount: number;
  currency: string;
  status: "preparing" | "ready" | "submitted" | "approved" | "paid";
  targetDate: ISODate;
  requirements: ClaimRequirement[];
};

export type AgentEventKind =
  | "attention"
  | "due_soon"
  | "evidence_gap"
  | "claim_readiness"
  | "risk"
  | "verified";

export type AgentEvent = {
  id: string;
  organizationId: string;
  contractId?: string;
  obligationId?: string;
  claimId?: string;
  kind: AgentEventKind;
  message: LocalizedText;
  detail?: LocalizedText;
  createdAt: ISODate;
  priority: 1 | 2 | 3;
};

export type ActivityEntry = {
  id: string;
  organizationId: string;
  contractId: string;
  actor: string; // user name or "VAZORA Officer"
  action: LocalizedText;
  target?: string; // clause ref / file name
  at: ISODate;
};

export function claimReadiness(claim: Pick<Claim, "requirements">): number {
  const total = claim.requirements.length;
  if (total === 0) return 0;
  const score = claim.requirements.reduce((acc, r) => {
    if (r.status === "verified") return acc + 1;
    if (r.status === "partial") return acc + 0.4;
    return acc;
  }, 0);
  return score / total;
}

export function countBy<T, K extends string>(
  items: T[],
  key: (item: T) => K,
): Record<K, number> {
  return items.reduce(
    (acc, item) => {
      const k = key(item);
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    },
    {} as Record<K, number>,
  );
}
