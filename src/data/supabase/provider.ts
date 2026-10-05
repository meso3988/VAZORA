import "server-only";

import type {
  ActivityEntry,
  AgentEventKind,
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
    value: row.contract_value,
    currency: row.currency,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
  };
}

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
  async listChecked(organizationId, contractId) {
    try {
      const supabase = await createSupabaseServer();
      const { data, error } = await supabase
        .from("contract_documents")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("contract_id", contractId)
        .order("created_at", { ascending: false });
      if (error || !Array.isArray(data)) return { ok: false };
      return { ok: true, documents: (data as DocRow[]).map(mapDocument) };
    } catch {
      return { ok: false };
    }
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
    return ((data ?? []) as ContractRow[]).map(mapContract);
  },
  async listChecked(organizationId) {
    try {
      const supabase = await createSupabaseServer();
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error || !Array.isArray(data)) return { ok: false };
      return { ok: true, contracts: (data as ContractRow[]).map(mapContract) };
    } catch {
      return { ok: false };
    }
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
  async getByIdChecked(organizationId, id) {
    try {
      const supabase = await createSupabaseServer();
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", id)
        .maybeSingle();
      if (error) return { status: "unavailable" as const };
      return data
        ? { status: "found" as const, contract: mapContract(data as ContractRow) }
        : { status: "not_found" as const };
    } catch {
      return { status: "unavailable" as const };
    }
  },
  async listClauses(organizationId, contractId) {
    const read = await this.listClausesChecked!(organizationId, contractId);
    return read.ok ? read.clauses : [];
  },
  async listClausesChecked(organizationId, contractId) {
    const { listContractClauses } = await import("@/data/supabase/clauses");
    const supabase = await createSupabaseServer();
    return listContractClauses(supabase, organizationId, contractId);
  },
};

type ObligationRow = {
  id: string;
  organization_id: string;
  contract_id: string;
  title: string;
  requirement_text: string;
  frequency: string | null;
  due_date_normalized: string | null;
  activation_status: string;
  review_status: string;
  ai_payload: { source_clause_number?: string | null } | null;
  created_at: string;
  obligation_evidence_requirements?: { name: string }[];
  obligation_source_refs?: { clause_id: string | null }[];
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
    clauseId: row.obligation_source_refs?.find((r) => r.clause_id)?.clause_id ?? "",
    clauseRef: row.ai_payload?.source_clause_number ?? "",
    requirement: { en: row.requirement_text, ar: row.requirement_text },
    ownerId: "",
    ownerName: "",
    // Activation is a lifecycle fact, not verification: evidence state comes
    // from requirements + effective verification (domain/obligation-state).
    lifecycle: row.activation_status === "active" ? "active" : "approved_not_active",
    cadence: CADENCE_MAP[row.frequency ?? ""] ?? "one_time",
    // Only a confidently normalized date is surfaced; an unparsed due rule
    // stays empty rather than becoming a fabricated deadline.
    dueDate: row.due_date_normalized ?? "",
    requiredEvidence: (row.obligation_evidence_requirements ?? []).map((r) => ({ en: r.name, ar: r.name })),
    evidenceIds: [],
  };
}

const obligations: ObligationRepository = {
  async list(organizationId, filter) {
    const supabase = await createSupabaseServer();
    let q = supabase
      .from("contract_obligations")
      .select("*, obligation_evidence_requirements(name), obligation_source_refs(clause_id)")
      .eq("organization_id", organizationId)
      .eq("review_status", "approved")
      .order("created_at", { ascending: true });
    if (filter?.contractId) q = q.eq("contract_id", filter.contractId);
    const { data } = await q;
    return ((data ?? []) as ObligationRow[]).map(mapObligation);
  },
  async listChecked(organizationId, filter) {
    try {
      const supabase = await createSupabaseServer();
      let q = supabase
        .from("contract_obligations")
        .select("*, obligation_evidence_requirements(name), obligation_source_refs(clause_id)")
        .eq("organization_id", organizationId)
        .eq("review_status", "approved")
        .order("created_at", { ascending: true });
      if (filter?.contractId) q = q.eq("contract_id", filter.contractId);
      const { data, error } = await q;
      if (error || !Array.isArray(data)) return { ok: false };
      return { ok: true, obligations: (data as ObligationRow[]).map(mapObligation) };
    } catch {
      return { ok: false };
    }
  },
  async getById(organizationId, id) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase
      .from("contract_obligations")
      .select("*, obligation_evidence_requirements(name), obligation_source_refs(clause_id)")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    return data ? mapObligation(data as ObligationRow) : null;
  },
  async getByIdChecked(organizationId, id) {
    try {
      const supabase = await createSupabaseServer();
      const { data, error } = await supabase
        .from("contract_obligations")
        .select("*, obligation_evidence_requirements(name), obligation_source_refs(clause_id)")
        .eq("organization_id", organizationId)
        .eq("id", id)
        .maybeSingle();
      if (error) return { status: "unavailable" as const };
      return data
        ? { status: "found" as const, obligation: mapObligation(data as ObligationRow) }
        : { status: "not_found" as const };
    } catch {
      return { status: "unavailable" as const };
    }
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

type CheckRow = {
  verification_run_id: string;
  check_label: string;
  result: string;
  human_result: string | null;
};

const evidence: EvidenceRepository = {
  async list(organizationId, filter) {
    const read = await this.listChecked!(organizationId, filter);
    return read.ok ? read.evidence : [];
  },
  async listChecked(organizationId, filter) {
    try {
    const supabase = await createSupabaseServer();
    let q = supabase
      .from("evidence_items")
      .select("*, evidence_versions(*)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (filter?.contractId) q = q.eq("contract_id", filter.contractId);
    if (filter?.obligationId) q = q.eq("obligation_id", filter.obligationId);
    const { data: itemData, error: itemError } = await q;
    if (itemError || !Array.isArray(itemData)) return { ok: false };
    const rows = itemData as EvidenceItemRow[];

    // Latest verification run per item → its per-criterion checks. The
    // effective result is coalesce(human_result, result): a human override
    // wins for display while the AI result stays on the row.
    const itemIds = rows.map((r) => r.id);
    // A failed verification-run read must not render as "no verification".
    const runsResult = itemIds.length
      ? await supabase
          .from("evidence_verification_runs")
          .select("id, evidence_item_id, overall_result, created_at")
          .eq("organization_id", organizationId)
          .in("evidence_item_id", itemIds)
          .eq("status", "completed")
          .order("created_at", { ascending: false })
      : { data: [] as { id: string; evidence_item_id: string; overall_result: string | null; created_at: string }[], error: null };
    if (runsResult.error) return { ok: false };
    const latestRunByItem = new Map<string, { id: string; overall_result: string | null }>();
    for (const r of runsResult.data ?? []) {
      if (!latestRunByItem.has(r.evidence_item_id)) {
        latestRunByItem.set(r.evidence_item_id, { id: r.id, overall_result: r.overall_result });
      }
    }
    const runIds = [...latestRunByItem.values()].map((r) => r.id);
    const checksResult = runIds.length
      ? await supabase
          .from("evidence_verification_checks")
          .select("verification_run_id, check_label, result, human_result")
          .eq("organization_id", organizationId)
          .in("verification_run_id", runIds)
          .not("evidence_requirement_id", "is", null)
      : { data: [] as CheckRow[], error: null };
    if (checksResult.error) return { ok: false };
    const checksByRun = new Map<string, CheckRow[]>();
    for (const c of checksResult.data ?? []) {
      const list = checksByRun.get(c.verification_run_id) ?? [];
      list.push(c);
      checksByRun.set(c.verification_run_id, list);
    }

    return { ok: true, evidence: rows.map((row) => {
      const versions = row.evidence_versions ?? [];
      const latest = versions.length
        ? versions.reduce((a, v) => (v.version_number > a.version_number ? v : a))
        : null;
      const latestRun = latestRunByItem.get(row.id);
      const runChecks = latestRun ? (checksByRun.get(latestRun.id) ?? []) : [];
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
        verification: {
          summary: { en: latestRun?.overall_result ?? "", ar: latestRun?.overall_result ?? "" },
          checks: runChecks.map((c) => ({
            label: { en: c.check_label, ar: c.check_label },
            passed: (c.human_result ?? c.result) === "verified",
          })),
        },
      };
    }) };
    } catch {
      return { ok: false };
    }
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

/**
 * Officer observations ARE the agent event feed for live tenants: a current
 * operational finding (its own record, deduplicated by the sweep) — never a
 * synthesized historical entry.
 */
const OBSERVATION_KIND: Record<string, AgentEventKind> = {
  overdue: "attention",
  due_today: "due_soon",
  due_soon: "due_soon",
  external_dependency_pending: "attention",
  missing_required_evidence: "evidence_gap",
  partial_evidence: "evidence_gap",
  reverification_pending: "evidence_gap",
  verification_discrepancy: "evidence_gap",
  unassigned_obligation: "attention",
  contract_expiry_approaching: "due_soon",
  action_waiting_for_approval: "attention",
};

const OBSERVATION_EVENT_LIMIT = 200;

type ObservationEventRow = {
  id: string;
  contract_id: string | null;
  obligation_id: string | null;
  kind: string;
  priority: number;
  title: string;
  detail: string | null;
  last_seen_at: string;
};

const agent: AgentRepository = {
  async listEvents(organizationId, filter) {
    const read = await this.listEventsChecked!(organizationId, filter);
    return read.ok ? read.events : [];
  },
  async listEventsChecked(organizationId, filter) {
    try {
      const supabase = await createSupabaseServer();
      const limit = Math.min(filter?.limit ?? 50, OBSERVATION_EVENT_LIMIT);
      let q = supabase
        .from("officer_observations")
        .select("id, contract_id, obligation_id, kind, priority, title, detail, last_seen_at")
        .eq("organization_id", organizationId)
        .in("status", ["active", "acknowledged"])
        .order("priority", { ascending: true })
        .order("last_seen_at", { ascending: false })
        .limit(limit + 1);
      if (filter?.contractId) q = q.eq("contract_id", filter.contractId);
      const { data, error } = await q;
      if (error || !Array.isArray(data)) return { ok: false };
      const truncated = data.length > limit;
      return {
        ok: true,
        truncated,
        events: (truncated ? data.slice(0, limit) : data).map((o: ObservationEventRow) => ({
          id: o.id,
          organizationId,
          contractId: o.contract_id ?? undefined,
          obligationId: o.obligation_id ?? undefined,
          kind: OBSERVATION_KIND[o.kind] ?? "attention",
          message: toText(o.title),
          detail: o.detail ? toText(o.detail) : undefined,
          createdAt: o.last_seen_at,
          priority: Math.min(3, Math.max(1, Number(o.priority) || 3)) as 1 | 2 | 3,
        })),
      };
    } catch {
      return { ok: false };
    }
  },
};

/**
 * activity_log labels. Rows written by the engine/sweep carry an officer
 * actor; rows written by a human click carry a member actor. The raw
 * event_type is kept as the action when no label exists — never invented.
 */
const ACTIVITY_LABELS: Record<string, { en: string; ar: string }> = {
  "contract.created": { en: "created the contract", ar: "أنشأ العقد" },
  "contract.activated": { en: "activated the contract", ar: "فعّل العقد" },
  "contract.analysis_started": { en: "started contract analysis", ar: "بدأ تحليل العقد" },
  "contract.analysis_completed": { en: "completed contract analysis", ar: "أكمل تحليل العقد" },
  "document.uploaded": { en: "uploaded a document", ar: "رفع مستندًا" },
  "obligation.approved": { en: "approved an obligation", ar: "اعتمد التزامًا" },
  "obligation.edited": { en: "edited an obligation", ar: "عدّل التزامًا" },
  "obligation.rejected": { en: "rejected an obligation", ar: "رفض التزامًا" },
  "assignment.approved": { en: "approved an assignment", ar: "اعتمد إسنادًا" },
  "evidence.created": { en: "created an evidence item", ar: "أنشأ عنصر دليل" },
  "evidence.linked": { en: "linked evidence", ar: "ربط دليلًا" },
  "evidence.version_uploaded": { en: "uploaded evidence", ar: "رفع دليلًا" },
  "evidence.human_override": { en: "recorded a human override", ar: "سجّل تجاوزًا بشريًا" },
  "evidence.verification_started": { en: "started verification", ar: "بدأ التحقق" },
  "evidence.verification_completed": { en: "completed verification", ar: "أكمل التحقق" },
  "evidence.reverification_started": { en: "started re-verification", ar: "بدأ إعادة التحقق" },
  "evidence.reverification_completed": { en: "completed re-verification", ar: "أكمل إعادة التحقق" },
  "evidence.gap_opened": { en: "opened an evidence gap", ar: "فتح فجوة دليل" },
  "evidence.gap_updated": { en: "updated an evidence gap", ar: "حدّث فجوة دليل" },
  "evidence.gap_closed": { en: "closed an evidence gap", ar: "أغلق فجوة دليل" },
  "evidence.verification_discrepancy_detected": { en: "detected a verification discrepancy", ar: "رصد تعارض تحقق" },
  "evidence.verification_previous_state_retained": { en: "retained the previous verification state", ar: "أبقى حالة التحقق السابقة" },
  "evidence.verification_regression_confirmed": { en: "confirmed a verification regression", ar: "أكد تراجعًا في التحقق" },
  "officer.brief_generated": { en: "generated the daily brief", ar: "أنشأ الموجز اليومي" },
  "officer.sweep_started": { en: "started a monitoring sweep", ar: "بدأ جولة رصد" },
  "officer.sweep_completed": { en: "completed a monitoring sweep", ar: "أكمل جولة رصد" },
  "officer.observation_created": { en: "recorded a monitoring finding", ar: "سجّل ملاحظة رصد" },
  "officer.observation_resolved": { en: "closed a monitoring finding", ar: "أغلق ملاحظة رصد" },
  "officer.observation_acknowledged": { en: "acknowledged a monitoring finding", ar: "أقرّ بملاحظة رصد" },
  "officer.action_proposed": { en: "proposed an action", ar: "اقترح إجراءً" },
  "officer.action_approved": { en: "approved an action", ar: "اعتمد إجراءً" },
  "officer.action_rejected": { en: "rejected an action", ar: "رفض إجراءً" },
  "officer.action_executed": { en: "executed an action", ar: "نفّذ إجراءً" },
  "organization.created": { en: "created the workspace", ar: "أنشأ مساحة العمل" },
};

/** Events produced by the engine itself, not a human click. */
const SYSTEM_ACTOR_EVENTS = new Set([
  "contract.analysis_started", "contract.analysis_completed",
  "evidence.verification_started", "evidence.verification_completed",
  "evidence.reverification_started", "evidence.reverification_completed",
  "evidence.gap_opened", "evidence.gap_updated", "evidence.gap_closed",
  "evidence.verification_discrepancy_detected",
  "evidence.verification_previous_state_retained",
  "evidence.verification_regression_confirmed",
  "officer.brief_generated", "officer.sweep_started", "officer.sweep_completed",
  "officer.observation_created", "officer.observation_resolved",
  "officer.action_proposed", "officer.action_executed",
]);

const OFFICER_ACTOR = "VAZORA Officer";
const MEMBER_ACTOR = "Team member";

type ActivityRow = {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  event_type: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/** entity_type → the table whose rows carry contract_id. */
const ENTITY_TABLE: Record<string, string> = {
  contract_document: "contract_documents",
  contract_obligation: "contract_obligations",
  contract_ingestion_run: "contract_ingestion_runs",
  contract_clause: "contract_clauses",
  evidence_item: "evidence_items",
  evidence_gap: "evidence_gaps",
  officer_action: "officer_actions",
  officer_observation: "officer_observations",
};

const ACTIVITY_LOG_WINDOW = 400;

function mapActivityRow(row: ActivityRow, organizationId: string, contractId: string): ActivityEntry {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    organizationId,
    contractId,
    actor: SYSTEM_ACTOR_EVENTS.has(row.event_type) ? OFFICER_ACTOR : MEMBER_ACTOR,
    action: ACTIVITY_LABELS[row.event_type] ?? { en: row.event_type, ar: row.event_type },
    target: typeof meta.file_name === "string" ? meta.file_name : undefined,
    at: row.created_at,
  };
}

const activity: ActivityRepository = {
  async list(organizationId, filter) {
    const read = await this.listChecked!(organizationId, filter);
    return read.ok ? read.activity : [];
  },
  async listChecked(organizationId, filter) {
    try {
      const supabase = await createSupabaseServer();
      const limit = Math.min(filter?.limit ?? 50, 100);
      const contractId = filter?.contractId;

      // Read a bounded newest-first window of the organization's audit log.
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, entity_type, entity_id, event_type, actor_user_id, metadata, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(contractId ? ACTIVITY_LOG_WINDOW : limit + 1);
      if (error || !Array.isArray(data)) return { ok: false };
      let rows = data as ActivityRow[];
      let truncated = rows.length > (contractId ? ACTIVITY_LOG_WINDOW : limit);

      if (contractId) {
        // Contract membership is resolved per entity_type — the log itself
        // does not denormalize contract_id and an unrelated org event must
        // never appear on a contract timeline.
        const idsByType = new Map<string, string[]>();
        for (const r of rows) {
          if (!r.entity_type || !r.entity_id) continue;
          const list = idsByType.get(r.entity_type) ?? [];
          list.push(r.entity_id);
          idsByType.set(r.entity_type, list);
        }
        const belongs = new Set<string>([contractId]);
        const resolve = async (entityType: string, ids: string[]) => {
          if (entityType === "contract") {
            ids.forEach((i) => { if (i === contractId) belongs.add(i); });
            return true;
          }
          const table = ENTITY_TABLE[entityType];
          if (!table || !ids.length) return true;
          const { data: owned, error: e } = await supabase
            .from(table).select("id").eq("organization_id", organizationId)
            .eq("contract_id", contractId).in("id", [...new Set(ids)]);
          if (e || !Array.isArray(owned)) return false;
          for (const o of owned) belongs.add(o.id as string);
          return true;
        };
        for (const [entityType, ids] of idsByType) {
          if (!(await resolve(entityType, ids))) return { ok: false };
        }
        rows = rows.filter(
          (r) =>
            (r.entity_id && belongs.has(r.entity_id)) ||
            (r.metadata as Record<string, unknown> | null)?.contract_id === contractId,
        );
        if (rows.length > limit) {
          rows = rows.slice(0, limit);
          truncated = true;
        }
      } else if (truncated) {
        rows = rows.slice(0, limit);
      }

      return { ok: true, truncated, activity: rows.map((r) => mapActivityRow(r, organizationId, contractId ?? "")) };
    } catch {
      return { ok: false };
    }
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
