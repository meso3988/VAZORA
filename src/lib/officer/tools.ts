import "server-only";

import { z } from "zod";

import { effectiveItemStatus, effectiveStatusForRequirement } from "@/domain/effective-status";
import type { OfficerCitation } from "@/domain/officer";
import { authorizeAction, classifyAction, type ToolClass } from "@/lib/officer/authority";
import type { OfficerContext } from "@/lib/officer/context";
import { classifyDeadline } from "@/lib/officer/time";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Contract Officer tool registry.
 *
 * The model may call these by name with validated arguments. It never
 * receives a database handle, SQL, a service-role key, or the ability to
 * name an organization: `ctx.organizationId` is injected server-side from
 * the session and RLS independently re-checks every statement.
 *
 * Structured data first — dates, statuses, owners, evidence and gaps are
 * answered from VAZORA tables, never from embeddings or model memory.
 */

export type ToolResult =
  | { ok: true; data: unknown; citations: OfficerCitation[]; summary: string }
  | { ok: false; error: string };

export type OfficerTool = {
  name: string;
  toolClass: ToolClass;
  description: string;
  /** zod schema for model-supplied arguments — organization ids are never accepted */
  input: z.ZodTypeAny;
  handler: (ctx: OfficerContext, args: any) => Promise<ToolResult>;
};

const ok = (data: unknown, citations: OfficerCitation[], summary: string): ToolResult =>
  ({ ok: true, data, citations, summary });

const empty = z.object({}).strict();

/**
 * Resolve a caller-supplied contract id inside the caller's organization.
 * A model-hallucinated or cross-tenant id resolves to null here and is
 * refused before any further query runs.
 */
async function resolveContract(ctx: OfficerContext, contractId: string) {
  const { data } = await ctx.supabase
    .from("contracts")
    .select("id, contract_number, title, client_name, status, start_date, end_date, contract_value, currency")
    .eq("organization_id", ctx.organizationId)
    .eq("id", contractId)
    .maybeSingle();
  return data ?? null;
}

const cite = (
  target: OfficerCitation["target"],
  id: string,
  label: string,
  contractId?: string | null,
  href?: string | null,
): OfficerCitation => ({ target, id, label, contractId: contractId ?? null, href: href ?? null });

/** Only approved + active obligations are operational truth. */
const OPERATIONAL_OBLIGATION = { review_status: "approved", activation_status: "active" } as const;

const OPEN_GAP_STATES = ["open", "evidence_received", "reverification_pending"];

// ---------------------------------------------------------------------------
// READ_ONLY tools
// ---------------------------------------------------------------------------

const getOrganizationSummary: OfficerTool = {
  name: "getOrganizationSummary",
  toolClass: "READ_ONLY",
  description:
    "Organization name, local date/time and timezone, contract counts, and counts of open gaps, pending verification discrepancies and actions awaiting approval.",
  input: empty,
  handler: async (ctx) => {
    const [{ data: contracts }, { count: openGaps }, { count: pendingDiscrepancies }, { count: waitingActions }] =
      await Promise.all([
        ctx.supabase.from("contracts").select("id, status").eq("organization_id", ctx.organizationId),
        ctx.supabase.from("evidence_gaps").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId).in("status", OPEN_GAP_STATES),
        ctx.supabase.from("evidence_verification_discrepancies").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId).eq("status", "pending"),
        ctx.supabase.from("officer_actions").select("id", { count: "exact", head: true })
          .eq("organization_id", ctx.organizationId).in("status", ["suggested", "waiting_for_approval"]),
      ]);
    const rows = contracts ?? [];
    return ok(
      {
        organization: ctx.organizationName,
        clock: ctx.clock,
        contracts: { total: rows.length, active: rows.filter((c: any) => c.status === "active").length },
        openGaps: openGaps ?? 0,
        pendingVerificationDiscrepancies: pendingDiscrepancies ?? 0,
        actionsAwaitingApproval: waitingActions ?? 0,
      },
      [],
      `${rows.length} contracts · ${openGaps ?? 0} open gaps · ${pendingDiscrepancies ?? 0} pending discrepancies`,
    );
  },
};

const listContracts: OfficerTool = {
  name: "listContracts",
  toolClass: "READ_ONLY",
  description: "List the organization's contracts with number, title, client, status and dates.",
  input: z.object({ status: z.enum(["active", "mobilizing", "closeout", "archived"]).optional() }).strict(),
  handler: async (ctx, args) => {
    let q = ctx.supabase
      .from("contracts")
      .select("id, contract_number, title, client_name, status, start_date, end_date")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });
    if (args.status) q = q.eq("status", args.status);
    const { data } = await q;
    const rows = data ?? [];
    return ok(
      rows,
      rows.map((c: any) => cite("contract", c.id, `${c.contract_number} — ${c.title}`, c.id, `/app/contracts/${c.id}`)),
      `${rows.length} contracts`,
    );
  },
};

const getContract: OfficerTool = {
  name: "getContract",
  toolClass: "READ_ONLY",
  description: "One contract's metadata, documents and operational obligation counts.",
  input: z.object({ contractId: z.string().uuid() }).strict(),
  handler: async (ctx, args) => {
    const contract = await resolveContract(ctx, args.contractId);
    if (!contract) return { ok: false, error: "contract_not_found_in_organization" };
    const [{ data: docs }, { data: obligations }] = await Promise.all([
      ctx.supabase.from("contract_documents").select("id, file_name, document_type")
        .eq("organization_id", ctx.organizationId).eq("contract_id", contract.id),
      ctx.supabase.from("contract_obligations")
        .select("id, review_status, activation_status")
        .eq("organization_id", ctx.organizationId).eq("contract_id", contract.id),
    ]);
    const all = obligations ?? [];
    return ok(
      {
        contract,
        documents: docs ?? [],
        obligations: {
          total: all.length,
          operational: all.filter((o: any) =>
            o.review_status === OPERATIONAL_OBLIGATION.review_status &&
            o.activation_status === OPERATIONAL_OBLIGATION.activation_status).length,
          drafts: all.filter((o: any) => o.review_status !== "approved").length,
        },
      },
      [cite("contract", contract.id, `${contract.contract_number} — ${contract.title}`, contract.id, `/app/contracts/${contract.id}`)],
      `${contract.contract_number}: ${all.length} obligations`,
    );
  },
};

const getContractClause: OfficerTool = {
  name: "getContractClause",
  toolClass: "READ_ONLY",
  description: "Retrieve the source text of a clause so a claim can be traced to the contract.",
  input: z.object({ clauseId: z.string().uuid() }).strict(),
  handler: async (ctx, args) => {
    const { data } = await ctx.supabase
      .from("contract_clauses")
      .select("id, contract_id, clause_number, heading, text, page_number")
      .eq("organization_id", ctx.organizationId)
      .eq("id", args.clauseId)
      .maybeSingle();
    if (!data) return { ok: false, error: "clause_not_found_in_organization" };
    return ok(
      data,
      [cite("clause", data.id, `Clause ${data.clause_number ?? ""}`.trim(), data.contract_id,
        `/app/contracts/${data.contract_id}`)],
      `clause ${data.clause_number ?? data.id.slice(0, 8)}`,
    );
  },
};

/** Shared obligation projection with deterministic deadline classification. */
async function loadObligations(ctx: OfficerContext, filter: { contractId?: string; operationalOnly?: boolean }) {
  let q = ctx.supabase
    .from("contract_obligations")
    .select(
      "id, contract_id, title, requirement_text, obligation_type, frequency, due_rule_raw, due_date_normalized, " +
      "owner_role_suggested, external_dependency, financial_condition, penalty_condition, payment_linked, " +
      "review_status, activation_status",
    )
    .eq("organization_id", ctx.organizationId);
  if (filter.contractId) q = q.eq("contract_id", filter.contractId);
  if (filter.operationalOnly !== false) {
    q = q.eq("review_status", OPERATIONAL_OBLIGATION.review_status)
      .eq("activation_status", OPERATIONAL_OBLIGATION.activation_status);
  }
  const { data } = await q;
  const rows = data ?? [];

  // Carry the human-facing contract identity so the Officer can name the
  // contract ("FM-008") without a second lookup — a UUID is not an answer.
  const contractIds = [...new Set(rows.map((o: any) => o.contract_id).filter(Boolean))];
  const { data: contracts } = contractIds.length
    ? await ctx.supabase
        .from("contracts").select("id, contract_number, title")
        .eq("organization_id", ctx.organizationId).in("id", contractIds)
    : { data: [] as any[] };
  const byId = new Map((contracts ?? []).map((c: any) => [c.id, c]));

  return rows.map((o: any) => ({
    ...o,
    contract_number: byId.get(o.contract_id)?.contract_number ?? null,
    contract_title: byId.get(o.contract_id)?.title ?? null,
    ...classifyDeadline({ today: ctx.clock.today, dueDate: o.due_date_normalized ?? null }),
  }));
}

const listObligations: OfficerTool = {
  name: "listObligations",
  toolClass: "READ_ONLY",
  description:
    "Operational (approved + active) obligations with normalized due dates and deterministic deadline windows. Set includeDrafts to inspect unreviewed extraction drafts — those are NOT operational truth.",
  input: z.object({
    contractId: z.string().uuid().optional(),
    includeDrafts: z.boolean().optional(),
  }).strict(),
  handler: async (ctx, args) => {
    if (args.contractId && !(await resolveContract(ctx, args.contractId))) {
      return { ok: false, error: "contract_not_found_in_organization" };
    }
    const rows = await loadObligations(ctx, {
      contractId: args.contractId,
      operationalOnly: args.includeDrafts !== true,
    });
    return ok(
      rows,
      rows.map((o: any) => cite("obligation", o.id, o.title, o.contract_id, `/app/contracts/${o.contract_id}/obligations`)),
      `${rows.length} obligations`,
    );
  },
};

const getObligation: OfficerTool = {
  name: "getObligation",
  toolClass: "READ_ONLY",
  description: "One obligation with its source reference, evidence requirements and deadline position.",
  input: z.object({ obligationId: z.string().uuid() }).strict(),
  handler: async (ctx, args) => {
    const { data: o } = await ctx.supabase
      .from("contract_obligations")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .eq("id", args.obligationId)
      .maybeSingle();
    if (!o) return { ok: false, error: "obligation_not_found_in_organization" };
    const [{ data: refs }, { data: reqs }] = await Promise.all([
      ctx.supabase.from("obligation_source_refs")
        .select("id, clause_id, page_number, source_snippet")
        .eq("organization_id", ctx.organizationId).eq("obligation_id", o.id),
      ctx.supabase.from("obligation_evidence_requirements")
        .select("id, name, description, evidence_type, required")
        .eq("organization_id", ctx.organizationId).eq("obligation_id", o.id),
    ]);
    const deadline = classifyDeadline({ today: ctx.clock.today, dueDate: o.due_date_normalized ?? null });
    const citations: OfficerCitation[] = [
      cite("obligation", o.id, o.title, o.contract_id, `/app/contracts/${o.contract_id}/obligations`),
      ...(refs ?? []).filter((r: any) => r.clause_id)
        .map((r: any) => cite("clause", r.clause_id, "Source clause", o.contract_id, `/app/contracts/${o.contract_id}`)),
      ...(reqs ?? []).map((r: any) => cite("evidence_requirement", r.id, r.name, o.contract_id)),
    ];
    return ok(
      {
        obligation: o,
        operational: o.review_status === "approved" && o.activation_status === "active",
        deadline,
        sourceRefs: refs ?? [],
        evidenceRequirements: reqs ?? [],
      },
      citations,
      `${o.title} · ${deadline.window}`,
    );
  },
};

const getUpcomingObligations: OfficerTool = {
  name: "getUpcomingObligations",
  toolClass: "READ_ONLY",
  description:
    "Operational obligations due within N days (default 7), computed server-side in the organization timezone.",
  input: z.object({ withinDays: z.number().int().min(1).max(365).optional() }).strict(),
  handler: async (ctx, args) => {
    const within = args.withinDays ?? 7;
    const rows = (await loadObligations(ctx, {}))
      .filter((o: any) => o.daysUntilDue != null && o.daysUntilDue >= 0 && o.daysUntilDue <= within)
      .sort((a: any, b: any) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0));
    return ok(
      { asOf: ctx.clock.today, timeZone: ctx.clock.timeZone, withinDays: within, obligations: rows },
      rows.map((o: any) => cite("obligation", o.id, o.title, o.contract_id, `/app/contracts/${o.contract_id}/obligations`)),
      `${rows.length} due within ${within} days`,
    );
  },
};

const getOverdueObligations: OfficerTool = {
  name: "getOverdueObligations",
  toolClass: "READ_ONLY",
  description: "Operational obligations whose normalized due date has passed, with exact days overdue.",
  input: empty,
  handler: async (ctx) => {
    const rows = (await loadObligations(ctx, {}))
      .filter((o: any) => o.window === "overdue")
      .sort((a: any, b: any) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
    return ok(
      { asOf: ctx.clock.today, timeZone: ctx.clock.timeZone, obligations: rows },
      [
        ...rows.map((o: any) => cite("obligation", o.id, o.title, o.contract_id, `/app/contracts/${o.contract_id}/obligations`)),
        ...[...new Set(rows.map((o: any) => o.contract_id))].map((cid: any) =>
          cite("contract", cid, rows.find((o: any) => o.contract_id === cid)?.contract_number ?? "contract", cid, `/app/contracts/${cid}`)),
      ],
      `${rows.length} overdue`,
    );
  },
};

const getEvidenceStatus: OfficerTool = {
  name: "getEvidenceStatus",
  toolClass: "READ_ONLY",
  description:
    "Effective OPERATIONAL evidence status per requirement, plus the latest verification result. A pending discrepancy holds the previously accepted state — operational status is what to act on.",
  input: z.object({
    contractId: z.string().uuid().optional(),
    obligationId: z.string().uuid().optional(),
  }).strict(),
  handler: async (ctx, args) => {
    if (args.contractId && !(await resolveContract(ctx, args.contractId))) {
      return { ok: false, error: "contract_not_found_in_organization" };
    }
    let reqQ = ctx.supabase
      .from("obligation_evidence_requirements")
      .select("id, obligation_id, name, evidence_type, required")
      .eq("organization_id", ctx.organizationId);
    if (args.obligationId) reqQ = reqQ.eq("obligation_id", args.obligationId);
    const { data: reqRows } = await reqQ;
    let requirements = reqRows ?? [];

    if (args.contractId) {
      const { data: obs } = await ctx.supabase
        .from("contract_obligations").select("id")
        .eq("organization_id", ctx.organizationId).eq("contract_id", args.contractId);
      const ids = new Set((obs ?? []).map((o: any) => o.id));
      requirements = requirements.filter((r: any) => ids.has(r.obligation_id));
    }
    if (!requirements.length) return ok({ requirements: [] }, [], "no evidence requirements");

    const reqIds = requirements.map((r: any) => r.id);
    const [{ data: checks }, { data: discs }, { data: gaps }] = await Promise.all([
      ctx.supabase.from("evidence_verification_checks")
        .select("evidence_requirement_id, result, human_result, verification_run_id, created_at")
        .eq("organization_id", ctx.organizationId).in("evidence_requirement_id", reqIds)
        .order("created_at", { ascending: false }),
      ctx.supabase.from("evidence_verification_discrepancies").select("*")
        .eq("organization_id", ctx.organizationId).in("evidence_requirement_id", reqIds),
      ctx.supabase.from("evidence_gaps").select("id, evidence_requirement_id, status, gap_type, opened_via")
        .eq("organization_id", ctx.organizationId).in("evidence_requirement_id", reqIds)
        .in("status", OPEN_GAP_STATES),
    ]);

    const runIds = [...new Set((checks ?? []).map((c: any) => c.verification_run_id).filter(Boolean))];
    const { data: runs } = runIds.length
      ? await ctx.supabase.from("evidence_verification_runs")
          .select("id, evidence_version_id, verifier_provider, verifier_model, completed_at")
          .eq("organization_id", ctx.organizationId).in("id", runIds)
      : { data: [] as any[] };
    const runById = new Map((runs ?? []).map((r: any) => [r.id, r]));

    const discrepancies = (discs ?? []).map((d: any) => ({
      id: d.id, requirementId: d.evidence_requirement_id, evidenceVersionId: d.evidence_version_id,
      priorResult: d.prior_result, currentResult: d.current_result, status: d.status,
      priorCheckId: d.prior_check_id, currentCheckId: d.current_check_id,
      priorRunId: d.prior_run_id, currentRunId: d.current_run_id,
      provider: d.provider, model: d.model, resolvedBy: d.resolved_by, resolvedAt: d.resolved_at,
      resolutionNote: d.resolution_note, createdAt: d.created_at,
    }));

    const latestByReq = new Map<string, any>();
    for (const c of checks ?? []) {
      if (!latestByReq.has(c.evidence_requirement_id)) latestByReq.set(c.evidence_requirement_id, c);
    }
    const gapByReq = new Map<string, any>();
    for (const g of gaps ?? []) if (!gapByReq.has(g.evidence_requirement_id)) gapByReq.set(g.evidence_requirement_id, g);

    const citations: OfficerCitation[] = [];
    const out = requirements.map((r: any) => {
      const latest = latestByReq.get(r.id);
      const run = latest ? runById.get(latest.verification_run_id) : null;
      const latestResult = latest ? (latest.human_result ?? latest.result) : null;
      const effective = effectiveStatusForRequirement({
        requirementId: r.id,
        latestResult,
        latestVersionId: run?.evidence_version_id ?? null,
        humanOverridden: latest?.human_result != null,
        discrepancies: discrepancies as any,
      });
      citations.push(cite("evidence_requirement", r.id, r.name));
      if (run) citations.push(cite("verification_run", run.id, `Verification run ${String(run.id).slice(0, 8)}`));
      const gap = gapByReq.get(r.id);
      if (gap) citations.push(cite("evidence_gap", gap.id, `Gap ${gap.gap_type}`));
      return {
        requirementId: r.id, obligationId: r.obligation_id, name: r.name,
        required: r.required, evidenceType: r.evidence_type,
        operationalStatus: effective.operational,
        latestVerificationResult: effective.latest,
        priorStateInForce: effective.priorStateInForce,
        discrepancyStatus: effective.discrepancyStatus,
        statusSource: effective.source,
        humanOverridden: latest?.human_result != null,
        provider: run?.verifier_provider ?? null,
        model: run?.verifier_model ?? null,
        lastVerifiedAt: run?.completed_at ?? null,
        openGap: gap ? { id: gap.id, status: gap.status, type: gap.gap_type, openedVia: gap.opened_via } : null,
      };
    });
    const verified = out.filter((r) => r.operationalStatus === "verified").length;
    return ok({ requirements: out }, citations, `${verified}/${out.length} operationally verified`);
  },
};

const getEvidenceGaps: OfficerTool = {
  name: "getEvidenceGaps",
  toolClass: "READ_ONLY",
  description: "Open evidence gaps — required evidence that is operationally incomplete.",
  input: z.object({ contractId: z.string().uuid().optional() }).strict(),
  handler: async (ctx, args) => {
    if (args.contractId && !(await resolveContract(ctx, args.contractId))) {
      return { ok: false, error: "contract_not_found_in_organization" };
    }
    let q = ctx.supabase
      .from("evidence_gaps")
      .select("id, contract_id, obligation_id, evidence_requirement_id, gap_type, status, description, opened_via, created_at")
      .eq("organization_id", ctx.organizationId)
      .in("status", OPEN_GAP_STATES)
      .order("created_at", { ascending: false });
    if (args.contractId) q = q.eq("contract_id", args.contractId);
    const { data } = await q;
    const rows = data ?? [];
    return ok(
      rows,
      rows.map((g: any) => cite("evidence_gap", g.id, `${g.gap_type} gap`, g.contract_id,
        `/app/contracts/${g.contract_id}/evidence`)),
      `${rows.length} open gaps`,
    );
  },
};

const getVerificationDiscrepancies: OfficerTool = {
  name: "getVerificationDiscrepancies",
  toolClass: "READ_ONLY",
  description:
    "Same-version verification discrepancies: a later run disagreed with a previously accepted result on UNCHANGED evidence. Pending ones await human review; the prior operational state remains in force.",
  input: z.object({
    contractId: z.string().uuid().optional(),
    status: z.enum(["pending", "kept_prior", "regression_confirmed"]).optional(),
  }).strict(),
  handler: async (ctx, args) => {
    let q = ctx.supabase
      .from("evidence_verification_discrepancies")
      .select("*")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false });
    if (args.status) q = q.eq("status", args.status);
    const { data } = await q;
    let rows = data ?? [];
    if (args.contractId) {
      if (!(await resolveContract(ctx, args.contractId))) {
        return { ok: false, error: "contract_not_found_in_organization" };
      }
      const { data: items } = await ctx.supabase.from("evidence_items").select("id")
        .eq("organization_id", ctx.organizationId).eq("contract_id", args.contractId);
      const ids = new Set((items ?? []).map((i: any) => i.id));
      rows = rows.filter((d: any) => ids.has(d.evidence_item_id));
    }
    return ok(
      rows,
      rows.map((d: any) => cite("verification_discrepancy", d.id,
        `${d.prior_result} → ${d.current_result}`, null, `/app/evidence/${d.evidence_item_id}`)),
      `${rows.filter((d: any) => d.status === "pending").length} pending of ${rows.length}`,
    );
  },
};

const getRecentActivity: OfficerTool = {
  name: "getRecentActivity",
  toolClass: "READ_ONLY",
  description: "Recent audit events — what actually changed and when. Used to answer 'what changed since…'.",
  input: z.object({
    contractId: z.string().uuid().optional(),
    sinceIso: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }).strict(),
  handler: async (ctx, args) => {
    let q = ctx.supabase
      .from("activity_log")
      .select("id, event_type, entity_type, entity_id, actor_user_id, metadata, created_at")
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 50);
    if (args.sinceIso) q = q.gte("created_at", args.sinceIso);
    const { data } = await q;
    const rows = data ?? [];
    return ok(
      rows,
      rows.slice(0, 20).map((a: any) => cite("activity_event", a.id, a.event_type)),
      `${rows.length} events`,
    );
  },
};

const getOrganizationMembers: OfficerTool = {
  name: "getOrganizationMembers",
  toolClass: "READ_ONLY",
  description:
    "Members of this organization with role and display identity — who can be assigned work and who may approve.",
  input: empty,
  handler: async (ctx) => {
    const { data } = await ctx.supabase
      .from("organization_members")
      .select("user_id, role, created_at")
      .eq("organization_id", ctx.organizationId);
    const rows = data ?? [];
    // Display identity comes from a narrow security-definer function scoped
    // to fellow members; auth.users is not readable directly. If it is
    // unavailable we degrade honestly to the user id rather than inventing
    // a name.
    const { data: identities } = await ctx.supabase.rpc("org_member_identities", { org: ctx.organizationId });
    const byId = new Map((identities ?? []).map((i: any) => [i.user_id, i]));
    const merged = rows.map((m: any) => {
      const id = byId.get(m.user_id) as any;
      return {
        userId: m.user_id,
        role: m.role,
        displayName: id?.display_name ?? null,
        email: id?.email ?? null,
        identityResolved: !!id,
        memberSince: m.created_at,
      };
    });
    return ok(merged, [], `${merged.length} members`);
  },
};

const getAssignments: OfficerTool = {
  name: "getAssignments",
  toolClass: "READ_ONLY",
  description:
    "Ownership state per obligation, including AI assignment suggestions and whether a human decided on them. A pending suggestion is NOT an assignment.",
  input: z.object({ contractId: z.string().uuid().optional() }).strict(),
  handler: async (ctx, args) => {
    let obQ = ctx.supabase
      .from("contract_obligations")
      .select("id, contract_id, title, owner_role_suggested")
      .eq("organization_id", ctx.organizationId);
    if (args.contractId) {
      if (!(await resolveContract(ctx, args.contractId))) {
        return { ok: false, error: "contract_not_found_in_organization" };
      }
      obQ = obQ.eq("contract_id", args.contractId);
    }
    const { data: obs } = await obQ;
    const ids = (obs ?? []).map((o: any) => o.id);
    const { data: sugg } = ids.length
      ? await ctx.supabase.from("obligation_assignment_suggestions")
          .select("id, obligation_id, suggestion_kind, suggested_role, suggested_person_id, suggested_person_name, approved, decided_by, decided_at")
          .eq("organization_id", ctx.organizationId).in("obligation_id", ids)
      : { data: [] as any[] };
    const byOb = new Map<string, any[]>();
    for (const s of sugg ?? []) byOb.set(s.obligation_id, [...(byOb.get(s.obligation_id) ?? []), s]);
    const rows = (obs ?? []).map((o: any) => {
      const list = byOb.get(o.id) ?? [];
      return {
        obligationId: o.id, contractId: o.contract_id, title: o.title,
        suggestedRole: o.owner_role_suggested,
        confirmedOwner: list.find((s: any) => s.suggestion_kind === "owner" && s.approved === true) ?? null,
        pendingSuggestions: list.filter((s: any) => s.approved === null),
        unassigned: !list.some((s: any) => s.suggestion_kind === "owner" && s.approved === true),
      };
    });
    return ok(rows, [], `${rows.filter((r) => r.unassigned).length} unassigned of ${rows.length}`);
  },
};

// ---------------------------------------------------------------------------
// SAFE_INTERNAL_WRITE / APPROVAL_REQUIRED tools
// ---------------------------------------------------------------------------

/** Insert an officer_actions proposal. Never executes anything itself. */
async function proposeAction(
  ctx: OfficerContext,
  input: {
    actionType: string;
    args: Record<string, unknown>;
    reason: string;
    contractId?: string | null;
    obligationId?: string | null;
    conversationId?: string | null;
    riskLevel?: "low" | "medium" | "high";
    citations?: OfficerCitation[];
  },
): Promise<ToolResult> {
  const requiresApproval = classifyAction(input.actionType) === "APPROVAL_REQUIRED";
  // Proposing is allowed broadly; EXECUTION authority is re-checked at
  // approval time. We still refuse to draft an action nobody could ever run.
  const auth = authorizeAction(ctx.role, input.actionType);
  if (!auth.allowed && auth.reason === "unknown_action") {
    return { ok: false, error: "unknown_action_type" };
  }
  if (!auth.allowed && auth.reason === "not_available_yet") {
    return { ok: false, error: "action_channel_not_available_in_phase_4a" };
  }
  if (input.contractId && !(await resolveContract(ctx, input.contractId))) {
    return { ok: false, error: "contract_not_found_in_organization" };
  }

  // IDEMPOTENCY: a repeated click or a model re-proposing the same thing
  // must not create a second approval request for an identical open action.
  const { data: dupes } = await ctx.supabase
    .from("officer_actions")
    .select("id, status, requires_approval, action_type, arguments, contract_id")
    .eq("organization_id", ctx.organizationId)
    .eq("action_type", input.actionType)
    .in("status", ["suggested", "waiting_for_approval"]);
  const argKey = JSON.stringify(input.args ?? {});
  const existing = (dupes ?? []).find(
    (d: any) => JSON.stringify(d.arguments ?? {}) === argKey && (d.contract_id ?? null) === (input.contractId ?? null),
  );
  if (existing) {
    return ok(existing, input.citations ?? [], `existing open proposal reused (${existing.status})`);
  }

  const { data, error } = await ctx.supabase
    .from("officer_actions")
    .insert({
      organization_id: ctx.organizationId,
      contract_id: input.contractId ?? null,
      obligation_id: input.obligationId ?? null,
      conversation_id: input.conversationId ?? null,
      action_type: input.actionType,
      arguments: input.args,
      reason: input.reason,
      citations: input.citations ?? [],
      risk_level: input.riskLevel ?? (requiresApproval ? "medium" : "low"),
      requires_approval: requiresApproval,
      status: requiresApproval ? "waiting_for_approval" : "suggested",
      proposed_by: null, // proposed by the Officer, not by a human
    })
    .select("id, status, requires_approval, action_type")
    .single();
  if (error || !data) return { ok: false, error: `proposal_failed: ${error?.message ?? "unknown"}` };
  return ok(data, input.citations ?? [], `proposed ${input.actionType} (${data.status})`);
}

const createInternalAction: OfficerTool = {
  name: "createInternalAction",
  toolClass: "SAFE_INTERNAL_WRITE",
  description:
    "Record an internal officer note or follow-up task. Internal bookkeeping only — it changes no contract, obligation, evidence or gap.",
  input: z.object({
    actionType: z.enum(["officer.note", "officer.internal_task"]),
    title: z.string().min(3).max(200),
    reason: z.string().min(3).max(2000),
    contractId: z.string().uuid().optional(),
    obligationId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
  }).strict(),
  handler: (ctx, args) =>
    proposeAction(ctx, {
      actionType: args.actionType,
      args: { title: args.title },
      reason: args.reason,
      contractId: args.contractId ?? null,
      obligationId: args.obligationId ?? null,
      conversationId: args.conversationId ?? null,
      riskLevel: "low",
    }),
};

const proposeAssignment: OfficerTool = {
  name: "proposeAssignment",
  toolClass: "APPROVAL_REQUIRED",
  description:
    "Propose an owner for an obligation. Creates an approval request — it does NOT assign anyone.",
  input: z.object({
    obligationId: z.string().uuid(),
    assigneeUserId: z.string().uuid(),
    reason: z.string().min(3).max(2000),
    conversationId: z.string().uuid().optional(),
  }).strict(),
  handler: async (ctx, args) => {
    const { data: ob } = await ctx.supabase
      .from("contract_obligations").select("id, contract_id, title")
      .eq("organization_id", ctx.organizationId).eq("id", args.obligationId).maybeSingle();
    if (!ob) return { ok: false, error: "obligation_not_found_in_organization" };
    // An assignee must be a member of THIS organization — never another
    // company's employee, whatever the model proposed.
    const { data: member } = await ctx.supabase
      .from("organization_members").select("user_id")
      .eq("organization_id", ctx.organizationId).eq("user_id", args.assigneeUserId).maybeSingle();
    if (!member) return { ok: false, error: "assignee_not_a_member_of_this_organization" };
    return proposeAction(ctx, {
      actionType: "obligation.assign_owner",
      args: { obligationId: ob.id, assigneeUserId: args.assigneeUserId },
      reason: args.reason,
      contractId: ob.contract_id,
      obligationId: ob.id,
      conversationId: args.conversationId ?? null,
      riskLevel: "medium",
      citations: [cite("obligation", ob.id, ob.title, ob.contract_id, `/app/contracts/${ob.contract_id}/obligations`)],
    });
  },
};

const requestHumanApproval: OfficerTool = {
  name: "requestHumanApproval",
  toolClass: "APPROVAL_REQUIRED",
  description:
    "Escalate to a human: request internal evidence, escalate to a contract manager, or ask for review of a discrepancy. Creates an approval request; nothing is sent externally in Phase 4A.",
  input: z.object({
    actionType: z.enum(["officer.request_evidence_internal", "officer.escalate"]),
    summary: z.string().min(3).max(200),
    reason: z.string().min(3).max(2000),
    contractId: z.string().uuid().optional(),
    obligationId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
    riskLevel: z.enum(["low", "medium", "high"]).optional(),
  }).strict(),
  handler: (ctx, args) =>
    proposeAction(ctx, {
      actionType: args.actionType,
      args: { summary: args.summary },
      reason: args.reason,
      contractId: args.contractId ?? null,
      obligationId: args.obligationId ?? null,
      conversationId: args.conversationId ?? null,
      riskLevel: args.riskLevel ?? "medium",
    }),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TOOLS: OfficerTool[] = [
  getOrganizationSummary,
  listContracts,
  getContract,
  getContractClause,
  listObligations,
  getObligation,
  getUpcomingObligations,
  getOverdueObligations,
  getEvidenceStatus,
  getEvidenceGaps,
  getVerificationDiscrepancies,
  getRecentActivity,
  getOrganizationMembers,
  getAssignments,
  createInternalAction,
  proposeAssignment,
  requestHumanApproval,
];

export const OFFICER_TOOLS: ReadonlyMap<string, OfficerTool> = new Map(TOOLS.map((t) => [t.name, t]));

export function listOfficerTools(): readonly OfficerTool[] {
  return TOOLS;
}

/**
 * Execute a model-requested tool.
 *
 * Unknown tools, invalid arguments and cross-tenant identifiers are refused
 * here — before any query runs — and RLS refuses again underneath.
 */
export async function runOfficerTool(
  ctx: OfficerContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const tool = OFFICER_TOOLS.get(name);
  if (!tool) return { ok: false, error: "unknown_tool" };
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, error: `invalid_arguments: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}` };
  }
  if (!ctx.officer.enabled) return { ok: false, error: "officer_disabled_for_organization" };
  try {
    return await tool.handler(ctx, parsed.data);
  } catch (e) {
    return { ok: false, error: `tool_failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}

/** Item-level effective status helper re-exported for Officer consumers. */
export { effectiveItemStatus };
