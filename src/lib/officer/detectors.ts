import type { CheckResult, EffectiveEvidenceStatus } from "@/domain/evidence";
import { classifyDeadline, type CalendarDate, type DeadlineWindow } from "@/lib/officer/time";

/**
 * Deterministic operational detectors.
 *
 * THE DATABASE ALREADY KNOWS. We never ask a model whether something is
 * overdue, unassigned or missing evidence — that is arithmetic and set
 * membership over facts the system owns. The model's job comes later:
 * wording a brief over these structured findings.
 *
 * Pure: no I/O, no framework, fully unit-testable.
 */

export type ObservationKind =
  | "due_today"
  | "due_soon"
  | "overdue"
  | "missing_required_evidence"
  | "partial_evidence"
  | "reverification_pending"
  | "verification_discrepancy"
  | "unassigned_obligation"
  | "external_dependency_pending"
  | "contract_expiry_approaching"
  | "recently_resolved"
  | "action_waiting_for_approval";

export type Severity = "critical" | "high" | "medium" | "low" | "informational";

export type TimeBucket = "critical" | "today" | "next_3_days" | "this_week" | "monitoring" | "resolved";

/** Deterministic thresholds — parameters, not constants, so they can become
 * organization preferences without touching detector logic. */
export type SweepThresholds = {
  nearDays: number;         // "next 3 days"
  weekDays: number;         // "this week"
  expiryWarningDays: number;
  resolvedLookbackDays: number;
};

export const DEFAULT_THRESHOLDS: SweepThresholds = {
  nearDays: 3,
  weekDays: 7,
  expiryWarningDays: 45,
  resolvedLookbackDays: 3,
};

/** One requirement's operational picture, as the sweep sees it. */
export type RequirementFacts = {
  requirementId: string;
  name: string;
  required: boolean;
  effective: EffectiveEvidenceStatus;
  /** open gap on this requirement, if any */
  gap: { id: string; status: string; gapType: string } | null;
  /** pending same-version discrepancy id, if any */
  pendingDiscrepancyId: string | null;
};

export type ObligationFacts = {
  obligationId: string;
  contractId: string;
  contractNumber: string | null;
  title: string;
  dueDate: CalendarDate | null;
  dueRuleRaw: string | null;
  /** clause id backing the obligation, when traceability exists */
  clauseId: string | null;
  /** any financial/penalty condition text present (never an amount we invent) */
  hasFinancialCondition: boolean;
  externalDependency: string | null;
  requiresExternalAcknowledgement: boolean;
  ownerAssigned: boolean;
  suggestedOwnerRole: string | null;
  requirements: RequirementFacts[];
};

export type ContractFacts = {
  contractId: string;
  contractNumber: string;
  title: string;
  endDate: CalendarDate | null;
  status: string;
};

/** A detected finding, before persistence. */
export type Finding = {
  kind: ObservationKind;
  severity: Severity;
  timeBucket: TimeBucket;
  /** stable identity of the CONDITION, not of this sighting */
  dedupeKey: string;
  title: string;
  detail: string;
  contractId: string | null;
  obligationId: string | null;
  evidenceRequirementId: string | null;
  /** machine-readable reason codes that justify the severity */
  priorityReason: string[];
  /** deterministic facts only */
  supportingFacts: Record<string, unknown>;
  recommendedActionType: string | null;
  citations: { target: string; id: string; label: string }[];
  /** 1 critical … 4 monitoring — ordering for the Command Center */
  priority: number;
};

const UNPROVEN: CheckResult[] = ["missing", "not_found", "unable_to_verify"];

function bucketFor(window: DeadlineWindow, severity: Severity): TimeBucket {
  if (severity === "critical") return "critical";
  switch (window) {
    case "overdue": return "critical";
    case "today": return "today";
    case "next_3_days": return "next_3_days";
    case "this_week": return "this_week";
    default: return "monitoring";
  }
}

const PRIORITY_OF: Record<Severity, number> = {
  critical: 1, high: 1, medium: 2, low: 3, informational: 4,
};

/**
 * Detect everything wrong (or worth watching) on ONE obligation.
 *
 * Deliberate restraint: a healthy obligation produces NOTHING. Manufacturing
 * observations to look busy is a product failure, not a feature.
 */
export function detectForObligation(opts: {
  today: CalendarDate;
  obligation: ObligationFacts;
  thresholds?: SweepThresholds;
}): Finding[] {
  const th = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const o = opts.obligation;
  const out: Finding[] = [];
  const deadline = classifyDeadline({
    today: opts.today, dueDate: o.dueDate,
    nearDays: th.nearDays, weekDays: th.weekDays,
  });

  const label = o.contractNumber ? `${o.contractNumber} — ${o.title}` : o.title;
  const baseCitations = [
    { target: "obligation", id: o.obligationId, label: o.title },
    ...(o.clauseId ? [{ target: "clause", id: o.clauseId, label: "Source clause" }] : []),
  ];

  // Requirements whose OPERATIONAL state is not proven. Effective status is
  // authoritative: a pending discrepancy does NOT make evidence missing.
  const unproven = o.requirements.filter(
    (r) => r.required && (r.effective.operational == null || UNPROVEN.includes(r.effective.operational)),
  );
  const partial = o.requirements.filter((r) => r.required && r.effective.operational === "partial");
  const reverifying = o.requirements.filter((r) => r.gap?.status === "reverification_pending");
  const discrepancies = o.requirements.filter((r) => r.pendingDiscrepancyId);

  const evidenceIncomplete = unproven.length > 0 || partial.length > 0;

  // ---- deadline findings ---------------------------------------------------
  if (deadline.window === "overdue") {
    // Overdue + mandatory evidence missing is the worst operational state.
    const severity: Severity = evidenceIncomplete ? "critical" : "high";
    const reasons = [`overdue_by_${deadline.daysOverdue}_days`];
    if (unproven.length) reasons.push("required_evidence_missing");
    if (partial.length) reasons.push("evidence_partial");
    if (o.hasFinancialCondition) reasons.push("financial_condition_present");
    out.push({
      kind: "overdue", severity, timeBucket: "critical",
      dedupeKey: `overdue:${o.obligationId}`,
      title: `Overdue: ${label}`,
      detail: `Due ${o.dueDate} — ${deadline.daysOverdue} day(s) overdue.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: null,
      priorityReason: reasons,
      supportingFacts: {
        due_date: o.dueDate, days_overdue: deadline.daysOverdue,
        due_rule: o.dueRuleRaw,
        unproven_requirements: unproven.length, partial_requirements: partial.length,
        financial_condition_present: o.hasFinancialCondition,
      },
      recommendedActionType: evidenceIncomplete ? "officer.request_evidence_internal" : "officer.escalate",
      citations: baseCitations,
      priority: PRIORITY_OF[severity],
    });
  } else if (deadline.window === "today") {
    const severity: Severity = evidenceIncomplete ? "high" : "informational";
    out.push({
      kind: "due_today", severity, timeBucket: bucketFor("today", severity),
      dedupeKey: `due_today:${o.obligationId}:${o.dueDate}`,
      title: `Due today: ${label}`,
      detail: evidenceIncomplete
        ? `Due today and required evidence is not yet proven.`
        : `Due today; required evidence is currently proven.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: null,
      priorityReason: ["due_today", ...(evidenceIncomplete ? ["required_evidence_missing"] : ["evidence_complete"])],
      supportingFacts: { due_date: o.dueDate, days_until_due: 0, unproven_requirements: unproven.length },
      recommendedActionType: evidenceIncomplete ? "officer.request_evidence_internal" : null,
      citations: baseCitations,
      priority: PRIORITY_OF[severity],
    });
  } else if ((deadline.window === "next_3_days" || deadline.window === "this_week") && evidenceIncomplete) {
    // Only raise a future deadline when something is actually unproven —
    // "due in 5 days, evidence complete" is not an issue.
    const severity: Severity = deadline.window === "next_3_days" ? "high" : "medium";
    out.push({
      kind: "due_soon", severity, timeBucket: bucketFor(deadline.window, severity),
      dedupeKey: `due_soon:${o.obligationId}:${o.dueDate}`,
      title: `Due in ${deadline.daysUntilDue} day(s): ${label}`,
      detail: `Required evidence is not yet proven for this obligation.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: null,
      priorityReason: [
        `due_in_${deadline.daysUntilDue}_days`,
        ...(unproven.length ? ["required_evidence_missing"] : ["evidence_partial"]),
        ...(o.hasFinancialCondition ? ["financial_condition_present"] : []),
      ],
      supportingFacts: {
        due_date: o.dueDate, days_until_due: deadline.daysUntilDue,
        unproven_requirements: unproven.length, partial_requirements: partial.length,
        financial_condition_present: o.hasFinancialCondition,
      },
      recommendedActionType: "officer.request_evidence_internal",
      citations: baseCitations,
      priority: PRIORITY_OF[severity],
    });
  }

  // ---- evidence findings, per requirement ---------------------------------
  for (const r of unproven) {
    // External dependency: the contractor side may be done and the CLIENT is
    // the blocker. Saying "the owner failed" would be false.
    const external = o.requiresExternalAcknowledgement || !!o.externalDependency;
    const isAckLike = /acknowledg|إقرار|approval|countersign/i.test(r.name);
    const waitingExternal = external && isAckLike;
    const severity: Severity =
      deadline.window === "overdue" ? "high"
      : deadline.window === "today" || deadline.window === "next_3_days" ? "high"
      : "medium";

    out.push({
      kind: waitingExternal ? "external_dependency_pending" : "missing_required_evidence",
      severity, timeBucket: bucketFor(deadline.window, severity),
      dedupeKey: `${waitingExternal ? "external_pending" : "missing_evidence"}:${r.requirementId}`,
      title: waitingExternal
        ? `Waiting on external party: ${r.name}`
        : `Missing required evidence: ${r.name}`,
      detail: waitingExternal
        ? `No verified ${r.name.toLowerCase()} is recorded. This item depends on an external party${o.externalDependency ? ` (${o.externalDependency})` : ""}, not on internal work.`
        : `No verified evidence is recorded for ${r.name}.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: r.requirementId,
      priorityReason: [
        "required_evidence_missing",
        ...(waitingExternal ? ["external_dependency"] : []),
        ...(o.dueDate ? [`deadline_${deadline.window}`] : []),
      ],
      supportingFacts: {
        requirement: r.name, operational_status: r.effective.operational,
        latest_verification_result: r.effective.latest,
        external_dependency: waitingExternal ? (o.externalDependency ?? "client acknowledgement") : null,
        gap_id: r.gap?.id ?? null, gap_status: r.gap?.status ?? null,
        due_date: o.dueDate, days_until_due: deadline.daysUntilDue, days_overdue: deadline.daysOverdue,
      },
      recommendedActionType: waitingExternal ? "officer.escalate" : "officer.request_evidence_internal",
      citations: [
        ...baseCitations,
        { target: "evidence_requirement", id: r.requirementId, label: r.name },
        ...(r.gap ? [{ target: "evidence_gap", id: r.gap.id, label: `${r.gap.gapType} gap` }] : []),
      ],
      priority: PRIORITY_OF[severity],
    });
  }

  for (const r of partial) {
    const severity: Severity = deadline.window === "overdue" ? "high" : "medium";
    out.push({
      kind: "partial_evidence", severity, timeBucket: bucketFor(deadline.window, severity),
      dedupeKey: `partial_evidence:${r.requirementId}`,
      title: `Partial evidence: ${r.name}`,
      detail: `The recorded evidence only partly proves ${r.name}.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: r.requirementId,
      priorityReason: ["evidence_partial", `deadline_${deadline.window}`],
      supportingFacts: {
        requirement: r.name, operational_status: r.effective.operational,
        latest_verification_result: r.effective.latest, gap_id: r.gap?.id ?? null,
      },
      recommendedActionType: "officer.request_evidence_internal",
      citations: [...baseCitations, { target: "evidence_requirement", id: r.requirementId, label: r.name }],
      priority: PRIORITY_OF[severity],
    });
  }

  for (const r of reverifying) {
    out.push({
      kind: "reverification_pending", severity: "low", timeBucket: "monitoring",
      dedupeKey: `reverification_pending:${r.requirementId}`,
      title: `Re-verification in progress: ${r.name}`,
      detail: `A verification run is in progress for this requirement; the gap stays open until it completes.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: r.requirementId,
      priorityReason: ["reverification_pending"],
      supportingFacts: { requirement: r.name, gap_id: r.gap?.id ?? null, gap_status: r.gap?.status ?? null },
      recommendedActionType: null,
      citations: [...baseCitations, { target: "evidence_requirement", id: r.requirementId, label: r.name }],
      priority: PRIORITY_OF.low,
    });
  }

  // Phase 3 semantics: a pending same-version discrepancy is a REVIEW need,
  // never "evidence missing" — the operational state stands until a human
  // decides.
  for (const r of discrepancies) {
    out.push({
      kind: "verification_discrepancy", severity: "medium", timeBucket: "monitoring",
      dedupeKey: `verification_discrepancy:${r.pendingDiscrepancyId}`,
      title: `Verification discrepancy requires review: ${r.name}`,
      detail: `A later verification run disagreed with a previously accepted result on the same unchanged evidence. The operational status remains ${r.effective.operational ?? "unknown"} until a reviewer decides.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: r.requirementId,
      priorityReason: ["verification_discrepancy_pending", "operational_state_unchanged"],
      supportingFacts: {
        requirement: r.name,
        operational_status: r.effective.operational,
        latest_verification_result: r.effective.latest,
        discrepancy_id: r.pendingDiscrepancyId,
        prior_state_in_force: r.effective.priorStateInForce,
      },
      recommendedActionType: null,
      citations: [
        ...baseCitations,
        { target: "evidence_requirement", id: r.requirementId, label: r.name },
        { target: "verification_discrepancy", id: r.pendingDiscrepancyId!, label: "Verification discrepancy" },
      ],
      priority: PRIORITY_OF.medium,
    });
  }

  // ---- ownership ----------------------------------------------------------
  if (!o.ownerAssigned) {
    const severity: Severity =
      deadline.window === "overdue" || deadline.window === "today" ? "high" : "medium";
    out.push({
      kind: "unassigned_obligation", severity, timeBucket: bucketFor(deadline.window, severity),
      dedupeKey: `unassigned:${o.obligationId}`,
      title: `No owner assigned: ${label}`,
      detail: o.suggestedOwnerRole
        ? `No person is assigned. The extracted contract text suggests the role "${o.suggestedOwnerRole}"; assignment still requires approval.`
        : `No person is assigned to this obligation.`,
      contractId: o.contractId, obligationId: o.obligationId, evidenceRequirementId: null,
      priorityReason: ["unassigned", `deadline_${deadline.window}`],
      supportingFacts: {
        suggested_role: o.suggestedOwnerRole, due_date: o.dueDate,
        days_until_due: deadline.daysUntilDue, days_overdue: deadline.daysOverdue,
      },
      recommendedActionType: "obligation.assign_owner",
      citations: baseCitations,
      priority: PRIORITY_OF[severity],
    });
  }

  return out;
}

/** Contract-level watch: expiry approaching. */
export function detectForContract(opts: {
  today: CalendarDate;
  contract: ContractFacts;
  thresholds?: SweepThresholds;
}): Finding[] {
  const th = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const c = opts.contract;
  if (!c.endDate || c.status !== "active") return [];
  const d = classifyDeadline({ today: opts.today, dueDate: c.endDate, nearDays: th.nearDays, weekDays: th.weekDays });
  if (d.daysUntilDue == null || d.daysUntilDue < 0 || d.daysUntilDue > th.expiryWarningDays) return [];
  return [{
    kind: "contract_expiry_approaching",
    severity: d.daysUntilDue <= th.weekDays ? "high" : "low",
    timeBucket: d.daysUntilDue <= th.weekDays ? "this_week" : "monitoring",
    dedupeKey: `contract_expiry:${c.contractId}:${c.endDate}`,
    title: `Contract ending in ${d.daysUntilDue} day(s): ${c.contractNumber} — ${c.title}`,
    detail: `The recorded end date is ${c.endDate}.`,
    contractId: c.contractId, obligationId: null, evidenceRequirementId: null,
    priorityReason: [`contract_ends_in_${d.daysUntilDue}_days`],
    supportingFacts: { end_date: c.endDate, days_until_end: d.daysUntilDue },
    recommendedActionType: "officer.escalate",
    citations: [{ target: "contract", id: c.contractId, label: `${c.contractNumber} — ${c.title}` }],
    priority: d.daysUntilDue <= th.weekDays ? PRIORITY_OF.high : PRIORITY_OF.low,
  }];
}

/** Officer actions a human still has to decide on. */
export function detectWaitingApprovals(actions: {
  id: string; actionType: string; contractId: string | null; obligationId: string | null; reason: string;
}[]): Finding[] {
  return actions.map((a) => ({
    kind: "action_waiting_for_approval" as ObservationKind,
    severity: "medium" as Severity,
    timeBucket: "today" as TimeBucket,
    dedupeKey: `action_waiting:${a.id}`,
    title: `Waiting for your approval: ${a.actionType}`,
    detail: a.reason,
    contractId: a.contractId, obligationId: a.obligationId, evidenceRequirementId: null,
    priorityReason: ["action_waiting_for_approval"],
    supportingFacts: { action_id: a.id, action_type: a.actionType },
    recommendedActionType: null,
    citations: a.contractId ? [{ target: "contract", id: a.contractId, label: "Contract" }] : [],
    priority: PRIORITY_OF.medium,
  }));
}
