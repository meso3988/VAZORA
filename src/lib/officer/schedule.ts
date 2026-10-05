/**
 * Operational due date of an obligation — the one place every surface
 * (obligation list, overview, Officer tools, sweep, indicators) asks.
 *
 *   dated          an explicit due_date_normalized: used as-is
 *   recurring      a supported calendar rule (monthly_day_N, monthly_end)
 *                  scheduled from the contract start, inside the contract
 *                  period, in the organization's calendar. Every cycle due on
 *                  or before today stays DUE until a settlement is recorded
 *                  for that cycle — a new month never hides an unsettled one.
 *   needs_schedule a temporal obligation whose schedule cannot be derived
 *                  (no contract start, rule without a day, event-based or
 *                  unsupported rule) — stated, never shown as "no deadline"
 *   none           no temporal rule at all
 *
 * Pure; reuses the deterministic calendar helpers in time.ts.
 */

import { daysBetween, endOfMonth, type CalendarDate } from "@/lib/officer/time";

export type RecurrenceRule = { kind: "monthly_day"; day: number } | { kind: "monthly_end" };
export type NeedsScheduleReason = "no_schedule_start" | "unsupported_rule" | "rule_without_due_day";

export type ObligationSchedule =
  | { kind: "dated"; dueDate: CalendarDate }
  | {
      kind: "recurring";
      rule: string;
      /** oldest cycle due on or before today with no recorded settlement */
      firstUnsettled: CalendarDate | null;
      /** unsettled cycles strictly before today */
      unsettledPastCount: number;
      /** next cycle after today inside the contract period, if any */
      nextDue: CalendarDate | null;
      /** the operational date: the unsettled cycle, else the next one */
      dueDate: CalendarDate | null;
    }
  | { kind: "needs_schedule"; reason: NeedsScheduleReason }
  | { kind: "none" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const valid = (d: string | null | undefined): d is CalendarDate => !!d && ISO.test(d) && !Number.isNaN(Date.parse(d));

/** Only rules whose calendar meaning is unambiguous are scheduled. */
export function parseRecurrence(rule: string | null | undefined): RecurrenceRule | null {
  if (!rule) return null;
  const r = rule.trim().toLowerCase();
  if (r === "monthly_end") return { kind: "monthly_end" };
  const m = r.match(/^monthly_day_(\d{1,2})$/);
  if (m) {
    const day = Number(m[1]);
    return day >= 1 && day <= 31 ? { kind: "monthly_day", day } : null;
  }
  return null;
}

function occurrenceIn(year: number, month1: number, rule: RecurrenceRule): CalendarDate {
  const first = `${year}-${String(month1).padStart(2, "0")}-01`;
  const last = endOfMonth(first);
  if (rule.kind === "monthly_end") return last;
  const lastDay = Number(last.slice(8, 10));
  return `${first.slice(0, 8)}${String(Math.min(rule.day, lastDay)).padStart(2, "0")}`;
}

export function obligationSchedule(opts: {
  dueDateNormalized: string | null | undefined;
  dueRuleNormalized: string | null | undefined;
  frequency: string | null | undefined;
  contractStart: string | null | undefined;
  contractEnd: string | null | undefined;
  today: CalendarDate;
  /** cycle due dates with a recorded settlement (none can be recorded yet) */
  settledCycles?: readonly CalendarDate[];
}): ObligationSchedule {
  if (valid(opts.dueDateNormalized)) return { kind: "dated", dueDate: opts.dueDateNormalized };

  const rule = parseRecurrence(opts.dueRuleNormalized);
  if (!rule) {
    if (opts.dueRuleNormalized) return { kind: "needs_schedule", reason: "unsupported_rule" };
    if (opts.frequency) return { kind: "needs_schedule", reason: "rule_without_due_day" };
    return { kind: "none" };
  }
  if (!valid(opts.contractStart)) return { kind: "needs_schedule", reason: "no_schedule_start" };

  const start = opts.contractStart;
  const end = valid(opts.contractEnd) ? opts.contractEnd : null;
  const settled = new Set(opts.settledCycles ?? []);
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(5, 7));
  let firstUnsettled: CalendarDate | null = null;
  let unsettledPastCount = 0;
  let nextDue: CalendarDate | null = null;
  // Bounded walk: at most 50 years of monthly cycles.
  for (let i = 0; i < 600; i++) {
    const occ = occurrenceIn(year, month, rule);
    month = month === 12 ? 1 : month + 1;
    if (month === 1) year++;
    if (daysBetween(start, occ) < 0) continue; // before the contract starts
    if (end && daysBetween(occ, end) < 0) break; // after the contract ends
    if (daysBetween(occ, opts.today) >= 0) {
      if (!settled.has(occ)) {
        firstUnsettled ??= occ;
        if (occ !== opts.today) unsettledPastCount++;
      }
      continue;
    }
    if (!settled.has(occ)) { nextDue = occ; break; }
  }
  return { kind: "recurring", rule: opts.dueRuleNormalized!.trim(), firstUnsettled, unsettledPastCount, nextDue, dueDate: firstUnsettled ?? nextDue };
}

/** The date deadline classification runs on (null = no operational date). */
export const operationalDueDate = (s: ObligationSchedule): CalendarDate | null =>
  s.kind === "dated" ? s.dueDate : s.kind === "recurring" ? s.dueDate : null;
