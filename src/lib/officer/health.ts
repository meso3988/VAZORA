import type { OfficerContext } from "@/lib/officer/context";
import type { OfficerCitation } from "@/domain/officer";
import { readObservations, type ObservationRow } from "@/lib/officer/observations";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Contract health = the sweep's unresolved observations + whether the sweep's
 * coverage of that contract is current. No new scoring and no re-detection:
 * the sweep engine is the single source of actionable issues; this module only
 * refuses to read "no observations" as health when the assessment is missing,
 * stale or incomplete.
 */

export type HealthVerdict = "actionable_issues" | "no_actionable_issues_recorded" | "assessment_incomplete";

export type SweepRef = { startedAt: string; asOfDate: string | null; status: string; failedContractIds: string[] };

export type CoverageFacts = {
  today: string;
  contractStatus: string;
  contractCreatedAt: string;
  operationalObligations: number;
  /** latest sweep that published results (completed or partial) */
  lastSweep: SweepRef | null;
  /** status of the most recent sweep ATTEMPT, whatever its outcome */
  latestAttemptStatus?: string | null;
  /** latest change to this contract's obligations, gaps or discrepancies */
  latestChangeAt: string | null;
  /** required reads that failed, returned an error, or were truncated */
  failedReads?: string[];
};

export type ContractHealth = {
  contractId: string;
  contractNumber: string;
  title: string;
  verdict: HealthVerdict;
  issues: {
    kind: string; severity: string; title: string; detail: string | null; status: string;
    /** the obligation the finding is about — present when the issue is
     *  obligation-bound; lets callers cite the record, not just the contract */
    obligationId: string | null;
    /** citations the detector stored on the underlying observation */
    citations: OfficerCitation[];
  }[];
  coverage: {
    lastSweepAt: string | null; asOfDate: string | null; gaps: string[];
    /** true only when every eligibility, freshness and read requirement held */
    complete: boolean;
    /** last assessment in which THIS contract succeeded — historical context, not a fresh result */
    lastSuccessfulAssessmentAt: string | null;
  };
  /** the only wording a "no issues" verdict supports */
  scopedStatement: string | null;
};

export const SCOPED_NO_ISSUES_EN = "No actionable issues are recorded within the checks and data available.";
export const SCOPED_NO_ISSUES_AR = "لا توجد مشكلات قابلة للإجراء مسجّلة ضمن الفحوصات والبيانات المتاحة.";

/** Raised when not even the contract list could be read — nothing to report. */
export class HealthUnavailableError extends Error {
  constructor(public code: string) { super(code); }
}

/** Why the sweep's silence about a contract cannot be read as health. */
export function coverageGaps(f: CoverageFacts, contractId: string): string[] {
  const gaps: string[] = (f.failedReads ?? []).map((r) => `read_failed:${r} — part of the assessment data could not be read`);
  if (f.contractStatus !== "active") gaps.push(`contract_not_active (${f.contractStatus}) — not monitored by the sweep`);
  if (f.operationalObligations === 0 && !(f.failedReads ?? []).includes("contract_obligations")) {
    gaps.push("no_operational_obligations — nothing has been assessed");
  }
  if (f.latestAttemptStatus && !["completed", "partial"].includes(f.latestAttemptStatus)) {
    gaps.push(`latest_sweep_attempt_${f.latestAttemptStatus} — the most recent assessment did not complete`);
  }
  const s = f.lastSweep;
  if (!s) return [...gaps, "no_completed_sweep — the contract has never been assessed"];
  if (s.asOfDate !== f.today) gaps.push(`sweep_not_current — last assessed as of ${s.asOfDate ?? "unknown"}, today is ${f.today}`);
  if (s.failedContractIds.includes(contractId)) gaps.push("sweep_failed_for_contract");
  if (s.failedContractIds.includes("organization")) gaps.push("sweep_failed_organization_checks");
  if (Date.parse(f.contractCreatedAt) > Date.parse(s.startedAt)) gaps.push("contract_added_after_last_sweep");
  if (f.latestChangeAt && Date.parse(f.latestChangeAt) > Date.parse(s.startedAt)) {
    gaps.push("data_changed_since_last_sweep — obligations, gaps or discrepancies changed after the assessment");
  }
  return gaps;
}

export function healthVerdict(openIssues: number, gaps: string[]): HealthVerdict {
  // Known issues stay visible even when coverage is incomplete (the gaps
  // travel with them); silence is only "no issues" when coverage is complete.
  if (openIssues > 0) return "actionable_issues";
  return gaps.length ? "assessment_incomplete" : "no_actionable_issues_recorded";
}

const latest = (...xs: (string | null | undefined)[]) =>
  xs.filter((x): x is string => !!x).sort().at(-1) ?? null;

const READ_LIMIT = 1000;

/**
 * Run one required read. A returned error, a thrown/network error, a missing
 * result or a truncated page is recorded as a failed read — never as [].
 */
async function required<T = any>(label: string, failed: string[], run: () => PromiseLike<{ data: any; error: any }>, opts: { single?: boolean } = {}): Promise<T | null> {
  try {
    const { data, error } = await run();
    if (error) { failed.push(label); return null; }
    if (opts.single) return (data ?? null) as T;
    if (!Array.isArray(data)) { failed.push(label); return null; }
    if (data.length >= READ_LIMIT) { failed.push(`${label}_truncated`); return data as T; }
    return data as T;
  } catch {
    failed.push(label);
    return null;
  }
}

/** Assess one or all active contracts of the caller's organization. */
export async function assessContractHealth(
  ctx: OfficerContext,
  opts: { contractIds?: string[] } = {},
): Promise<ContractHealth[]> {
  const failed: string[] = [];
  const contracts = await required<any[]>("contracts", failed, () => {
    let cq = ctx.supabase.from("contracts")
      .select("id, contract_number, title, status, created_at")
      .eq("organization_id", ctx.organizationId);
    cq = opts.contractIds?.length ? cq.in("id", opts.contractIds) : cq.eq("status", "active");
    return cq.limit(READ_LIMIT);
  });
  if (!contracts || failed.length) throw new HealthUnavailableError("contracts_read_failed");
  if (!contracts.length) return [];
  const ids = contracts.map((c: any) => c.id as string);

  const [sweeps, obligations, gaps, observations, discrepancies] = await Promise.all([
    required<any[]>("officer_sweep_runs", failed, () => ctx.supabase.from("officer_sweep_runs")
      .select("started_at, completed_at, as_of_date, status, failures")
      .eq("organization_id", ctx.organizationId)
      .order("started_at", { ascending: false }).limit(20)),
    required<any[]>("contract_obligations", failed, () => ctx.supabase.from("contract_obligations")
      .select("id, contract_id, review_status, activation_status, updated_at")
      .eq("organization_id", ctx.organizationId).in("contract_id", ids).limit(READ_LIMIT)),
    required<any[]>("evidence_gaps", failed, () => ctx.supabase.from("evidence_gaps")
      .select("contract_id, evidence_requirement_id, opened_at, closed_at")
      .eq("organization_id", ctx.organizationId).in("contract_id", ids).limit(READ_LIMIT)),
    readObservations(ctx),
    required<any[]>("evidence_verification_discrepancies", failed, () => ctx.supabase.from("evidence_verification_discrepancies")
      .select("evidence_requirement_id, created_at, resolved_at")
      .eq("organization_id", ctx.organizationId).limit(READ_LIMIT)),
  ]);
  if (!observations.ok) failed.push(observations.code === "observations_truncated" ? "officer_observations_truncated" : "officer_observations");
  const obRows = obligations ?? [];
  const reqs = obRows.length
    ? await required<any[]>("obligation_evidence_requirements", failed, () => ctx.supabase.from("obligation_evidence_requirements")
        .select("id, obligation_id").eq("organization_id", ctx.organizationId)
        .in("obligation_id", obRows.map((o: any) => o.id)).limit(READ_LIMIT))
    : [];
  const reqToContract = new Map<string, string>();
  for (const g of gaps ?? []) if (g.evidence_requirement_id) reqToContract.set(g.evidence_requirement_id, g.contract_id);
  const obToContract = new Map(obRows.map((o: any) => [o.id as string, o.contract_id as string]));
  for (const r of reqs ?? []) reqToContract.set(r.id, obToContract.get(r.obligation_id) ?? "");

  const toRef = (s: any): SweepRef => ({
    startedAt: s.started_at as string, asOfDate: (s.as_of_date as string | null) ?? null, status: s.status as string,
    failedContractIds: ((s.failures ?? []) as any[]).map((f) => String(f.contract_id)),
  });
  const published = (sweeps ?? []).filter((s: any) => s.status === "completed" || s.status === "partial").map(toRef);
  const lastSweep = published[0] ?? null;
  const latestAttemptStatus = (sweeps ?? [])[0]?.status ?? null;
  const openRows = observations.ok ? observations.rows : [];

  return contracts.map((c: any) => {
    const obs = openRows.filter((o: ObservationRow) => o.contractId === c.id && (o.status === "active" || o.status === "acknowledged"));
    const facts: CoverageFacts = {
      today: ctx.clock.today,
      contractStatus: c.status,
      contractCreatedAt: c.created_at,
      operationalObligations: obRows.filter((o: any) =>
        o.contract_id === c.id && o.review_status === "approved" && o.activation_status === "active").length,
      lastSweep,
      latestAttemptStatus,
      latestChangeAt: latest(
        ...obRows.filter((o: any) => o.contract_id === c.id).map((o: any) => o.updated_at),
        ...(gaps ?? []).filter((g: any) => g.contract_id === c.id).flatMap((g: any) => [g.opened_at, g.closed_at]),
        ...(discrepancies ?? []).filter((d: any) => reqToContract.get(d.evidence_requirement_id) === c.id)
          .flatMap((d: any) => [d.created_at, d.resolved_at]),
      ),
      failedReads: failed,
    };
    const gapsList = coverageGaps(facts, c.id);
    const verdict = healthVerdict(obs.length, gapsList);
    const lastOk = published.find((s) => !s.failedContractIds.includes(c.id) && !s.failedContractIds.includes("organization"));
    return {
      contractId: c.id, contractNumber: c.contract_number, title: c.title, verdict,
      issues: obs.map((o) => ({
        kind: o.kind, severity: o.severity, title: o.title, detail: o.detail, status: o.status,
        obligationId: o.obligationId ?? null, citations: o.citations ?? [],
      })),
      coverage: {
        lastSweepAt: lastSweep?.startedAt ?? null, asOfDate: lastSweep?.asOfDate ?? null, gaps: gapsList,
        complete: gapsList.length === 0, lastSuccessfulAssessmentAt: lastOk?.startedAt ?? null,
      },
      scopedStatement: verdict === "no_actionable_issues_recorded"
        ? (ctx.locale.startsWith("ar") ? SCOPED_NO_ISSUES_AR : SCOPED_NO_ISSUES_EN) : null,
    };
  });
}

// ---------- answer guard ------------------------------------------------------------

const HEALTH_WORDS = /\b(healthy|in good (?:health|standing|shape)|on track|no (?:actionable |immediate )?(?:issues?|exceptions?|concerns?|problems?)|nothing (?:needs|requires) attention|all clear|fully (?:checked|assessed|reviewed)|all checks (?:passed|clear)|everything (?:is|looks) (?:fine|good|in order)|nothing to worry about)\b|سليم|بحالة جيدة|بصحة جيدة|لا توجد مشكلات|لا مشاكل|كل شيء على ما يرام|تم فحص كل شيء/i;
const NEGATED_HEALTH = /\b(not|isn['’]t|no longer|cannot be (?:called|considered|described))\s+(?:\w+\s+){0,2}(healthy|on track|in good)|ليس\s+سليم|غير\s+سليم|لا يمكن وصف/i;
const CONTRACT_NO = /\b[A-Z]{2,}-\d{2,}\b/g;

export function mentionsHealth(text: string): boolean {
  return HEALTH_WORDS.test(text);
}

const codes = (gaps: string[], sep: string) => gaps.map((g) => g.split(" ")[0]).join(sep);

/** Localized "could not complete" wording, with the last success as history only. */
export function incompleteAssessmentMessage(locale: string, lastSuccessfulAt: string | null): string {
  if (locale.startsWith("ar")) {
    return lastSuccessfulAt
      ? `لم أتمكن من إكمال التقييم الحالي. آخر تقييم ناجح (${lastSuccessfulAt}) معروض منفصلًا وقد يكون قديمًا.`
      : "لم أتمكن من إكمال التقييم الحالي، ولا يوجد تقييم ناجح سابق.";
  }
  return lastSuccessfulAt
    ? `I could not complete the current assessment. The last successful assessment (${lastSuccessfulAt}) is shown separately and may be outdated.`
    : "I could not complete the current assessment, and there is no earlier successful assessment.";
}

/**
 * A contract with unresolved actionable issues, or without a complete and
 * current assessment, must not be presented as healthy (or as fully checked).
 * Such sentences are replaced by a record-backed statement of what is actually
 * recorded. `health === null` means the assessment itself could not be read:
 * every reassurance is replaced by the "could not complete" statement.
 */
export function enforceHealthClaims(
  text: string, health: ContractHealth[] | null, locale: string,
): { text: string; corrected: string[] } {
  const ar = locale.startsWith("ar");
  const byNo = new Map((health ?? []).map((h) => [h.contractNumber.toUpperCase(), h]));
  const corrected: string[] = [];
  const notes = new Map<string, string>();
  let current: ContractHealth | null = null;
  const out = text.split("\n").map((ln) => {
    const named = [...ln.matchAll(CONTRACT_NO)].map((m) => byNo.get(m[0].toUpperCase())).filter(Boolean) as ContractHealth[];
    if (named.length) current = named[0];
    if (!HEALTH_WORDS.test(ln) || NEGATED_HEALTH.test(ln)) return ln;
    if (health === null) {
      corrected.push(ln.trim());
      if (notes.has("*")) return "";
      notes.set("*", incompleteAssessmentMessage(locale, null));
      return notes.get("*")!;
    }
    // The sentence's own contract, else the section it sits under.
    const target = named.length === 1 ? named[0] : named.length === 0 ? current : null;
    if (!target || target.verdict === "no_actionable_issues_recorded") return ln;
    corrected.push(ln.trim());
    if (notes.has(target.contractNumber)) return "";
    const n = target.issues.length;
    const gaps = target.coverage.gaps;
    let note: string;
    if (target.verdict === "actionable_issues") {
      note = ar
        ? `لا يمكن وصف ${target.contractNumber} بأنه سليم: ${n} مشكلة قابلة للإجراء مسجّلة — ${target.issues.map((i) => i.title).join("؛ ")}.`
        : `${target.contractNumber} cannot be described as healthy: ${n} actionable issue${n === 1 ? " is" : "s are"} recorded — ${target.issues.map((i) => i.title).join("; ")}.`;
      if (gaps.length) note += ar ? ` التغطية غير مكتملة (${codes(gaps, "، ")}).` : ` Coverage is incomplete (${codes(gaps, ", ")}).`;
    } else {
      note = (ar
        ? `لا يمكن وصف ${target.contractNumber} بأنه سليم: التقييم غير مكتمل (${codes(gaps, "، ")}). `
        : `${target.contractNumber} cannot be described as healthy: its assessment is incomplete (${codes(gaps, ", ")}). `)
        + incompleteAssessmentMessage(locale, target.coverage.lastSuccessfulAssessmentAt);
    }
    notes.set(target.contractNumber, note);
    return note;
  });
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n").trim(), corrected };
}
