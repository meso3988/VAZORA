import type {
  ActionItem,
  ActivityEntry,
  AgentEvent,
  Claim,
  Clause,
  Contract,
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
  getById(organizationId: string, id: string): Promise<Contract | null>;
  listClauses(organizationId: string, contractId: string): Promise<Clause[]>;
}

export interface ObligationRepository {
  list(organizationId: string, filter?: { contractId?: string }): Promise<Obligation[]>;
  getById(organizationId: string, id: string): Promise<Obligation | null>;
}

export interface EvidenceRepository {
  list(organizationId: string, filter?: { contractId?: string; obligationId?: string }): Promise<Evidence[]>;
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
}

export interface ActivityRepository {
  list(organizationId: string, filter?: { contractId?: string; limit?: number }): Promise<ActivityEntry[]>;
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
}
