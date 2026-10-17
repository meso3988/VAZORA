// Phase 4A CP1 — authority matrix, action classification and deterministic
// time. Pure unit tests: no DB, no LLM, no network.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-authority.test.ts

import {
  ACTION_CAPABILITY,
  ACTION_CLASS,
  ROLE_CAPABILITIES,
  actionRequiresApproval,
  authorizeAction,
  classifyAction,
  roleHasCapability,
} from "../../src/lib/officer/authority";
import { canTransition } from "../../src/lib/officer/actions";
import {
  addDays,
  buildClock,
  classifyDeadline,
  daysBetween,
  endOfMonth,
  isValidTimeZone,
  localDate,
  nextMonthlyOccurrence,
  resolveTimeZone,
} from "../../src/lib/officer/time";
import { outranks, truthRank } from "../../src/domain/officer";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} — ${detail}`); }
}

// ===== A. authority matrix =================================================
check("a1-owner-can-approve", roleHasCapability("owner", "officer.action.approve"));
check("a2-admin-can-approve", roleHasCapability("admin", "officer.action.approve"));
check("a3-member-cannot-approve", !roleHasCapability("member", "officer.action.approve"));
check("a4-member-cannot-override-evidence", !roleHasCapability("member", "evidence.override"));
check("a5-member-cannot-dismiss-gap", !roleHasCapability("member", "gap.dismiss"));
check("a6-member-can-converse", roleHasCapability("member", "officer.converse"));
check("a7-null-role-denied", !roleHasCapability(null, "officer.read"));
check("a8-unknown-role-denied", !roleHasCapability("ghost" as never, "officer.read"));
// External communication is granted to NOBODY in Phase 4A.
check("a9-external-comms-ungranted",
  Object.values(ROLE_CAPABILITIES).every((caps) => !caps.includes("external.communicate")));
// Planned roles exist and stay conservative.
check("a10-approver-cannot-assign", !roleHasCapability("approver", "obligation.assign"));
check("a11-contributor-read-only-ish",
  roleHasCapability("contributor", "officer.read") && !roleHasCapability("contributor", "officer.action.approve"));
check("a12-finance-cannot-activate", !roleHasCapability("finance", "contract.activate"));

// ===== B. action classification ============================================
check("b1-note-is-internal", classifyAction("officer.note") === "SAFE_INTERNAL_WRITE");
check("b2-assign-needs-approval", classifyAction("obligation.assign_owner") === "APPROVAL_REQUIRED");
check("b3-override-needs-approval", classifyAction("evidence.human_override") === "APPROVAL_REQUIRED");
check("b4-dismiss-gap-needs-approval", classifyAction("evidence.dismiss_gap") === "APPROVAL_REQUIRED");
check("b5-unknown-is-strictest", classifyAction("something.invented") === "APPROVAL_REQUIRED");
check("b6-requires-approval-helper", actionRequiresApproval("contract.activate_change"));
check("b7-every-action-has-capability",
  Object.keys(ACTION_CLASS).every((a) => ACTION_CAPABILITY[a] != null),
  Object.keys(ACTION_CLASS).filter((a) => !ACTION_CAPABILITY[a]).join(","));

// ===== C. action authorization =============================================
check("c1-owner-may-assign", authorizeAction("owner", "obligation.assign_owner").allowed);
{
  const r = authorizeAction("member", "obligation.assign_owner");
  check("c2-member-may-not-assign", !r.allowed && r.reason === "missing_capability");
}
{
  const r = authorizeAction("owner", "external.send_message");
  check("c3-external-blocked-even-for-owner", !r.allowed && r.reason === "not_available_yet",
    JSON.stringify(r));
}
{
  const r = authorizeAction("owner", "delete.everything");
  check("c4-unknown-action-refused", !r.allowed && r.reason === "unknown_action");
}
{
  const r = authorizeAction(null, "officer.note");
  check("c5-no-role-refused", !r.allowed);
}

// ===== D. action state machine =============================================
check("d1-waiting-to-approved", canTransition("waiting_for_approval", "approved"));
check("d2-approved-to-completed", canTransition("approved", "completed"));
check("d3-rejected-is-terminal", !canTransition("rejected", "approved"));
check("d4-completed-is-terminal", !canTransition("completed", "executing"));
check("d5-cannot-skip-to-completed-from-waiting", !canTransition("waiting_for_approval", "completed"));
check("d6-cannot-unreject", !canTransition("rejected", "cancelled"));

// ===== E. deterministic time ===============================================
check("e1-valid-zone", isValidTimeZone("Asia/Riyadh") && isValidTimeZone("Europe/London"));
check("e2-invalid-zone", !isValidTimeZone("Mars/Olympus") && !isValidTimeZone(""));
check("e3-no-hardcoded-region", resolveTimeZone(null) === "UTC" && resolveTimeZone("  ") === "UTC");
check("e4-org-zone-honored", resolveTimeZone("Asia/Riyadh") === "Asia/Riyadh");

{
  // 2025-11-30T22:30Z is already 2025-12-01 in Riyadh (+03).
  const instant = new Date("2025-11-30T22:30:00Z");
  check("e5-zone-shifts-calendar-day",
    localDate(instant, "Asia/Riyadh") === "2025-12-01" && localDate(instant, "UTC") === "2025-11-30",
    `${localDate(instant, "Asia/Riyadh")} / ${localDate(instant, "UTC")}`);
}
check("e6-days-between", daysBetween("2025-11-28", "2025-11-30") === 2);
check("e7-days-between-negative", daysBetween("2025-12-02", "2025-11-30") === -2);
// DST boundary in Europe/London (26 Oct 2025) must not corrupt the count.
check("e8-dst-safe", daysBetween("2025-10-25", "2025-10-27") === 2);
check("e9-add-days-month-roll", addDays("2025-11-30", 1) === "2025-12-01");
check("e10-end-of-month-feb-leap", endOfMonth("2028-02-10") === "2028-02-29", endOfMonth("2028-02-10"));
check("e11-end-of-month-feb-common", endOfMonth("2025-02-10") === "2025-02-28");

{
  const d = classifyDeadline({ today: "2025-11-28", dueDate: "2025-11-30" });
  check("e12-due-in-2-days", d.window === "next_3_days" && d.daysUntilDue === 2, JSON.stringify(d));
}
{
  const d = classifyDeadline({ today: "2025-11-28", dueDate: "2025-11-23" });
  check("e13-overdue-5", d.window === "overdue" && d.daysOverdue === 5, JSON.stringify(d));
}
{
  const d = classifyDeadline({ today: "2025-11-28", dueDate: "2025-11-28" });
  check("e14-today", d.window === "today" && d.daysUntilDue === 0);
}
{
  const d = classifyDeadline({ today: "2025-11-28", dueDate: "2025-12-03" });
  check("e15-this-week", d.window === "this_week" && d.daysUntilDue === 5, JSON.stringify(d));
}
{
  const d = classifyDeadline({ today: "2025-11-28", dueDate: null });
  check("e16-no-due-date", d.window === "no_due_date" && d.daysUntilDue === null);
}
{
  const d = classifyDeadline({ today: "2025-11-28", dueDate: "2026-03-01" });
  check("e17-monitoring", d.window === "monitoring");
}
check("e18-monthly-next-occurrence", nextMonthlyOccurrence("2025-11-28", 5) === "2025-12-05",
  nextMonthlyOccurrence("2025-11-28", 5));
check("e19-monthly-same-month", nextMonthlyOccurrence("2025-11-01", 5) === "2025-11-05");
// Day 31 must clamp, never roll into the next month.
check("e20-monthly-clamps-short-month", nextMonthlyOccurrence("2026-04-10", 31) === "2026-04-30",
  nextMonthlyOccurrence("2026-04-10", 31));

{
  const clock = buildClock(new Date("2025-11-30T22:30:00Z"), "Asia/Riyadh");
  check("e21-clock-today", clock.today === "2025-12-01", clock.today);
  check("e22-clock-windows", clock.in3Days === "2025-12-04" && clock.in7Days === "2025-12-08");
  check("e23-clock-eom", clock.endOfMonth === "2025-12-31", clock.endOfMonth);
  check("e24-clock-local-time", clock.localTime === "01:30", clock.localTime);
}

// ===== F. truth hierarchy ==================================================
check("f1-system-state-outranks-memory", outranks("approved_system_state", "confirmed_memory"));
check("f2-human-decision-outranks-inference", outranks("human_decision", "model_inference"));
check("f3-memory-never-outranks-system", !outranks("confirmed_memory", "approved_system_state"));
check("f4-inference-is-lowest", truthRank("model_inference") === 4);
check("f5-ties-do-not-displace", !outranks("human_decision", "human_decision"));

console.log(`\nofficer-authority tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
