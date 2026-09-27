import "server-only";

import { effectiveStatusForRequirement } from "@/domain/effective-status";
import type { VerificationDiscrepancyView } from "@/domain/evidence";
import type { OfficerContext } from "@/lib/officer/context";
import {
  DEFAULT_THRESHOLDS,
  detectForContract,
  detectForObligation,
  detectWaitingApprovals,
  type Finding,
  type ObligationFacts,
  type RequirementFacts,
  type SweepThresholds,
} from "@/lib/officer/detectors";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Contract Sweep engine.
 *
 * Deterministic detection over real system state, one contract at a time so
 * a failure on one contract cannot corrupt the others. Safe to run repeatedly:
 * an unchanged condition updates last_seen_at instead of spawning a duplicate,
 * and a condition that disappears is RESOLVED rather than deleted.
 *
 * No model is called here. Language comes later, over the findings.
 */

const OPEN_GAP_STATES = ["open", "evidence_received", "reverification_pending"];

export type SweepOutcome = {
  ok: boolean;
  sweepRunId: string | null;
  contractsTotal: number;
  contractsDone: number;
  created: number;
  updated: number;
  resolved: number;
  failures: { contract_id: string; error: string }[];
  status: "completed" | "partial" | "failed";
};

/**
 * Run a sweep for the caller's organization.
 *
 * `trigger` distinguishes a manual run from a scheduled one so the audit
 * trail shows who asked. No browser presence is required — a scheduler can
 * call the same function through the job endpoint.
 */
export async function runContractSweep(opts: {
  ctx: OfficerContext;
  trigger?: "manual" | "scheduled";
  thresholds?: SweepThresholds;
}): Promise<SweepOutcome> {
  const { ctx } = opts;
  const th = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const today = ctx.clock.today;

  const { data: runRow } = await ctx.supabase
    .from("officer_sweep_runs")
    .insert({
      organization_id: ctx.organizationId,
      trigger: opts.trigger ?? "manual",
      triggered_by: ctx.userId,
      as_of_date: today,
      timezone: ctx.clock.timeZone,
      status: "running",
    })
    .select("id")
    .single();
  const sweepRunId = (runRow?.id as string) ?? null;
  if (!sweepRunId) {
    return { ok: false, sweepRunId: null, contractsTotal: 0, contractsDone: 0, created: 0, updated: 0, resolved: 0, failures: [], status: "failed" };
  }

  await log(ctx, "officer.sweep_started", sweepRunId, { as_of: today, timezone: ctx.clock.timeZone });

  const t0 = Date.now();
  const failures: { contract_id: string; error: string }[] = [];
  const allFindings: Finding[] = [];
  // Contracts whose replacement scan completed — only these may have their
  // previous observations resolved.
  const scanned = new Set<string>();
  let orgScanned = false;
  let contractsDone = 0;

  const finish = async (status: "completed" | "partial" | "failed", counts = { created: 0, updated: 0, resolved: 0 }) => {
    // The run is only published (completed/partial) if this write succeeds;
    // otherwise it stays "running"/"failed" and no consumer treats it as fresh.
    const { data: pub, error: finErr } = await ctx.supabase.from("officer_sweep_runs")
      .update({
        status, completed_at: new Date().toISOString(), duration_ms: Date.now() - t0,
        observations_created: counts.created, observations_updated: counts.updated, observations_resolved: counts.resolved,
        failures,
      })
      .eq("id", sweepRunId).eq("organization_id", ctx.organizationId)
      .select("id, status");
    // Published only with persisted evidence: exactly this run, in this status.
    const persisted = !finErr && Array.isArray(pub) && pub.length === 1 && pub[0].status === status;
    const published = persisted ? status : "failed";
    if (!persisted) failures.push({ contract_id: "organization", error: "sweep_run_publish_failed" });
    await log(ctx, "officer.sweep_completed", sweepRunId, {
      status: published, contracts_total: contractRows.length, contracts_done: contractsDone,
      ...counts, failures: failures.length,
    });
    return {
      ok: published !== "failed", sweepRunId,
      contractsTotal: contractRows.length, contractsDone,
      ...counts, failures, status: published,
    } as SweepOutcome;
  };

  let contractRows: any[] = [];
  try {
    const { data: contracts, error: cErr } = await ctx.supabase
      .from("contracts")
      .select("id, contract_number, title, status, end_date")
      .eq("organization_id", ctx.organizationId)
      .eq("status", "active");
    if (cErr || !Array.isArray(contracts)) throw new Error("read_failed:contracts");
    contractRows = contracts;
  } catch {
    // Without the contract list nothing can be assessed — and nothing may be
    // resolved (an empty list would otherwise resolve every observation).
    failures.push({ contract_id: "organization", error: "read_failed:contracts" });
    return finish("failed");
  }

  await ctx.supabase.from("officer_sweep_runs")
    .update({ contracts_total: contractRows.length })
    .eq("id", sweepRunId).eq("organization_id", ctx.organizationId);

  for (const c of contractRows) {
    try {
      const found = [
        ...detectForContract({
          today,
          contract: {
            contractId: c.id as string,
            contractNumber: c.contract_number as string,
            title: c.title as string,
            endDate: (c.end_date as string | null) ?? null,
            status: c.status as string,
          },
          thresholds: th,
        }),
        ...(await sweepContract(ctx, c, today, th)),
      ];
      allFindings.push(...found);
      scanned.add(c.id as string);
      contractsDone++;
      // Progress is persisted per contract so a partial run is resumable and
      // visible rather than silently lost.
      await ctx.supabase.from("officer_sweep_runs")
        .update({ contracts_done: contractsDone })
        .eq("id", sweepRunId).eq("organization_id", ctx.organizationId);
    } catch (e) {
      // Codes only — never contract or evidence text in a log.
      failures.push({ contract_id: c.id as string, error: e instanceof SweepReadError ? e.message : "scan_failed" });
    }
  }

  // Organization-level: approvals a human still owes a decision on.
  try {
    const { data: actions, error: aErr } = await ctx.supabase
      .from("officer_actions")
      .select("id, action_type, contract_id, obligation_id, reason")
      .eq("organization_id", ctx.organizationId)
      .in("status", ["suggested", "waiting_for_approval"]);
    if (aErr || !Array.isArray(actions)) throw new SweepReadError("officer_actions");
    allFindings.push(...detectWaitingApprovals(actions.map((a: any) => ({
      id: a.id, actionType: a.action_type, contractId: a.contract_id,
      obligationId: a.obligation_id, reason: a.reason,
    }))));
    orgScanned = true;
  } catch (e) {
    failures.push({ contract_id: "organization", error: e instanceof SweepReadError ? e.message : "scan_failed" });
  }

  let counts = { created: 0, updated: 0, resolved: 0 };
  try {
    const rec = await reconcileObservations(ctx, allFindings, sweepRunId, { scanned, orgScanned, allContractsScanned: scanned.size === contractRows.length });
    counts = { created: rec.created, updated: rec.updated, resolved: rec.resolved };
    for (const w of rec.writeFailures) {
      if (!failures.some((f) => f.contract_id === w)) failures.push({ contract_id: w, error: "observation_write_failed" });
      if (w !== "organization") scanned.delete(w);
    }
  } catch (e) {
    failures.push({ contract_id: "organization", error: e instanceof SweepReadError ? e.message : "reconcile_failed" });
    return finish("failed");
  }

  // A contract counts as assessed only if its scan AND its writes succeeded.
  const status = failures.length === 0 ? "completed" : scanned.size > 0 ? "partial" : "failed";
  return finish(status, counts);
}

/** A required read failed; message is a safe code, never database text. */
class SweepReadError extends Error {
  constructor(table: string) { super(`read_failed:${table}`); }
}

/** Unwrap a query result; any error or missing data aborts this contract's scan. */
function must<T = any[]>(res: { data: any; error: any }, table: string): T {
  if (res.error || res.data == null) throw new SweepReadError(table);
  return res.data as T;
}

/** Gather one contract's operational facts and run the detectors over them. */
async function sweepContract(
  ctx: OfficerContext,
  contract: any,
  today: string,
  th: SweepThresholds,
): Promise<Finding[]> {
  const contractId = contract.id as string;

  const obligations = must(await ctx.supabase
    .from("contract_obligations")
    .select("id, title, due_date_normalized, due_rule_raw, financial_condition, penalty_condition, payment_linked, external_dependency, requires_external_acknowledgement, owner_role_suggested")
    .eq("organization_id", ctx.organizationId)
    .eq("contract_id", contractId)
    .eq("review_status", "approved")
    .eq("activation_status", "active"), "contract_obligations");
  const obRows = obligations as any[];
  if (!obRows.length) return [];

  const obIds = obRows.map((o: any) => o.id as string);

  const [reqRes, refRes, assignRes] = await Promise.all([
    ctx.supabase.from("obligation_evidence_requirements")
      .select("id, obligation_id, name, required")
      .eq("organization_id", ctx.organizationId).in("obligation_id", obIds),
    ctx.supabase.from("obligation_source_refs")
      .select("obligation_id, clause_id")
      .eq("organization_id", ctx.organizationId).in("obligation_id", obIds),
    ctx.supabase.from("obligation_assignment_suggestions")
      .select("obligation_id, suggestion_kind, approved")
      .eq("organization_id", ctx.organizationId).in("obligation_id", obIds),
  ]);
  const reqRows = must(reqRes, "obligation_evidence_requirements");
  const refRows = must(refRes, "obligation_source_refs");
  const assignRows = must(assignRes, "obligation_assignment_suggestions");

  const reqIds = (reqRows ?? []).map((r: any) => r.id as string);
  const [checkRes, gapRes, discRes] = reqIds.length
    ? await Promise.all([
        ctx.supabase.from("evidence_verification_checks")
          .select("evidence_requirement_id, result, human_result, verification_run_id, created_at")
          .eq("organization_id", ctx.organizationId).in("evidence_requirement_id", reqIds)
          .order("created_at", { ascending: false }),
        ctx.supabase.from("evidence_gaps")
          .select("id, evidence_requirement_id, status, gap_type")
          .eq("organization_id", ctx.organizationId).in("evidence_requirement_id", reqIds)
          .in("status", OPEN_GAP_STATES),
        ctx.supabase.from("evidence_verification_discrepancies")
          .select("*")
          .eq("organization_id", ctx.organizationId).in("evidence_requirement_id", reqIds),
      ])
    : [{ data: [] as any[], error: null }, { data: [] as any[], error: null }, { data: [] as any[], error: null }];
  const checkRows = must(checkRes, "evidence_verification_checks");
  const gapRows = must(gapRes, "evidence_gaps");
  const discRows = must(discRes, "evidence_verification_discrepancies");

  // Version each latest check examined — effective status is version-scoped.
  const runIds = [...new Set((checkRows ?? []).map((c: any) => c.verification_run_id).filter(Boolean))];
  const runRows = must(runIds.length
    ? await ctx.supabase.from("evidence_verification_runs")
        .select("id, evidence_version_id")
        .eq("organization_id", ctx.organizationId).in("id", runIds)
    : { data: [] as any[], error: null }, "evidence_verification_runs");
  const versionByRun = new Map((runRows ?? []).map((r: any) => [r.id, r.evidence_version_id]));

  const discrepancies: VerificationDiscrepancyView[] = (discRows ?? []).map((d: any) => ({
    id: d.id, requirementId: d.evidence_requirement_id, evidenceVersionId: d.evidence_version_id,
    priorResult: d.prior_result, currentResult: d.current_result,
    priorCheckId: d.prior_check_id, currentCheckId: d.current_check_id,
    priorRunId: d.prior_run_id, currentRunId: d.current_run_id,
    provider: d.provider, model: d.model, status: d.status,
    resolvedBy: d.resolved_by, resolvedAt: d.resolved_at, resolutionNote: d.resolution_note,
    createdAt: d.created_at,
  }));

  const latestByReq = new Map<string, any>();
  for (const c of checkRows ?? []) {
    if (!latestByReq.has(c.evidence_requirement_id)) latestByReq.set(c.evidence_requirement_id, c);
  }
  const gapByReq = new Map<string, any>();
  for (const g of gapRows ?? []) if (!gapByReq.has(g.evidence_requirement_id)) gapByReq.set(g.evidence_requirement_id, g);
  const clauseByOb = new Map<string, string>();
  for (const r of refRows ?? []) if (r.clause_id && !clauseByOb.has(r.obligation_id)) clauseByOb.set(r.obligation_id, r.clause_id);
  const ownerAssigned = new Set(
    (assignRows ?? []).filter((a: any) => a.suggestion_kind === "owner" && a.approved === true)
      .map((a: any) => a.obligation_id as string),
  );

  const reqByOb = new Map<string, any[]>();
  for (const r of reqRows ?? []) reqByOb.set(r.obligation_id, [...(reqByOb.get(r.obligation_id) ?? []), r]);

  const findings: Finding[] = [];
  for (const o of obRows) {
    const requirements: RequirementFacts[] = (reqByOb.get(o.id) ?? []).map((r: any) => {
      const latest = latestByReq.get(r.id);
      const latestResult = latest ? (latest.human_result ?? latest.result) : null;
      const effective = effectiveStatusForRequirement({
        requirementId: r.id,
        latestResult,
        latestVersionId: latest ? (versionByRun.get(latest.verification_run_id) ?? null) : null,
        humanOverridden: latest?.human_result != null,
        discrepancies,
      });
      const gap = gapByReq.get(r.id);
      const pending = discrepancies.find((d) => d.requirementId === r.id && d.status === "pending");
      return {
        requirementId: r.id, name: r.name, required: r.required ?? true,
        effective,
        gap: gap ? { id: gap.id, status: gap.status, gapType: gap.gap_type } : null,
        pendingDiscrepancyId: pending?.id ?? null,
      };
    });

    const facts: ObligationFacts = {
      obligationId: o.id as string,
      contractId,
      contractNumber: contract.contract_number as string,
      title: o.title as string,
      dueDate: (o.due_date_normalized as string | null) ?? null,
      dueRuleRaw: (o.due_rule_raw as string | null) ?? null,
      clauseId: clauseByOb.get(o.id as string) ?? null,
      hasFinancialCondition: !!(o.financial_condition || o.penalty_condition || o.payment_linked),
      externalDependency: (o.external_dependency as string | null) ?? null,
      requiresExternalAcknowledgement: !!o.requires_external_acknowledgement,
      ownerAssigned: ownerAssigned.has(o.id as string),
      suggestedOwnerRole: (o.owner_role_suggested as string | null) ?? null,
      requirements,
    };
    findings.push(...detectForObligation({ today, obligation: facts, thresholds: th }));
  }
  return findings;
}

/**
 * Persist findings against existing observations.
 *
 *   present + already active   → touch last_seen_at (NO duplicate)
 *   present + previously resolved → reopen, preserving first_detected_at and
 *                                   counting the reopen
 *   absent  + currently active → resolve (history retained) — ONLY when the
 *                                replacement scan for that scope completed
 *                                and its own writes succeeded
 *
 * Every write result is checked. A failed write marks its contract (or the
 * organization scope) as failed so it is never published as assessed.
 */
async function reconcileObservations(
  ctx: OfficerContext,
  findings: Finding[],
  sweepRunId: string,
  scope: { scanned: Set<string>; orgScanned: boolean; allContractsScanned: boolean },
): Promise<{ created: number; updated: number; resolved: number; writeFailures: string[] }> {
  const now = new Date().toISOString();
  // Collapse identical dedupe keys within one sweep (belt and braces).
  const byKey = new Map<string, Finding>();
  for (const f of findings) if (!byKey.has(f.dedupeKey)) byKey.set(f.dedupeKey, f);

  const { data: existingRows, error: exErr } = await ctx.supabase
    .from("officer_observations")
    .select("id, dedupe_key, status, first_detected_at, reopen_count, contract_id, kind")
    .eq("organization_id", ctx.organizationId);
  // Without the current observation set we can neither avoid duplicates nor
  // resolve safely — abort the whole publication.
  if (exErr || !Array.isArray(existingRows)) throw new SweepReadError("officer_observations");
  const activeByKey = new Map<string, any>();
  const resolvedByKey = new Map<string, any>();
  for (const row of existingRows) {
    if (row.status === "active" || row.status === "acknowledged") activeByKey.set(row.dedupe_key, row);
    else if (!resolvedByKey.has(row.dedupe_key)) resolvedByKey.set(row.dedupe_key, row);
  }

  let created = 0;
  let updated = 0;
  let resolved = 0;
  const writeFailures = new Set<string>();
  const scopeOf = (contractId: string | null, kind: string) =>
    kind === "action_waiting_for_approval" || !contractId ? "organization" : contractId;

  for (const [key, f] of byKey) {
    const open = activeByKey.get(key);
    if (open) {
      const { data, error } = await ctx.supabase.from("officer_observations")
        .update({
          last_seen_at: now, severity: f.severity, time_bucket: f.timeBucket,
          priority: f.priority, priority_reason: f.priorityReason,
          title: f.title, detail: f.detail, citations: f.citations,
          supporting_facts: f.supportingFacts, recommended_action_type: f.recommendedActionType,
          sweep_run_id: sweepRunId,
        })
        .eq("id", open.id).eq("organization_id", ctx.organizationId)
        .select("id");
      // "No error" is not success: the targeted row must actually change.
      if (error || !Array.isArray(data) || data.length !== 1) writeFailures.add(scopeOf(f.contractId, f.kind)); else updated++;
      continue;
    }

    const previously = resolvedByKey.get(key);
    const { data: inserted, error } = await ctx.supabase
      .from("officer_observations")
      .insert({
        organization_id: ctx.organizationId,
        contract_id: f.contractId,
        obligation_id: f.obligationId,
        evidence_requirement_id: f.evidenceRequirementId,
        kind: f.kind,
        severity: f.severity,
        time_bucket: f.timeBucket,
        priority: f.priority,
        priority_reason: f.priorityReason,
        title: f.title,
        detail: f.detail,
        citations: f.citations,
        supporting_facts: f.supportingFacts,
        recommended_action_type: f.recommendedActionType,
        status: "active",
        dedupe_key: key,
        sweep_run_id: sweepRunId,
        // A genuine reappearance keeps the original discovery date and is
        // counted, so recurring problems are visible as recurring.
        ...(previously
          ? {
              first_detected_at: previously.first_detected_at,
              reopened_at: now,
              reopen_count: (previously.reopen_count ?? 0) + 1,
            }
          : {}),
      })
      .select("id")
      .single();
    if (error || !inserted) { writeFailures.add(scopeOf(f.contractId, f.kind)); continue; }
    created++;
    await log(ctx, "officer.observation_created", inserted.id as string, {
      kind: f.kind, severity: f.severity, contract_id: f.contractId,
      obligation_id: f.obligationId, reopened: !!previously,
    });
  }

  // Conditions that no longer hold are resolved, never deleted — but only in
  // scopes whose replacement scan completed and whose writes all succeeded.
  // A failed, partial or unsaved scan leaves previous observations active.
  const mayResolve = (row: any) => {
    const sc = scopeOf(row.contract_id, row.kind);
    if (writeFailures.has(sc)) return false;
    if (sc === "organization") {
      return row.kind === "action_waiting_for_approval" ? scope.orgScanned : scope.orgScanned && scope.allContractsScanned;
    }
    return scope.scanned.has(sc);
  };
  // Staged per scope: each contract's resolutions are applied in ONE
  // all-or-nothing call (migration 0014), after all of its other writes
  // succeeded. A failure leaves every previous observation of that contract
  // active; other contracts are unaffected.
  const toResolve = new Map<string, { id: string; key: string }[]>();
  for (const [key, row] of activeByKey) {
    if (byKey.has(key) || !mayResolve(row)) continue;
    const sc = scopeOf(row.contract_id, row.kind);
    toResolve.set(sc, [...(toResolve.get(sc) ?? []), { id: row.id as string, key }]);
  }
  for (const [sc, items] of toResolve) {
    if (writeFailures.has(sc)) continue;
    const { data: n, error } = await ctx.supabase.rpc("officer_resolve_observations", {
      p_organization_id: ctx.organizationId, p_ids: items.map((i) => i.id), p_resolved_at: now,
    });
    if (error || n !== items.length) { writeFailures.add(sc); continue; }
    resolved += items.length;
    for (const i of items) await log(ctx, "officer.observation_resolved", i.id, { dedupe_key: i.key });
  }

  return { created, updated, resolved, writeFailures: [...writeFailures] };
}

async function log(ctx: OfficerContext, eventType: string, entityId: string, metadata: Record<string, unknown>) {
  await ctx.supabase.from("activity_log").insert({
    organization_id: ctx.organizationId,
    actor_user_id: ctx.userId,
    event_type: eventType,
    entity_type: eventType.includes("observation") ? "officer_observation" : "officer_sweep_run",
    entity_id: entityId,
    metadata,
  });
}
