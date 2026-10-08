/**
 * An obligation's state as three separate facts — never one badge:
 *
 *   lifecycle — review/activation: an active obligation is ACTIVE, not verified
 *   deadline  — the Officer's deterministic deadline window in the org clock
 *   evidence  — effective verification of its REQUIRED evidence requirements,
 *               from the evidence matrix (effective operational status, open
 *               gaps, pending discrepancies) — never from activation_status
 *
 * Being overdue says nothing about verification, and verified evidence says
 * nothing about timeliness. Pure: no I/O.
 */

import type { EvidenceMatrixRow } from "@/domain/evidence";
import { UNPROVEN } from "@/lib/officer/detectors";
import { obligationSchedule, operationalDueDate, type NeedsScheduleReason } from "@/lib/officer/schedule";
import { classifyDeadline, type CalendarDate, type DeadlineWindow } from "@/lib/officer/time";

export type ObligationLifecycle = "active" | "approved_not_active";

export type ObligationDeadline =
  | {
      window: DeadlineWindow;
      daysOverdue: number | null;
      daysUntilDue: number | null;
      /** operational due date: explicit, or the oldest unsettled recurring cycle */
      dueDate: CalendarDate | null;
      recurring?: { rule: string; unsettledPastCount: number; nextDue: CalendarDate | null; settlementsKnown: boolean };
    }
  | { window: "needs_schedule"; reason: NeedsScheduleReason }
  | { window: "unknown" };

export type ObligationEvidenceState =
  | "verified"
  | "partial"
  | "missing"
  | "awaiting_verification"
  | "needs_review"
  | "no_requirements"
  | "unavailable";

export type ObligationEvidence = {
  state: ObligationEvidenceState;
  /** required requirements on the obligation */
  required: number;
  /** required requirements whose effective state does not block (verified / not applicable) */
  satisfied: number;
  /** a pending same-version discrepancy keeps a prior verified state in force */
  priorStateInForce: boolean;
};

export type ObligationState = {
  lifecycle: ObligationLifecycle;
  deadline: ObligationDeadline;
  evidence: ObligationEvidence;
};

const UNAVAILABLE: ObligationEvidence = { state: "unavailable", required: 0, satisfied: 0, priorStateInForce: false };
const SATISFIED = new Set(["verified", "not_applicable"]);

/** Effective evidence state of one obligation from its evidence-matrix rows. */
export function obligationEvidence(rows: EvidenceMatrixRow[]): ObligationEvidence {
  const required = rows.filter((r) => r.requirement.required);
  if (!required.length) return { state: "no_requirements", required: 0, satisfied: 0, priorStateInForce: false };

  const per = required.map((r): ObligationEvidenceState | "satisfied" => {
    const op = r.effective.operational;
    // An open gap is the system's own statement that the requirement is not
    // operationally met; an upload alone (evidence_received) does not close it.
    if (r.gap) return r.gap.status === "open" ? "missing" : "awaiting_verification";
    if (op == null || UNPROVEN.includes(op)) return "missing";
    if (op === "partial") return "partial";
    if (op === "needs_human_review") return "needs_review";
    return SATISFIED.has(op) ? "satisfied" : "needs_review";
  });
  const order: ObligationEvidenceState[] = ["missing", "partial", "awaiting_verification", "needs_review"];
  const worst = order.find((s) => per.includes(s));
  return {
    state: worst ?? "verified",
    required: required.length,
    satisfied: per.filter((s) => s === "satisfied").length,
    priorStateInForce: required.some((r) => r.effective.priorStateInForce),
  };
}

/**
 * States for a contract's obligations. `matrix` null = the evidence read
 * failed (every evidence state unavailable); `today` null = the org clock
 * could not be resolved (deadline unknown). Neither is ever a healthy state.
 */
export function obligationStates(
  obligations: { id: string; dueDate: string; lifecycle?: ObligationLifecycle; dueRuleNormalized?: string | null; frequencyRaw?: string | null }[],
  matrix: EvidenceMatrixRow[] | null,
  today: CalendarDate | null,
  contract: { startDate?: string | null; endDate?: string | null } = {},
  /** active settled cycle dates per obligation; null = settlement read failed */
  settled: (obligationId: string) => CalendarDate[] | null = () => [],
): Map<string, ObligationState> {
  return new Map(obligations.map((o) => [o.id, {
    lifecycle: o.lifecycle ?? "approved_not_active",
    deadline: today ? obligationDeadline(o, today, contract, settled(o.id)) : { window: "unknown" as const },
    evidence: matrix ? obligationEvidence(matrix.filter((r) => r.requirement.obligationId === o.id)) : UNAVAILABLE,
  }]));
}

function obligationDeadline(
  o: { dueDate: string; dueRuleNormalized?: string | null; frequencyRaw?: string | null },
  today: CalendarDate,
  contract: { startDate?: string | null; endDate?: string | null },
  settledCycles: CalendarDate[] | null,
): ObligationDeadline {
  const s = obligationSchedule({
    dueDateNormalized: o.dueDate || null, dueRuleNormalized: o.dueRuleNormalized, frequency: o.frequencyRaw,
    contractStart: contract.startDate, contractEnd: contract.endDate, today, settledCycles,
  });
  if (s.kind === "needs_schedule") return { window: "needs_schedule", reason: s.reason };
  const due = operationalDueDate(s);
  return {
    ...classifyDeadline({ today, dueDate: due }),
    dueDate: due,
    ...(s.kind === "recurring" ? { recurring: { rule: s.rule, unsettledPastCount: s.unsettledPastCount, nextDue: s.nextDue, settlementsKnown: s.settlementsKnown } } : {}),
  };
}
