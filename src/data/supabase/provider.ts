import "server-only";

import type {
  Contract,
  ContractDocument,
  Evidence,
  Obligation,
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
  DocumentRepository,
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
type DocRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  document_type: ContractDocument["documentType"];
  uploaded_by: string | null;
  created_at: string;
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

function mapDocument(row: DocRow): ContractDocument {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contractId: row.contract_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    documentType: row.document_type,
    uploadedBy: row.uploaded_by ?? "",
    createdAt: row.created_at,
  };
}

const documents: DocumentRepository = {
  async list(organizationId, contractId) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("contract_documents")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .order("created_at", { ascending: false });
    return ((data ?? []) as DocRow[]).map(mapDocument);
  },
};

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

type ObligationRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  title: string;
  requirement_text: string;
  frequency: string | null;
  activation_status: string;
  review_status: string;
  ai_payload: { source_clause_number?: string | null } | null;
  created_at: string;
  obligation_evidence_requirements?: { name: string }[];
};

const CADENCE_MAP: Record<string, Obligation["cadence"]> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
};

function mapObligation(row: ObligationRow): Obligation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contractId: row.contract_id,
    clauseId: "",
    clauseRef: row.ai_payload?.source_clause_number ?? "",
    requirement: { en: row.requirement_text, ar: row.requirement_text },
    ownerId: "",
    ownerName: "",
    status: row.activation_status === "active" ? "verified" : row.review_status === "rejected" ? "missing" : "pending",
    cadence: CADENCE_MAP[row.frequency ?? ""] ?? "one_time",
    dueDate: "",
    requiredEvidence: (row.obligation_evidence_requirements ?? []).map((r) => ({ en: r.name, ar: r.name })),
    evidenceIds: [],
  };
}

const obligations: ObligationRepository = {
  async list(organizationId, filter) {
    const supabase = await createSupabaseServer();
    let q = supabase
      .from("contract_obligations")
      .select("*, obligation_evidence_requirements(name)")
      .eq("organization_id", organizationId)
      .neq("review_status", "rejected")
      .order("created_at", { ascending: true });
    if (filter?.contractId) q = q.eq("contract_id", filter.contractId);
    const { data } = await q;
    return ((data ?? []) as ObligationRow[]).map(mapObligation);
  },
  async getById(organizationId, id) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("contract_obligations")
      .select("*, obligation_evidence_requirements(name)")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    return data ? mapObligation(data as ObligationRow) : null;
  },
};

type EvidenceItemRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  obligation_id: string | null;
  title: string;
  status: string;
  created_at: string;
  evidence_versions?: {
    id: string;
    version_number: number;
    file_name: string;
    mime_type: string;
    uploaded_by: string | null;
    uploaded_at: string;
  }[];
};

const EVIDENCE_STATUS_MAP: Record<string, Evidence["status"]> = {
  verified: "verified",
  partially_verified: "partial",
  rejected: "rejected",
};

const evidence: EvidenceRepository = {
  async list(organizationId, filter) {
    const supabase = await createSupabaseServer();
    let q = supabase
      .from("evidence_items")
      .select("*, evidence_versions(*)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (filter?.contractId) q = q.eq("contract_id", filter.contractId);
    if (filter?.obligationId) q = q.eq("obligation_id", filter.obligationId);
    const { data } = await q;
    return ((data ?? []) as EvidenceItemRow[]).map((row) => {
      const versions = row.evidence_versions ?? [];
      const latest = versions.length
        ? versions.reduce((a, v) => (v.version_number > a.version_number ? v : a))
        : null;
      return {
        id: row.id,
        organizationId: row.organization_id,
        contractId: row.contract_id,
        obligationId: row.obligation_id ?? "",
        fileName: latest?.file_name ?? row.title,
        fileType: (latest?.mime_type ?? "").split("/").pop()?.split(".").pop() ?? "file",
        uploadedBy: latest?.uploaded_by ?? "",
        uploadedAt: latest?.uploaded_at ?? row.created_at,
        version: latest?.version_number ?? 0,
        status: EVIDENCE_STATUS_MAP[row.status] ?? "pending",
        verification: { summary: { en: "", ar: "" }, checks: [] },
      };
    });
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
    documents,
  };
}
