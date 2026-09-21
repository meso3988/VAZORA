import "server-only";

import type {
  CheckResult,
  EvidenceGapView,
  EvidenceInboxRow,
  EvidenceItemDetail,
  EvidenceItemStatus,
  EvidenceMatrixRow,
  EvidenceRequirementView,
  EvidenceVersionView,
  VerificationDiscrepancyView,
  ObligationContext,
  VerificationCheckView,
  VerificationRunView,
} from "@/domain/evidence";
import { effectiveItemStatus, effectiveStatusForRequirement } from "@/domain/effective-status";
import { createSupabaseServer } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createSupabaseServer>>;

/* eslint-disable @typescript-eslint/no-explicit-any */

function mapCheck(row: any): VerificationCheckView {
  return {
    id: row.id,
    requirementId: row.evidence_requirement_id,
    checkLabel: row.check_label,
    checkKind: row.check_kind,
    result: row.result,
    confidence: row.confidence,
    reason: row.reason,
    sourceExcerpt: row.source_excerpt,
    sourceLocation: row.source_location,
    sourcePage: row.source_page,
    provider: row.provider,
    model: row.model,
    humanResult: row.human_result,
    humanReason: row.human_reason,
    overriddenBy: row.overridden_by,
    overriddenAt: row.overridden_at,
  };
}

function mapRun(row: any, checks: VerificationCheckView[]): VerificationRunView {
  return {
    id: row.id,
    status: row.status,
    overall: row.overall_result,
    evidenceVersionId: row.evidence_version_id,
    provider: row.verifier_provider,
    model: row.verifier_model,
    checkCount: row.check_count ?? 0,
    verifiedCount: row.verified_count ?? 0,
    errorCode: row.error_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    checks,
  };
}

function mapGap(row: any): EvidenceGapView {
  return {
    id: row.id,
    requirementId: row.evidence_requirement_id,
    gapType: row.gap_type,
    status: row.status,
    description: row.description,
    verificationRunId: row.verification_run_id,
    closedByRunId: row.closed_by_verification_run_id,
    openedVia: (row.opened_via as string) ?? "verification_run",
    createdAt: row.created_at,
  };
}

function mapDiscrepancy(row: any): VerificationDiscrepancyView {
  return {
    id: row.id,
    requirementId: row.evidence_requirement_id,
    evidenceVersionId: row.evidence_version_id,
    priorResult: row.prior_result,
    currentResult: row.current_result,
    priorCheckId: row.prior_check_id,
    currentCheckId: row.current_check_id,
    priorRunId: row.prior_run_id,
    currentRunId: row.current_run_id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
  };
}

async function obligationContext(
  supabase: Supa,
  orgId: string,
  obligationId: string,
): Promise<ObligationContext | null> {
  const { data: ob } = await supabase
    .from("contract_obligations")
    .select("id, title, requirement_text, frequency, due_rule_raw, due_date_normalized, ai_payload")
    .eq("organization_id", orgId)
    .eq("id", obligationId)
    .maybeSingle();
  if (!ob) return null;

  // Original clause — prefer the FK'd source_ref, fall back to the extracted
  // clause number recorded during ingestion.
  const { data: ref } = await supabase
    .from("obligation_source_refs")
    .select("clause_id, page_number, document_id, source_snippet")
    .eq("organization_id", orgId)
    .eq("obligation_id", obligationId)
    .limit(1)
    .maybeSingle();
  let clauseText: string | null = null;
  let clausePage: number | null = (ref?.page_number as number | null) ?? null;
  if (ref?.clause_id) {
    const { data: clause } = await supabase
      .from("contract_clauses")
      .select("text, page_number")
      .eq("organization_id", orgId)
      .eq("id", ref.clause_id)
      .maybeSingle();
    clauseText = (clause?.text as string | null) ?? null;
    clausePage = (clause?.page_number as number | null) ?? clausePage;
  }
  const payload = (ob.ai_payload ?? {}) as { source_clause_number?: string | null };
  return {
    id: ob.id as string,
    title: ob.title as string,
    requirementText: ob.requirement_text as string,
    clauseRef: payload.source_clause_number ?? null,
    clauseText,
    clausePage,
    documentId: (ref?.document_id as string | null) ?? null,
    dueContext:
      (ob.due_rule_raw as string | null) ??
      (ob.due_date_normalized as string | null) ??
      (ob.frequency as string | null),
  };
}

async function fetchRunsAndChecks(
  supabase: Supa,
  orgId: string,
  itemIds: string[],
): Promise<VerificationRunView[]> {
  if (!itemIds.length) return [];
  const { data: runRows } = await supabase
    .from("evidence_verification_runs")
    .select("*")
    .eq("organization_id", orgId)
    .in("evidence_item_id", itemIds)
    .order("created_at", { ascending: false });
  const runs = runRows ?? [];
  const runIds = runs.map((r) => r.id as string);
  const { data: checkRows } = runIds.length
    ? await supabase
        .from("evidence_verification_checks")
        .select("*")
        .eq("organization_id", orgId)
        .in("verification_run_id", runIds)
        .order("created_at", { ascending: true })
    : { data: [] as any[] };
  const byRun = new Map<string, VerificationCheckView[]>();
  for (const c of checkRows ?? []) {
    const list = byRun.get(c.verification_run_id) ?? [];
    list.push(mapCheck(c));
    byRun.set(c.verification_run_id, list);
  }
  return runs.map((r) => mapRun(r, byRun.get(r.id) ?? []));
}

/**
 * Full inspector payload for one evidence item — versions, runs with
 * criterion checks (AI + human override), linked requirements, obligation
 * context, and gaps. Tenant-scoped everywhere; RLS enforces the same.
 */
export async function getEvidenceItemDetail(
  orgId: string,
  itemId: string,
): Promise<EvidenceItemDetail | null> {
  const supabase = await createSupabaseServer();

  const { data: item } = await supabase
    .from("evidence_items")
    .select("id, contract_id, obligation_id, title, evidence_type, status, created_by, created_at")
    .eq("organization_id", orgId)
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return null;

  const { data: contract } = await supabase
    .from("contracts")
    .select("title")
    .eq("organization_id", orgId)
    .eq("id", item.contract_id)
    .maybeSingle();

  const [{ data: versionRows }, { data: linkRows }, runs] = await Promise.all([
    supabase
      .from("evidence_versions")
      .select("id, version_number, file_name, mime_type, file_size, uploaded_by, uploaded_at")
      .eq("organization_id", orgId)
      .eq("evidence_item_id", itemId)
      .order("version_number", { ascending: false }),
    supabase
      .from("evidence_requirement_links")
      .select("evidence_requirement_id, evidence_version_id")
      .eq("organization_id", orgId)
      .eq("evidence_item_id", itemId),
    fetchRunsAndChecks(supabase, orgId, [itemId]),
  ]);

  const reqIds = [...new Set((linkRows ?? []).map((l) => l.evidence_requirement_id as string))];
  const { data: reqRows } = reqIds.length
    ? await supabase
        .from("obligation_evidence_requirements")
        .select("id, obligation_id, name, description, evidence_type, required")
        .eq("organization_id", orgId)
        .in("id", reqIds)
    : { data: [] as any[] };

  const requirements: EvidenceRequirementView[] = (reqRows ?? []).map((r) => ({
    id: r.id,
    obligationId: r.obligation_id,
    name: r.name,
    description: r.description,
    evidenceType: r.evidence_type,
    required: r.required ?? true,
  }));

  const { data: gapRows } = reqIds.length
    ? await supabase
        .from("evidence_gaps")
        .select("*")
        .eq("organization_id", orgId)
        .in("evidence_requirement_id", reqIds)
        .order("created_at", { ascending: false })
    : { data: [] as any[] };

  const { data: discrepancyRows } = await supabase
    .from("evidence_verification_discrepancies")
    .select("*")
    .eq("organization_id", orgId)
    .eq("evidence_item_id", itemId)
    .order("created_at", { ascending: false });

  const linkVersionByRequirement: Record<string, string | null> = {};
  for (const l of linkRows ?? []) {
    linkVersionByRequirement[l.evidence_requirement_id as string] =
      (l.evidence_version_id as string | null) ?? null;
  }

  const obligation = item.obligation_id
    ? await obligationContext(supabase, orgId, item.obligation_id)
    : null;

  // Every requirement on the obligation — drives the linking UI and the
  // "what was required" completeness story, linked or not.
  const { data: allReqRows } = item.obligation_id
    ? await supabase
        .from("obligation_evidence_requirements")
        .select("id, obligation_id, name, description, evidence_type, required")
        .eq("organization_id", orgId)
        .eq("obligation_id", item.obligation_id)
        .order("created_at", { ascending: true })
    : { data: [] as any[] };
  const obligationRequirements: EvidenceRequirementView[] = (allReqRows ?? []).map((r) => ({
    id: r.id,
    obligationId: r.obligation_id,
    name: r.name,
    description: r.description,
    evidenceType: r.evidence_type,
    required: r.required ?? true,
  }));

  return {
    id: item.id,
    contractId: item.contract_id,
    contractTitle: (contract?.title as string) ?? "",
    obligationId: item.obligation_id,
    obligation,
    title: item.title,
    evidenceType: item.evidence_type,
    status: item.status as EvidenceItemStatus,
    createdBy: item.created_by,
    createdAt: item.created_at,
    versions: (versionRows ?? []).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      fileName: v.file_name,
      mimeType: v.mime_type,
      fileSize: v.file_size,
      uploadedBy: v.uploaded_by,
      uploadedAt: v.uploaded_at,
    })) as EvidenceVersionView[],
    requirements,
    obligationRequirements,
    linkVersionByRequirement,
    runs,
    gaps: (gapRows ?? []).map(mapGap),
    discrepancies: (discrepancyRows ?? []).map(mapDiscrepancy),
  };
}

const OPEN_GAP_STATES = ["open", "evidence_received", "reverification_pending"];

/**
 * Contract Evidence Matrix — one row per required criterion on approved
 * obligations. Collapses certainty (verified rows stay compact) and surfaces
 * exceptions (open gaps, unlinked criteria, unproven results).
 */
export async function getContractEvidenceMatrix(
  orgId: string,
  contractId: string,
): Promise<EvidenceMatrixRow[]> {
  const supabase = await createSupabaseServer();

  const { data: obRows } = await supabase
    .from("contract_obligations")
    .select("id, title, requirement_text, frequency, due_rule_raw, due_date_normalized, ai_payload")
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .eq("review_status", "approved")
    .order("created_at", { ascending: true });
  const obligations = obRows ?? [];
  if (!obligations.length) return [];

  const obIds = obligations.map((o) => o.id as string);
  const { data: reqRows } = await supabase
    .from("obligation_evidence_requirements")
    .select("id, obligation_id, name, description, evidence_type, required")
    .eq("organization_id", orgId)
    .in("obligation_id", obIds)
    .order("created_at", { ascending: true });
  const requirements = (reqRows ?? []) as any[];
  if (!requirements.length) return [];

  const reqIds = requirements.map((r) => r.id as string);
  const [{ data: linkRows }, { data: gapRows }, { data: checkRows }, { data: itemRows }, { data: discRows }] = await Promise.all([
    supabase
      .from("evidence_requirement_links")
      .select("evidence_requirement_id, evidence_item_id")
      .eq("organization_id", orgId)
      .in("evidence_requirement_id", reqIds),
    supabase
      .from("evidence_gaps")
      .select("*")
      .eq("organization_id", orgId)
      .in("evidence_requirement_id", reqIds)
      .in("status", OPEN_GAP_STATES)
      .order("created_at", { ascending: false }),
    // Latest criterion check per requirement — completed runs only, newest wins.
    supabase
      .from("evidence_verification_checks")
      .select("evidence_requirement_id, result, human_result, created_at, verification_run_id")
      .eq("organization_id", orgId)
      .in("evidence_requirement_id", reqIds)
      .order("created_at", { ascending: false }),
    supabase
      .from("evidence_items")
      .select("id, status")
      .eq("organization_id", orgId)
      .eq("contract_id", contractId),
    supabase
      .from("evidence_verification_discrepancies")
      .select("*")
      .eq("organization_id", orgId)
      .in("evidence_requirement_id", reqIds)
      .order("created_at", { ascending: false }),
  ]);

  // Version the newest run examined per requirement — effective status is
  // only held for the SAME version the discrepancy was raised on.
  const latestRunIds = [
    ...new Set((checkRows ?? []).map((c) => c.verification_run_id as string).filter(Boolean)),
  ];
  const { data: runVersionRows } = latestRunIds.length
    ? await supabase
        .from("evidence_verification_runs")
        .select("id, evidence_version_id")
        .eq("organization_id", orgId)
        .in("id", latestRunIds)
    : { data: [] as any[] };
  const versionByRun = new Map<string, string>(
    (runVersionRows ?? []).map((r: any) => [r.id as string, r.evidence_version_id as string]),
  );
  const discrepancies = (discRows ?? []).map(mapDiscrepancy);

  const itemStatusById = new Map<string, EvidenceItemStatus>();
  for (const it of itemRows ?? []) itemStatusById.set(it.id as string, it.status as EvidenceItemStatus);
  const linkedItems = new Map<string, Set<string>>();
  for (const l of linkRows ?? []) {
    const set = linkedItems.get(l.evidence_requirement_id) ?? new Set<string>();
    set.add(l.evidence_item_id as string);
    linkedItems.set(l.evidence_requirement_id, set);
  }
  const gapByReq = new Map<string, EvidenceGapView>();
  for (const g of gapRows ?? []) {
    if (!gapByReq.has(g.evidence_requirement_id)) gapByReq.set(g.evidence_requirement_id, mapGap(g));
  }
  const latestCheckByReq = new Map<
    string,
    { result: CheckResult; human: CheckResult | null; itemId: string | null; versionId: string | null }
  >();
  for (const c of checkRows ?? []) {
    const key = c.evidence_requirement_id as string;
    if (!latestCheckByReq.has(key)) {
      latestCheckByReq.set(key, {
        result: c.result,
        human: c.human_result,
        itemId: null,
        versionId: versionByRun.get(c.verification_run_id as string) ?? null,
      });
    }
  }
  // One evidence item per requirement for navigation — newest linked item.
  const itemByReq = new Map<string, string>();
  for (const l of linkRows ?? []) {
    if (!itemByReq.has(l.evidence_requirement_id)) {
      itemByReq.set(l.evidence_requirement_id, l.evidence_item_id as string);
    }
  }

  const obContext = new Map<string, ObligationContext>();
  for (const o of obligations) {
    const payload = (o.ai_payload ?? {}) as { source_clause_number?: string | null };
    obContext.set(o.id as string, {
      id: o.id as string,
      title: o.title as string,
      requirementText: o.requirement_text as string,
      clauseRef: payload.source_clause_number ?? null,
      clauseText: null,
      clausePage: null,
      documentId: null,
      dueContext:
        (o.due_rule_raw as string | null) ??
        (o.due_date_normalized as string | null) ??
        (o.frequency as string | null),
    });
  }

  return requirements.map((r) => {
    const latest = latestCheckByReq.get(r.id);
    const latestResult = (latest?.human ?? latest?.result) ?? null;
    return {
      requirement: {
        id: r.id,
        obligationId: r.obligation_id,
        name: r.name,
        description: r.description,
        evidenceType: r.evidence_type,
        required: r.required ?? true,
      },
      obligation: obContext.get(r.obligation_id)!,
      linkedItemCount: linkedItems.get(r.id)?.size ?? 0,
      latestResult,
      latestItemId: itemByReq.get(r.id) ?? null,
      latestItemStatus: itemStatusById.get(itemByReq.get(r.id) ?? "") ?? null,
      effectiveHuman: latest?.human != null,
      gap: gapByReq.get(r.id) ?? null,
      effective: effectiveStatusForRequirement({
        requirementId: r.id as string,
        latestResult,
        latestVersionId: latest?.versionId ?? null,
        humanOverridden: latest?.human != null,
        discrepancies,
      }),
    };
  });
}

/**
 * Evidence Inbox — operational queue, exceptions first. Each row carries
 * enough context to answer: what is this, for which obligation, what is
 * wrong, what should happen next.
 */
export async function listEvidenceInbox(orgId: string): Promise<EvidenceInboxRow[]> {
  const supabase = await createSupabaseServer();

  const { data: items } = await supabase
    .from("evidence_items")
    .select("id, contract_id, obligation_id, title, status, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });
  const rows = (items ?? []) as any[];
  if (!rows.length) return [];

  const itemIds = rows.map((r) => r.id as string);
  const contractIds = [...new Set(rows.map((r) => r.contract_id as string))];
  const obligationIds = [...new Set(rows.map((r) => r.obligation_id).filter(Boolean))] as string[];

  const [{ data: versionRows }, { data: linkRows }, { data: contractRows }, { data: obRows }, { data: gapRows }, { data: pendingDiscRows }] =
    await Promise.all([
      supabase
        .from("evidence_versions")
        .select("evidence_item_id, version_number, file_name, uploaded_by, uploaded_at")
        .eq("organization_id", orgId)
        .in("evidence_item_id", itemIds)
        .order("version_number", { ascending: false }),
      supabase
        .from("evidence_requirement_links")
        .select("evidence_item_id, evidence_requirement_id")
        .eq("organization_id", orgId)
        .in("evidence_item_id", itemIds),
      supabase.from("contracts").select("id, title").eq("organization_id", orgId).in("id", contractIds),
      obligationIds.length
        ? supabase.from("contract_obligations").select("id, title").eq("organization_id", orgId).in("id", obligationIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("evidence_gaps")
        .select("evidence_requirement_id, status")
        .eq("organization_id", orgId)
        .in("status", OPEN_GAP_STATES),
      // pending = awaiting review; kept_prior = retained by a human. Both
      // still hold the previously accepted operational state in force.
      supabase
        .from("evidence_verification_discrepancies")
        .select("evidence_item_id, status")
        .eq("organization_id", orgId)
        .in("status", ["pending", "kept_prior"])
        .in("evidence_item_id", itemIds),
    ]);

  const pendingDiscByItem = new Map<string, number>();
  const heldDiscByItem = new Map<string, number>();
  for (const d of pendingDiscRows ?? []) {
    const key = d.evidence_item_id as string;
    heldDiscByItem.set(key, (heldDiscByItem.get(key) ?? 0) + 1);
    if (d.status === "pending") pendingDiscByItem.set(key, (pendingDiscByItem.get(key) ?? 0) + 1);
  }

  const latestVersion = new Map<string, any>();
  for (const v of versionRows ?? []) {
    if (!latestVersion.has(v.evidence_item_id)) latestVersion.set(v.evidence_item_id, v);
  }
  const linksByItem = new Map<string, Set<string>>();
  for (const l of linkRows ?? []) {
    const set = linksByItem.get(l.evidence_item_id) ?? new Set<string>();
    set.add(l.evidence_requirement_id as string);
    linksByItem.set(l.evidence_item_id, set);
  }
  const contractTitle = new Map((contractRows ?? []).map((c: any) => [c.id, c.title]));
  const obTitle = new Map((obRows ?? []).map((o: any) => [o.id, o.title]));

  // Open gaps attributed to an item via its linked requirements.
  const reqToItems = new Map<string, Set<string>>();
  for (const l of linkRows ?? []) {
    const set = reqToItems.get(l.evidence_requirement_id) ?? new Set<string>();
    set.add(l.evidence_item_id as string);
    reqToItems.set(l.evidence_requirement_id, set);
  }
  const openGapsByItem = new Map<string, number>();
  for (const g of gapRows ?? []) {
    for (const itemId of reqToItems.get(g.evidence_requirement_id) ?? []) {
      openGapsByItem.set(itemId, (openGapsByItem.get(itemId) ?? 0) + 1);
    }
  }

  return rows.map((r) => {
    const v = latestVersion.get(r.id);
    const linked = linksByItem.get(r.id)?.size ?? 0;
    const openGapCount = openGapsByItem.get(r.id) ?? 0;
    const pendingDiscrepancyCount = pendingDiscByItem.get(r.id) ?? 0;
    const heldDiscrepancyCount = heldDiscByItem.get(r.id) ?? 0;
    return {
      itemId: r.id,
      title: r.title,
      contractId: r.contract_id,
      contractTitle: contractTitle.get(r.contract_id) ?? "",
      obligationTitle: r.obligation_id ? (obTitle.get(r.obligation_id) ?? null) : null,
      status: r.status as EvidenceItemStatus,
      version: (v?.version_number as number) ?? 0,
      fileName: (v?.file_name as string) ?? r.title,
      uploadedAt: (v?.uploaded_at as string) ?? r.created_at,
      uploadedBy: (v?.uploaded_by as string | null) ?? null,
      openGapCount,
      unlinkedCount: r.obligation_id ? 0 : linked === 0 ? 1 : 0,
      needsOverrideReview: false,
      pendingDiscrepancyCount,
      heldDiscrepancyCount,
      effectiveStatus: effectiveItemStatus({
        runStatus: r.status as EvidenceItemStatus,
        heldDiscrepancyCount,
        openGapCount,
      }),
    };
  });
}
