/**
 * Contract indicators with an explicit state, so a value that was never
 * computed can never render as a real zero.
 *
 *   value          — counted from the source; 0 is a real zero
 *   not_calculated — the metric has no implemented calculation in this release
 *   deferred       — the capability itself is not part of this release
 *   unavailable    — the source read failed; nothing was calculated
 *   incomplete     — the source read was truncated; a count would understate
 *
 * Pure: no I/O. Live counts reuse the Officer's operational definition
 * (approved + active) and its deterministic deadline classification.
 */

import type { ContractHealth } from "@/domain/types";
import { obligationSchedule, operationalDueDate } from "@/lib/officer/schedule";
import { classifyDeadline, type CalendarDate } from "@/lib/officer/time";

export type Indicator =
  | { state: "value"; value: number }
  | { state: "not_calculated" }
  | { state: "deferred" }
  | { state: "unavailable" }
  | { state: "incomplete" };

export type IndicatorName = keyof ContractHealth;
export type ContractIndicators = Record<IndicatorName, Indicator>;

const value = (n: number): Indicator => ({ state: "value", value: n });
const NOT_CALCULATED: Indicator = { state: "not_calculated" };
const DEFERRED: Indicator = { state: "deferred" };

/** Demo fixtures carry illustrative health figures; they stay as-is. */
export function demoIndicators(health: ContractHealth): ContractIndicators {
  return {
    obligationsTotal: value(health.obligationsTotal),
    obligationsDueThisMonth: value(health.obligationsDueThisMonth),
    obligationsOverdue: value(health.obligationsOverdue),
    evidenceCoverage: value(health.evidenceCoverage),
    risksOpen: value(health.risksOpen),
    riskExposure: value(health.riskExposure),
    claimReadiness: value(health.claimReadiness),
  };
}

/** Indicators whose calculation does not exist for live tenants in this release. */
const LIVE_UNCOMPUTED = {
  evidenceCoverage: NOT_CALCULATED,
  risksOpen: DEFERRED,
  riskExposure: DEFERRED,
  claimReadiness: DEFERRED,
} as const;

/** Every obligation-count indicator in one failure state. */
export function liveIndicatorsInState(state: "unavailable" | "incomplete"): ContractIndicators {
  const s: Indicator = { state };
  return { obligationsTotal: s, obligationsDueThisMonth: s, obligationsOverdue: s, ...LIVE_UNCOMPUTED };
}

export type OperationalObligationRow = {
  contract_id: string;
  due_date_normalized: string | null;
  due_rule_normalized?: string | null;
  frequency?: string | null;
};
export type IndicatorContract = { id: string; startDate?: string | null; endDate?: string | null };

/**
 * Count operational obligations per contract. `rows` must already be the
 * approved + active obligations of the caller's organization; contracts
 * with no rows get real zeros. Due dates come from the shared operational
 * schedule (explicit date, or the oldest unsettled cycle of a recurring rule).
 */
export function liveIndicatorsFromRows(
  contracts: IndicatorContract[],
  rows: OperationalObligationRow[],
  clock: { today: CalendarDate; endOfMonth: CalendarDate },
): Map<string, ContractIndicators> {
  const byId = new Map(contracts.map((c) => [c.id, c]));
  const counts = new Map(contracts.map((c) => [c.id, { total: 0, dueThisMonth: 0, overdue: 0 }]));
  for (const r of rows) {
    const c = counts.get(r.contract_id);
    if (!c) continue;
    c.total++;
    const k = byId.get(r.contract_id);
    const due = operationalDueDate(obligationSchedule({
      dueDateNormalized: r.due_date_normalized, dueRuleNormalized: r.due_rule_normalized, frequency: r.frequency,
      contractStart: k?.startDate ?? null, contractEnd: k?.endDate ?? null, today: clock.today,
    }));
    const d = classifyDeadline({ today: clock.today, dueDate: due });
    if (d.window === "overdue") c.overdue++;
    else if (d.daysUntilDue != null && due && due <= clock.endOfMonth) c.dueThisMonth++;
  }
  return new Map([...counts].map(([id, c]) => [id, {
    obligationsTotal: value(c.total),
    obligationsDueThisMonth: value(c.dueThisMonth),
    obligationsOverdue: value(c.overdue),
    ...LIVE_UNCOMPUTED,
  }]));
}
