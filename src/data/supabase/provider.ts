import "server-only";

import type {
  Contract,
  Organization,
  OrganizationMember,
  Project,
} from "@/domain/types";
import type {
  ActivityRepository,
  ActionRepository,
  AgentRepository,
  ClaimRepository,
  ContractRepository,
  DataProvider,
  EvidenceRepository,
  ObligationRepository,
  OrganizationRepository,
  RiskRepository,
} from "@/data/repositories";
import { createSupabaseServer } from "@/lib/supabase/server";

type OrgRow = { id: string; name: string; slug: string; created_at: string };
type MemberRow = { organization_id: string; user_id: string; role: OrganizationMember["role"] };
type ProjectRow = {
  id: string;
  organization_id: string;
  name: string;
}
type ContractRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  contract_number: string;
  title: string;
  client_name: string | null;
  contract_value: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "mobilizing" | "closeout" | "archived";
};

function toText(value: string | null | undefined) {
  const v = value ?? "";
  return { en: v, ar: v };
}

function mapOrganization(row: OrgRow): Organization {
  return {
    id: row.id,
    name: toText(row.name),
    slug: row.slug,
    country: "SA",
    createdAt: row.created_at,
  };
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: toText(row.name),
    client: toText(""),
    sector: "government",
  };
}

function mapContract(row: ContractRow): Contract {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id ?? "",
    reference: row.contract_number,
    title: toText(row.title),
    client: toText(row.client_name),
    sector: "government",
    status: row.status === "closeout" ? "closeout" : row.status === "archived" ? "closeout" : "active",
    value: row.contract_value ?? 0,
    currency: row.currency,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
    health: {
      obligationsTotal: 0,
      obligationsDueThisMonth: 0,
      obligationsOverdue: 0,
      evidenceCoverage: 0,
      risksOpen: 0,
      riskExposure: 0,
      claimReadiness: 0,
    },
  };
}

const ZERO_HEALTH_CONTRACT = (row: ContractRow): Contract => mapContract(row);

const organizations: OrganizationRepository = {
  async getById(id) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.from("organizations").select("*").eq("id", id).maybeSingle();
    return data ? mapOrganization(data as OrgRow) : null;
  },
  async listMembers(organizationId) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("organization_members")
      .select("*")
      .eq("organization_id", organizationId);
    return ((data ?? []) as MemberRow[]).map((m) => ({
      id: `${m.organization_id}:${m.user_id}`,
      organizationId: m.organization_id,
      userId: m.user_id,
      name: "",
      email: "",
      role: m.role,
    }));
  },
  async listProjects(organizationId) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("projects")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    return ((data ?? []) as ProjectRow[]).map(mapProject);
  },
};

const contracts: ContractRepository = {
  async list(organizationId) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("contracts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    return ((data ?? []) as ContractRow[]).map(ZERO_HEALTH_CONTRACT);
  },
  async getById(organizationId, id) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("contracts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    return data ? mapContract(data as ContractRow) : null;
  },
  async listClauses() {
    return [];
  },
};

const obligations: ObligationRepository = {
  async list() {
    return [];
  },
  async getById() {
    return null;
  },
};

const evidence: EvidenceRepository = {
  async list() {
    return [];
  },
};

const risks: RiskRepository = {
  async list() {
    return [];
  },
};

const actions: ActionRepository = {
  async list() {
    return [];
  },
};

const claims: ClaimRepository = {
  async list() {
    return [];
  },
  async getById() {
    return null;
  },
};

const agent: AgentRepository = {
  async listEvents() {
    return [];
  },
};

const activity: ActivityRepository = {
  async list() {
    return [];
  },
};

/**
 * Real tenant data over the existing repository seams. Repositories mapped to
 * not-yet-built schema (obligations, evidence, risks, claims, agent events)
 * return empty collections so live tenants see honest empty states — never
 * mock fixtures.
 */
export function createSupabaseDataProvider(): DataProvider {
  return {
    kind: "supabase",
    organizations,
    contracts,
    obligations,
    evidence,
    risks,
    actions,
    claims,
    agent,
    activity,
  };
}
