import type {
  ActionItem,
  ActivityEntry,
  AgentEvent,
  Claim,
  Clause,
  Contract,
  ContractDocument,
  Evidence,
  Obligation,
  Organization,
  OrganizationMember,
  Project,
  Risk,
} from "@/domain/types";

/**
 * Data access boundary. Every method is tenant-scoped: callers always pass the
 * organization id they are authorised for, and implementations MUST filter by it
 * (Supabase RLS enforces the same rule at the database).
 */
export interface OrganizationRepository {
  getById(id: string): Promise<Organization | null>;
  listMembers(organizationId: string): Promise<OrganizationMember[]>;
  listProjects(organizationId: string): Promise<Project[]>;
}

export interface ContractRepository {
  list(organizationId: string): Promise<Contract[]>;
  /** Like list(), but a failed read is reported instead of returning []. */
  listChecked?(organizationId: string): Promise<{ ok: true; contracts: Contract[] } | { ok: false }>;
  getById(organizationId: string, id: string): Promise<Contract | null>;
  /**
   * Like getById(), but a failed read is reported as "unavailable" instead
   * of collapsing into null (which callers render as "not found").
   * not_found means the authorized query succeeded and found no row —
   * including a foreign-tenant id, which must not be disclosed as existing.
   */
  getByIdChecked?(organizationId: string, id: string): Promise<
    { status: "found"; contract: Contract } | { status: "not_found" } | { status: "unavailable" }
  >;
  listClauses(organizationId: string, contractId: string): Promise<Clause[]>;
  /**
   * Like listClauses(), but a failed read is reported instead of returning [].
   * basis tells the caller which run the clauses came from: the approved
   * baseline, or a pending-review extraction (which the UI must label as
   * unapproved — it is never an operational substitute).
   */
  listClausesChecked?(organizationId: string, contractId: string): Promise<
    { ok: true; clauses: Clause[]; basis: "approved" | "ready_for_review" | null } | { ok: false }
  >;
}

export interface ObligationRepository {
  list(organizationId: string, filter?: { contractId?: string }): Promise<Obligation[]>;
  /** Like list(), but a failed read is reported instead of returning []. */
  listChecked?(organizationId: string, filter?: { contractId?: string }): Promise<{ ok: true; obligations: Obligation[] } | { ok: false }>;
  getById(organizationId: string, id: string): Promise<Obligation | null>;
  /** Like getById(), but a failed read reports "unavailable" instead of null. */
  getByIdChecked?(organizationId: string, id: string): Promise<
    { status: "found"; obligation: Obligation } | { status: "not_found" } | { status: "unavailable" }
  >;
}

export interface EvidenceRepository {
  list(organizationId: string, filter?: { contractId?: string; obligationId?: string }): Promise<Evidence[]>;
  /** Like list(), but a failed read is reported instead of returning []. */
  listChecked?(organizationId: string, filter?: { contractId?: string; obligationId?: string }): Promise<{ ok: true; evidence: Evidence[] } | { ok: false }>;
}

export interface RiskRepository {
  list(organizationId: string, filter?: { contractId?: string }): Promise<Risk[]>;
}

export interface ActionRepository {
  list(organizationId: string, filter?: { contractId?: string }): Promise<ActionItem[]>;
}

export interface ClaimRepository {
  list(organizationId: string, filter?: { contractId?: string }): Promise<Claim[]>;
  getById(organizationId: string, id: string): Promise<Claim | null>;
}

export interface AgentRepository {
  listEvents(organizationId: string, filter?: { contractId?: string; limit?: number }): Promise<AgentEvent[]>;
  /**
   * Like listEvents(), but a failed read is reported instead of returning [].
   * truncated means the bounded read hit its limit — the shown events are
   * real and complete for the window, but not necessarily all that exist.
   */
  listEventsChecked?(organizationId: string, filter?: { contractId?: string; limit?: number }): Promise<
    { ok: true; events: AgentEvent[]; truncated: boolean } | { ok: false }
  >;
}

export interface ActivityRepository {
  list(organizationId: string, filter?: { contractId?: string; limit?: number }): Promise<ActivityEntry[]>;
  /**
   * Like list(), but a failed read is reported instead of returning [].
   * truncated means the bounded window was filled — entries shown are real,
   * but older contract events may exist beyond the window.
   */
  listChecked?(organizationId: string, filter?: { contractId?: string; limit?: number }): Promise<
    { ok: true; activity: ActivityEntry[]; truncated: boolean } | { ok: false }
  >;
}

export interface DocumentRepository {
  list(organizationId: string, contractId: string): Promise<ContractDocument[]>;
}

export interface DataProvider {
  readonly kind: "mock" | "supabase";
  organizations: OrganizationRepository;
  contracts: ContractRepository;
  obligations: ObligationRepository;
  evidence: EvidenceRepository;
  risks: RiskRepository;
  actions: ActionRepository;
  claims: ClaimRepository;
  agent: AgentRepository;
  activity: ActivityRepository;
  documents: DocumentRepository;
}
