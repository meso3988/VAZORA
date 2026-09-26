import type { OfficerContext } from "@/lib/officer/context";
import { listObservations, type ObservationRow } from "@/lib/officer/observations";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Contract health = the sweep's unresolved observations + whether the sweep's
 * coverage of that contract is current. No new scoring and no re-detection:
 * the sweep engine is the single source of actionable issues; this module only
 * refuses to read "no observations" as health when the assessment is missing,
 * stale or incomplete.
 */

export type HealthVerdict = "actionable_issues" | "no_actionable_issues_recorded" | "assessment_incomplete";

export type CoverageFacts = {
  today: string;
  contractStatus: string;
  contractCreatedAt: string;
  operationalObligations: number;
  lastSweep: { startedAt: string; asOfDate: string | null; status: string; failedContractIds: string[] } | null;
  /** latest change to this contract's obligations, gaps or discrepancies */
  latestChangeAt: string | null;
};

export type ContractHealth = {
  contractId: string;
  contractNumber: string;
  title: string;
  verdict: HealthVerdict;
  issues: { kind: string; severity: string; title: string; detail: string | null; status: string }[];
  coverage: { lastSweepAt: string | null; asOfDate: string | null; gaps: string[] };
  /** the only wording a "no issues" verdict supports */
  scopedStatement: string | null;
};

export const SCOPED_NO_ISSUES_EN = "No actionable issues are recorded within the checks and data available.";
export const SCOPED_NO_ISSUES_AR = "لا توجد مشكلات قابلة للإجراء مسجّلة ضمن الفحوصات والبيانات المتاحة.";

/** Why the sweep's silence about a contract cannot be read as health. */
export function coverageGaps(f: CoverageFacts, contractId: string): string[] {
  const gaps: string[] = [];
  if (f.contractStatus !== "active") gaps.push(`contract_not_active (${f.contractStatus}) — not monitored by the sweep`);
  if (f.operationalObligations === 0) gaps.push("no_operational_obligations — nothing has been assessed");
  const s = f.lastSweep;
  if (!s) return [...gaps, "no_completed_sweep — the contract has never been assessed"];
  if (s.asOfDate !== f.today) gaps.push(`sweep_not_current — last assessed as of ${s.asOfDate ?? "unknown"}, today is ${f.today}`);
  if (s.failedContractIds.includes(contractId)) gaps.push("sweep_failed_for_contract");
  if (Date.parse(f.contractCreatedAt) > Date.parse(s.startedAt)) gaps.push("contract_added_after_last_sweep");
  if (f.latestChangeAt && Date.parse(f.latestChangeAt) > Date.parse(s.startedAt)) {
    gaps.push("data_changed_since_last_sweep — obligations, gaps or discrepancies changed after the assessment");
  }
  return gaps;
}

export function healthVerdict(openIssues: number, gaps: string[]): HealthVerdict {
  if (openIssues > 0) return "actionable_issues";
  return gaps.length ? "assessment_incomplete" : "no_actionable_issues_recorded";
}

const latest = (...xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x).sort().at(-1) ?? null;

/** Assess one or all active contracts of the caller's organization. */
export async function assessContractHealth(
  ctx: OfficerContext,
  opts: { contractIds?: string[] } = {},
): Promise<ContractHealth[]> {
  let cq = ctx.supabase.from("contracts")
    .select("id, contract_number, title, status, created_at")
    .eq("organization_id", ctx.organizationId);
  cq = opts.contractIds?.length ? cq.in("id", opts.contractIds) : cq.eq("status", "active");
  const { data: contracts } = await cq;
  if (!contracts?.length) return [];
  const ids = contracts.map((c: any) => c.id as string);

  const [{ data: sweep }, { data: obligations }, { data: gaps }, observations] = await Promise.all([
    ctx.supabase.from("officer_sweep_runs")
      .select("started_at, as_of_date, status, failures")
      .eq("organization_id", ctx.organizationId).in("status", ["completed", "partial"])
      .order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ctx.supabase.from("contract_obligations")
      .select("id, contract_id, review_status, activation_status, updated_at")
      .eq("organization_id", ctx.organizationId).in("contract_id", ids),
    ctx.supabase.from("evidence_gaps")
      .select("contract_id, evidence_requirement_id, opened_at, closed_at")
      .eq("organization_id", ctx.organizationId).in("contract_id", ids),
    listObservations(ctx),
  ]);
  const { data: discrepancies } = await ctx.supabase.from("evidence_verification_discrepancies")
    .select("evidence_requirement_id, created_at, resolved_at")
    .eq("organization_id", ctx.organizationId).limit(1000);
  const reqToContract = new Map<string, string>();
  for (const g of gaps ?? []) if (g.evidence_requirement_id) reqToContract.set(g.evidence_requirement_id, g.contract_id);
  const { data: reqs } = await ctx.supabase.from("obligation_evidence_requirements")
    .select("id, obligation_id").eq("organization_id", ctx.organizationId)
    .in("obligation_id", (obligations ?? []).map((o: any) => o.id));
  const obToContract = new Map((obligations ?? []).map((o: any) => [o.id as string, o.contract_id as string]));
  for (const r of reqs ?? []) reqToContract.set(r.id, obToContract.get(r.obligation_id) ?? "");

  const lastSweep = sweep ? {
    startedAt: sweep.started_at as string, asOfDate: (sweep.as_of_date as string | null) ?? null, status: sweep.status as string,
    failedContractIds: ((sweep.failures ?? []) as any[]).map((f) => f.contract_id as string),
  } : null;

  return contracts.map((c: any) => {
    const obs = observations.filter((o: ObservationRow) => o.contractId === c.id && (o.status === "active" || o.status === "acknowledged"));
    const facts: CoverageFacts = {
      today: ctx.clock.today,
      contractStatus: c.status,
      contractCreatedAt: c.created_at,
      operationalObligations: (obligations ?? []).filter((o: any) =>
        o.contract_id === c.id && o.review_status === "approved" && o.activation_status === "active").length,
      lastSweep,
      latestChangeAt: latest(
        ...(obligations ?? []).filter((o: any) => o.contract_id === c.id).map((o: any) => o.updated_at),
        ...(gaps ?? []).filter((g: any) => g.contract_id === c.id).flatMap((g: any) => [g.opened_at, g.closed_at]),
        ...(discrepancies ?? []).filter((d: any) => reqToContract.get(d.evidence_requirement_id) === c.id)
          .flatMap((d: any) => [d.created_at, d.resolved_at]),
      ),
    };
    const gapsList = coverageGaps(facts, c.id);
    const verdict = healthVerdict(obs.length, gapsList);
    return {
      contractId: c.id, contractNumber: c.contract_number, title: c.title, verdict,
      issues: obs.map((o) => ({ kind: o.kind, severity: o.severity, title: o.title, detail: o.detail, status: o.status })),
      coverage: { lastSweepAt: lastSweep?.startedAt ?? null, asOfDate: lastSweep?.asOfDate ?? null, gaps: gapsList },
      scopedStatement: verdict === "no_actionable_issues_recorded"
        ? (ctx.locale.startsWith("ar") ? SCOPED_NO_ISSUES_AR : SCOPED_NO_ISSUES_EN) : null,
    };
  });
}

// ---------- answer guard ------------------------------------------------------------

const HEALTH_WORDS = /\b(healthy|in good (?:health|standing|shape)|on track|no (?:actionable |immediate )?(?:issues?|exceptions?|concerns?|problems?)|nothing (?:needs|requires) attention|all clear)\b|سليم|بحالة جيدة|بصحة جيدة|لا توجد مشكلات|لا مشاكل/i;
const NEGATED_HEALTH = /\b(not|isn['’]t|no longer|cannot be (?:called|considered))\s+(?:\w+\s+){0,2}(healthy|on track|in good)|ليس\s+سليم|غير\s+سليم/i;
const CONTRACT_NO = /\b[A-Z]{2,}-\d{2,}\b/g;

export function mentionsHealth(text: string): boolean {
  return HEALTH_WORDS.test(text);
}

/**
 * A contract with unresolved actionable issues, or without a current
 * assessment, must not be presented as healthy. Such sentences are replaced
 * by a record-backed statement of what is actually recorded.
 */
export function enforceHealthClaims(
  text: string, health: ContractHealth[], locale: string,
): { text: string; corrected: string[] } {
  const ar = locale.startsWith("ar");
  const byNo = new Map(health.map((h) => [h.contractNumber.toUpperCase(), h]));
  const corrected: string[] = [];
  const notes = new Map<string, string>();
  let current: ContractHealth | null = null;
  const out = text.split("\n").map((ln) => {
    const named = [...ln.matchAll(CONTRACT_NO)].map((m) => byNo.get(m[0].toUpperCase())).filter(Boolean) as ContractHealth[];
    if (named.length) current = named[0];
    if (!HEALTH_WORDS.test(ln) || NEGATED_HEALTH.test(ln)) return ln;
    // The sentence's own contract, else the section it sits under.
    const target = named.length === 1 ? named[0] : named.length === 0 ? current : null;
    if (!target || target.verdict === "no_actionable_issues_recorded") return ln;
    corrected.push(ln.trim());
    if (!notes.has(target.contractNumber)) {
      const n = target.issues.length;
      notes.set(target.contractNumber, target.verdict === "actionable_issues"
        ? (ar
          ? `لا يمكن وصف ${target.contractNumber} بأنه سليم: ${n} مشكلة قابلة للإجراء مسجّلة — ${target.issues.map((i) => i.title).join("؛ ")}.`
          : `${target.contractNumber} cannot be described as healthy: ${n} actionable issue${n === 1 ? " is" : "s are"} recorded — ${target.issues.map((i) => i.title).join("; ")}.`)
        : (ar
          ? `لا يمكن وصف ${target.contractNumber} بأنه سليم: التقييم غير مكتمل (${target.coverage.gaps.map((g) => g.split(" ")[0]).join("، ")}).`
          : `${target.contractNumber} cannot be described as healthy: its assessment is incomplete (${target.coverage.gaps.map((g) => g.split(" ")[0]).join(", ")}).`));
      return notes.get(target.contractNumber)!;
    }
    return "";
  });
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), corrected };
}
