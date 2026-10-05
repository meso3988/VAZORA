// Recurring due dates — one operational schedule for every surface.
// Pure tests over src/lib/officer/schedule.ts plus the two pure consumers
// (obligation states for the list/overview, indicators for the KPIs); the
// Officer tools and the sweep are checked to call the same function.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/recurrence.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { liveIndicatorsFromRows } from "../../src/domain/indicators";
import { obligationStates } from "../../src/domain/obligation-state";
import { obligationSchedule, operationalDueDate, parseRecurrence } from "../../src/lib/officer/schedule";
import { buildClock, classifyDeadline } from "../../src/lib/officer/time";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const base = { dueDateNormalized: null, dueRuleNormalized: "monthly_day_5", frequency: "monthly", contractStart: "2026-09-01", contractEnd: "2027-08-31" };
const sched = (today: string, extra: Partial<Parameters<typeof obligationSchedule>[0]> = {}) => obligationSchedule({ ...base, today, ...extra });
const win = (today: string, extra: Partial<Parameters<typeof obligationSchedule>[0]> = {}) =>
  classifyDeadline({ today, dueDate: operationalDueDate(sched(today, extra)) });
const rec = (s: ReturnType<typeof obligationSchedule>) => (s.kind === "recurring" ? s : null);

async function main() {
  // Root cause: extraction stores the rule but never a date, and every
  // consumer read due_date_normalized only.
  const ingest = src("src/lib/ingestion/run.ts") + src("src/lib/ingestion/harden.ts");
  check("root cause: ingestion writes due_rule_normalized and never due_date_normalized", ingest.includes("due_rule_normalized") && !/due_date_normalized\s*:/.test(ingest));

  // ---- cycle position ----
  const before = rec(sched("2026-09-03"))!;
  check("before the first cycle day: nothing due yet, next cycle is the 5th", before.firstUnsettled === null && before.nextDue === "2026-09-05" && win("2026-09-03").window === "next_3_days");
  const on = rec(sched("2026-09-05"))!;
  check("on the cycle day: due today", on.firstUnsettled === "2026-09-05" && win("2026-09-05").window === "today" && on.unsettledPastCount === 0);
  const after = rec(sched("2026-09-08"))!;
  const wAfter = win("2026-09-08");
  check("after the cycle day with no recorded completion: overdue 3 days, next cycle still listed",
    after.firstUnsettled === "2026-09-05" && wAfter.window === "overdue" && wAfter.daysOverdue === 3 && after.nextDue === "2026-10-05");
  const month = rec(sched("2026-10-07"))!;
  const wMonth = win("2026-10-07");
  check("a month later the unsettled cycle is NOT replaced by the next one",
    month.firstUnsettled === "2026-09-05" && wMonth.daysOverdue === 32 && month.unsettledPastCount === 2 && month.nextDue === "2026-11-05",
    JSON.stringify(month));
  check("re-evaluation is stable (same inputs → same oldest unsettled cycle)", JSON.stringify(sched("2026-10-07")) === JSON.stringify(sched("2026-10-07")));

  // ---- settlement (injected — no table records it yet) ----
  const settled1 = rec(sched("2026-09-08", { settledCycles: ["2026-09-05"] }))!;
  check("settled cycle → the next cycle becomes the operational date", settled1.firstUnsettled === null && settled1.dueDate === "2026-10-05");
  const settledOld = rec(sched("2026-10-07", { settledCycles: ["2026-09-05"] }))!;
  check("settling an older cycle does not settle a later one", settledOld.firstUnsettled === "2026-10-05" && settledOld.unsettledPastCount === 1);

  // ---- contract period ----
  const mid = rec(sched("2026-09-20", { contractStart: "2026-09-10" }))!;
  check("cycle before the contract start is excluded", mid.firstUnsettled === null && mid.nextDue === "2026-10-05");
  const ended = rec(sched("2026-12-20", { contractEnd: "2026-11-30" }))!;
  check("after the contract end: unsettled cycles remain due, no new cycles", ended.firstUnsettled === "2026-09-05" && ended.unsettledPastCount === 3 && ended.nextDue === null);

  // ---- calendar edges ----
  const d31 = rec(obligationSchedule({ ...base, dueRuleNormalized: "monthly_day_31", contractStart: "2027-01-01", contractEnd: null, today: "2027-02-10" }))!;
  check("day 31 clamps to the month's last day (Jan 31 overdue, next Feb 28)", d31.firstUnsettled === "2027-01-31" && d31.nextDue === "2027-02-28");
  const leap = rec(obligationSchedule({ ...base, dueRuleNormalized: "monthly_end", contractStart: "2028-02-01", contractEnd: null, today: "2028-02-10" }))!;
  check("monthly_end in a leap February → Feb 29", leap.nextDue === "2028-02-29");
  check("day bounds: monthly_day_0 / monthly_day_32 are not supported", parseRecurrence("monthly_day_0") === null && parseRecurrence("monthly_day_32") === null);

  // ---- organization time zone ----
  const now = new Date("2026-10-04T22:30:00Z");
  const riyadh = buildClock(now, "Asia/Riyadh").today;
  const utc = buildClock(now, "UTC").today;
  check("org time zone decides 'today': the 5th is due today in Riyadh, tomorrow in UTC",
    win(riyadh, { contractStart: "2026-10-01" }).window === "today" && win(utc, { contractStart: "2026-10-01" }).window === "next_3_days", `${riyadh} vs ${utc}`);

  // ---- insufficient / unsupported ----
  const k = (x: ReturnType<typeof obligationSchedule>) => (x.kind === "needs_schedule" ? x.reason : x.kind);
  check("no contract start → needs schedule (no_schedule_start)", k(sched("2026-10-07", { contractStart: null })) === "no_schedule_start");
  check("event-based rule text → needs schedule (unsupported_rule)", k(sched("2026-10-07", { dueRuleNormalized: "Submit with each monthly invoice." })) === "unsupported_rule");
  check("relative-days rule (needs a trigger event) → unsupported_rule", k(sched("2026-10-07", { dueRuleNormalized: "relative_days_10" })) === "unsupported_rule");
  check("frequency without a due day → rule_without_due_day", k(sched("2026-10-07", { dueRuleNormalized: null })) === "rule_without_due_day");
  check("no temporal rule at all → none", k(sched("2026-10-07", { dueRuleNormalized: null, frequency: null })) === "none");
  check("explicit due date wins over the rule (dated)", k(sched("2026-10-07", { dueDateNormalized: "2026-09-29" })) === "dated");

  // ---- one schedule, every pure consumer ----
  const ob = { id: "o1", dueDate: "", lifecycle: "active" as const, dueRuleNormalized: "monthly_day_5", frequencyRaw: "monthly" };
  const st = obligationStates([ob], [], "2026-10-07", { startDate: "2026-09-01", endDate: "2027-08-31" }).get("o1")!;
  const ind = liveIndicatorsFromRows([{ id: "c1", startDate: "2026-09-01", endDate: "2027-08-31" }],
    [{ contract_id: "c1", due_date_normalized: null, due_rule_normalized: "monthly_day_5", frequency: "monthly" }],
    { today: "2026-10-07", endOfMonth: "2026-10-31" }).get("c1")!;
  check("list/overview state and KPI agree: overdue on the same cycle",
    st.deadline.window === "overdue" && "dueDate" in st.deadline && st.deadline.dueDate === "2026-09-05" && ind.obligationsOverdue.state === "value" && (ind.obligationsOverdue as { value: number }).value === 1);
  const ns = obligationStates([{ ...ob, dueRuleNormalized: "Submit with each monthly invoice." }], [], "2026-10-07", { startDate: "2026-09-01" }).get("o1")!;
  check("unsupported rule is shown as needs_schedule in the state (not 'no due date')", ns.deadline.window === "needs_schedule");
  const tools = src("src/lib/officer/tools.ts");
  const sweep = src("src/lib/officer/sweep.ts");
  check("Officer tools derive deadlines from the same schedule", tools.includes("obligationSchedule({") && tools.includes("due_date_operational"));
  check("sweep derives deadlines from the same schedule", sweep.includes("obligationSchedule({") && sweep.includes("start_date, end_date"));

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
