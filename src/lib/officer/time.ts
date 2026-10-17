/**
 * Deterministic time for the Contract Officer.
 *
 * The model is NEVER asked to do date arithmetic. "Due in 2 days",
 * "overdue by 5 days", "this week" and "end of month" are computed here,
 * server-side, in the organization's own IANA timezone — then handed to the
 * model as already-resolved facts.
 *
 * Pure: no I/O, no framework. `now` is injectable so tests are stable.
 */

/** A calendar day in a specific zone, as YYYY-MM-DD. */
export type CalendarDate = string;

const MS_PER_DAY = 86_400_000;

/** Valid IANA zone? Unknown zones must fail loudly, never silently drift. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Organization zone, falling back to UTC rather than to a hardcoded region. */
export function resolveTimeZone(orgTimeZone: string | null | undefined): string {
  return orgTimeZone && isValidTimeZone(orgTimeZone) ? orgTimeZone : "UTC";
}

/** The local calendar date in `timeZone` at instant `now`. */
export function localDate(now: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Local wall-clock time as HH:mm in `timeZone`. */
export function localTime(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
}

/** UTC midnight of a YYYY-MM-DD label — a stable anchor for day counting. */
function dayAnchor(date: CalendarDate): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

/**
 * Whole calendar days from `from` to `to` in the same zone.
 * Positive = in the future, negative = past, 0 = today. Because both sides
 * are already zone-local calendar labels, DST never shifts the count.
 */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((dayAnchor(to) - dayAnchor(from)) / MS_PER_DAY);
}

/** Shift a calendar date by whole days. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return new Date(dayAnchor(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export type DeadlineWindow =
  | "overdue"
  | "today"
  | "next_3_days"
  | "this_week"
  | "monitoring"
  | "no_due_date";

/**
 * Classify a due date relative to today. Thresholds are parameters, not
 * constants, so they can become organization preferences without touching
 * this logic.
 */
export function classifyDeadline(opts: {
  today: CalendarDate;
  dueDate: CalendarDate | null;
  nearDays?: number;
  weekDays?: number;
}): { window: DeadlineWindow; daysUntilDue: number | null; daysOverdue: number | null } {
  const { today, dueDate, nearDays = 3, weekDays = 7 } = opts;
  if (!dueDate) return { window: "no_due_date", daysUntilDue: null, daysOverdue: null };

  const delta = daysBetween(today, dueDate);
  if (delta < 0) return { window: "overdue", daysUntilDue: delta, daysOverdue: -delta };
  if (delta === 0) return { window: "today", daysUntilDue: 0, daysOverdue: 0 };
  if (delta <= nearDays) return { window: "next_3_days", daysUntilDue: delta, daysOverdue: null };
  if (delta <= weekDays) return { window: "this_week", daysUntilDue: delta, daysOverdue: null };
  return { window: "monitoring", daysUntilDue: delta, daysOverdue: null };
}

/** Last calendar day of the month containing `date`. */
export function endOfMonth(date: CalendarDate): CalendarDate {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m ?? 1, 0)).toISOString().slice(0, 10);
}

/**
 * Next occurrence of a monthly "day N" rule, on or after `today`.
 * Clamps to the last day of short months (day 31 in April → 30 April).
 */
export function nextMonthlyOccurrence(today: CalendarDate, dayOfMonth: number): CalendarDate {
  const [y, m] = today.split("-").map(Number);
  const clamp = (year: number, month1: number) => {
    const last = Number(endOfMonth(`${year}-${String(month1).padStart(2, "0")}-01`).slice(8, 10));
    return `${year}-${String(month1).padStart(2, "0")}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`;
  };
  const thisMonth = clamp(y, m);
  if (daysBetween(today, thisMonth) >= 0) return thisMonth;
  return m === 12 ? clamp(y + 1, 1) : clamp(y, m + 1);
}

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
}

/**
 * The UTC instant of local midnight at the start of `date` in `timeZone`.
 * Two passes so a DST transition between the guess and the answer is
 * absorbed — "since yesterday" must never be off by an hour.
 */
export function zonedStartOfDayIso(date: CalendarDate, timeZone: string): string {
  const label = dayAnchor(date);
  const first = label - zoneOffsetMs(label, timeZone);
  return new Date(label - zoneOffsetMs(first, timeZone)).toISOString();
}

/** The resolved clock handed to the Officer — already computed, never guessed. */
export type OfficerClock = {
  timeZone: string;
  /** ISO instant the answer was computed at */
  nowIso: string;
  today: CalendarDate;
  yesterday: CalendarDate;
  localTime: string;
  endOfMonth: CalendarDate;
  in3Days: CalendarDate;
  in7Days: CalendarDate;
  /** local-midnight instants for activity windows */
  startOfTodayIso: string;
  startOfYesterdayIso: string;
  startOfLast7DaysIso: string;
};

export function buildClock(now: Date, orgTimeZone: string | null | undefined): OfficerClock {
  const timeZone = resolveTimeZone(orgTimeZone);
  const today = localDate(now, timeZone);
  const yesterday = addDays(today, -1);
  return {
    timeZone,
    nowIso: now.toISOString(),
    today,
    yesterday,
    localTime: localTime(now, timeZone),
    endOfMonth: endOfMonth(today),
    in3Days: addDays(today, 3),
    in7Days: addDays(today, 7),
    startOfTodayIso: zonedStartOfDayIso(today, timeZone),
    startOfYesterdayIso: zonedStartOfDayIso(yesterday, timeZone),
    startOfLast7DaysIso: zonedStartOfDayIso(addDays(today, -7), timeZone),
  };
}
