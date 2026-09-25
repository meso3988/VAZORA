// Phase 4A CP3 — timezone + detector determinism. Pure: no DB, no model.
// Critical date arithmetic must be identical every run, across UTC, a
// non-DST offset zone, and a DST zone.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-timezone.test.ts

import {
  DEFAULT_THRESHOLDS,
  detectForContract,
  detectForObligation,
  detectWaitingApprovals,
  type ObligationFacts,
  type RequirementFacts,
} from "../../src/lib/officer/detectors";
import { addDays, buildClock, endOfMonth, localDate, nextMonthlyOccurrence, zonedStartOfDayIso } from "../../src/lib/officer/time";
import type { EffectiveEvidenceStatus } from "../../src/domain/evidence";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} — ${detail}`); }
}

/** Read one deterministic supporting fact without loosening types. */
const fact = (f: { supportingFacts: Record<string, unknown> } | undefined, key: string): unknown =>
  f?.supportingFacts[key];

const eff = (over: Partial<EffectiveEvidenceStatus> = {}): EffectiveEvidenceStatus => ({
  operational: "verified", latest: "verified", priorStateInForce: false,
  discrepancyStatus: null, source: "verification_run", ...over,
});

const req = (name: string, over: Partial<RequirementFacts> = {}): RequirementFacts => ({
  requirementId: `req-${name}`, name, required: true, effective: eff(),
  gap: null, pendingDiscrepancyId: null, ...over,
});

const obligation = (over: Partial<ObligationFacts> = {}): ObligationFacts => ({
  obligationId: "ob-1", contractId: "c-1", contractNumber: "TZ-001", title: "Monthly report",
  dueDate: null, dueRuleRaw: "monthly", clauseId: "cl-1",
  hasFinancialCondition: false, externalDependency: null, requiresExternalAcknowledgement: false,
  ownerAssigned: true, suggestedOwnerRole: null, requirements: [req("report")], ...over,
});

// ===== A. three zones resolve "today" independently ========================
{
  // 2026-03-28T22:30Z — already the 29th in Riyadh (+03), still the 28th in
  // London (GMT, the night BST begins) and in UTC.
  const instant = new Date("2026-03-28T22:30:00Z");
  const utc = buildClock(instant, "UTC");
  const riyadh = buildClock(instant, "Asia/Riyadh");
  const london = buildClock(instant, "Europe/London");
  check("a1-utc-today", utc.today === "2026-03-28", utc.today);
  check("a2-riyadh-today", riyadh.today === "2026-03-29", riyadh.today);
  check("a3-london-today", london.today === "2026-03-28", london.today);
  check("a4-zones-differ", riyadh.today !== utc.today);
  check("a5-local-times",
    utc.localTime === "22:30" && riyadh.localTime === "01:30" && london.localTime === "22:30",
    `${utc.localTime} ${riyadh.localTime} ${london.localTime}`);
}

// ===== B. DST transitions never shift a day count ==========================
{
  // Europe/London springs forward 2026-03-29 and falls back 2026-10-25.
  check("b1-spring-forward", addDays("2026-03-28", 2) === "2026-03-30");
  check("b2-fall-back", addDays("2026-10-24", 2) === "2026-10-26");
  const springClock = buildClock(new Date("2026-03-28T12:00:00Z"), "Europe/London");
  check("b3-clock-windows-across-dst",
    springClock.in3Days === "2026-03-31" && springClock.in7Days === "2026-04-04",
    `${springClock.in3Days} / ${springClock.in7Days}`);
  // A US DST zone too, for a different transition date.
  const ny = buildClock(new Date("2026-03-08T12:00:00Z"), "America/New_York");
  check("b4-ny-dst-day", ny.today === "2026-03-08", ny.today);
  check("b5-ny-windows", ny.in7Days === "2026-03-15", ny.in7Days);
}

// ===== C. month ends and monthly recurrence ================================
{
  check("c1-eom-30", endOfMonth("2026-04-15") === "2026-04-30");
  check("c2-eom-31", endOfMonth("2026-07-15") === "2026-07-31");
  check("c3-eom-feb-common", endOfMonth("2026-02-01") === "2026-02-28");
  check("c4-eom-feb-leap", endOfMonth("2028-02-01") === "2028-02-29");
  check("c5-monthly-same-month", nextMonthlyOccurrence("2026-05-01", 5) === "2026-05-05");
  check("c6-monthly-rolls", nextMonthlyOccurrence("2026-05-06", 5) === "2026-06-05");
  check("c7-monthly-year-roll", nextMonthlyOccurrence("2026-12-06", 5) === "2027-01-05");
  check("c8-monthly-clamps-feb", nextMonthlyOccurrence("2026-02-10", 31) === "2026-02-28",
    nextMonthlyOccurrence("2026-02-10", 31));
  check("c9-eom-clock", buildClock(new Date("2026-02-10T09:00:00Z"), "Asia/Riyadh").endOfMonth === "2026-02-28");
}

// ===== D. detector determinism against a fixed "today" =====================
const TODAY = "2026-05-20";

{
  // due tomorrow + evidence missing
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, 1),
      requirements: [req("report", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
  });
  const due = f.find((x) => x.kind === "due_soon");
  check("d1-due-tomorrow-bucket", due?.timeBucket === "next_3_days" && due?.severity === "high",
    JSON.stringify([due?.timeBucket, due?.severity]));
  check("d2-days-until-due-exact", fact(due, "days_until_due") === 1);
  check("d3-missing-evidence-raised", f.some((x) => x.kind === "missing_required_evidence"));
}

{
  // due in 5 days + evidence complete → silence
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({ dueDate: addDays(TODAY, 5) }),
  });
  check("d4-healthy-future-silent", f.length === 0, JSON.stringify(f.map((x) => x.kind)));
}

{
  // overdue 6 days + missing → critical
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, -6),
      requirements: [req("report", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
  });
  const od = f.find((x) => x.kind === "overdue");
  check("d5-overdue-critical", od?.severity === "critical" && od?.timeBucket === "critical");
  check("d6-days-overdue-exact", fact(od, "days_overdue") === 6);
  check("d7-overdue-cites-clause", !!od?.citations.some((c) => c.target === "clause"));
}

{
  // overdue but fully proven → high, not critical
  const f = detectForObligation({ today: TODAY, obligation: obligation({ dueDate: addDays(TODAY, -2) }) });
  const od = f.find((x) => x.kind === "overdue");
  check("d8-overdue-proven-high", od?.severity === "high", od?.severity);
}

{
  // due today, evidence complete → informational, no noise beyond that
  const f = detectForObligation({ today: TODAY, obligation: obligation({ dueDate: TODAY }) });
  check("d9-due-today-informational",
    f.length === 1 && f[0].kind === "due_today" && f[0].severity === "informational",
    JSON.stringify(f.map((x) => [x.kind, x.severity])));
}

{
  // pending discrepancy: review need only, operational state untouched
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, 9),
      requirements: [req("signed report", {
        effective: eff({ operational: "verified", latest: "needs_human_review", priorStateInForce: true, discrepancyStatus: "pending" }),
        pendingDiscrepancyId: "disc-1",
      })],
    }),
  });
  check("d10-discrepancy-only", f.length === 1 && f[0].kind === "verification_discrepancy",
    JSON.stringify(f.map((x) => x.kind)));
  check("d11-discrepancy-not-operational-failure",
    f[0].severity === "medium" && fact(f[0], "operational_status") === "verified");
}

{
  // external acknowledgement pending → not blamed on internal work
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, 2),
      requiresExternalAcknowledgement: true, externalDependency: "Client PMO",
      requirements: [req("client acknowledgement", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
  });
  check("d12-external-dependency", f.some((x) => x.kind === "external_dependency_pending"));
  check("d13-no-internal-blame", !f.some((x) => x.kind === "missing_required_evidence"));
}

{
  // unassigned
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({ dueDate: addDays(TODAY, 10), ownerAssigned: false, suggestedOwnerRole: "Project Manager" }),
  });
  const un = f.find((x) => x.kind === "unassigned_obligation");
  check("d14-unassigned", !!un && un.recommendedActionType === "obligation.assign_owner");
  check("d15-suggested-role-not-auto-assigned",
    fact(un, "suggested_role") === "Project Manager");
}

{
  // financial condition is FLAGGED, never quantified
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, -1), hasFinancialCondition: true,
      requirements: [req("report", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
  });
  const od = f.find((x) => x.kind === "overdue")!;
  check("d16-financial-condition-flagged",
    od.priorityReason.includes("financial_condition_present") &&
    fact(od, "financial_condition_present") === true);
  // A flagged condition must never become a quantified exposure. Dates are
  // fine; currency, thousands-separated figures and exposure fields are not.
  const blob = `${od.title} ${od.detail} ${JSON.stringify(od.supportingFacts)}`;
  check("d17-no-amount-anywhere",
    !/(SAR|USD|EUR|ريال|\$)\s?[\d,.]+/i.test(blob) &&
    !/\d{1,3}(,\d{3})+/.test(blob) &&
    !/"(amount|exposure|estimated_loss|penalty_value)"/.test(blob),
    `${od.title} · ${od.detail}`);
}

{
  // no due date at all → no deadline claim invented
  const f = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: null,
      requirements: [req("report", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
  });
  check("d18-no-due-date-no-deadline-finding",
    !f.some((x) => ["due_soon", "due_today", "overdue"].includes(x.kind)),
    JSON.stringify(f.map((x) => x.kind)));
  check("d19-still-reports-missing-evidence", f.some((x) => x.kind === "missing_required_evidence"));
}

// ===== E. dedupe keys are stable across runs ===============================
{
  const build = () => detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, 1),
      requirements: [req("report", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
  }).map((x) => x.dedupeKey).sort();
  check("e1-dedupe-keys-stable", JSON.stringify(build()) === JSON.stringify(build()));
  // The key must not embed a timestamp, or every sweep would create a new row.
  check("e2-dedupe-keys-timeless", build().every((k) => !/\d{4}-\d{2}-\d{2}T/.test(k)), build().join(","));
}

// ===== F. contract expiry + approvals ======================================
{
  const soon = detectForContract({
    today: TODAY,
    contract: { contractId: "c-1", contractNumber: "TZ-001", title: "Contract", endDate: addDays(TODAY, 5), status: "active" },
  });
  check("f1-expiry-this-week", soon[0]?.timeBucket === "this_week" && soon[0]?.severity === "high");
  const later = detectForContract({
    today: TODAY,
    contract: { contractId: "c-1", contractNumber: "TZ-001", title: "Contract", endDate: addDays(TODAY, 40), status: "active" },
  });
  check("f2-expiry-monitoring", later[0]?.timeBucket === "monitoring" && later[0]?.severity === "low");
  const far = detectForContract({
    today: TODAY,
    contract: { contractId: "c-1", contractNumber: "TZ-001", title: "Contract", endDate: addDays(TODAY, DEFAULT_THRESHOLDS.expiryWarningDays + 5), status: "active" },
  });
  check("f3-expiry-silent-when-far", far.length === 0);
  const archived = detectForContract({
    today: TODAY,
    contract: { contractId: "c-1", contractNumber: "TZ-001", title: "Contract", endDate: addDays(TODAY, 5), status: "archived" },
  });
  check("f4-archived-contract-silent", archived.length === 0);
  const approvals = detectWaitingApprovals([
    { id: "a-1", actionType: "officer.escalate", contractId: "c-1", obligationId: null, reason: "because" },
  ]);
  check("f5-approvals-bucket", approvals[0].timeBucket === "today" && approvals[0].dedupeKey === "action_waiting:a-1");
}

// ===== G. thresholds are parameters, not constants ==========================
{
  const tight = detectForObligation({
    today: TODAY,
    obligation: obligation({
      dueDate: addDays(TODAY, 5),
      requirements: [req("report", { effective: eff({ operational: "missing", latest: "missing" }) })],
    }),
    thresholds: { ...DEFAULT_THRESHOLDS, nearDays: 7, weekDays: 14 },
  });
  const due = tight.find((x) => x.kind === "due_soon");
  check("g1-configurable-near-window", due?.timeBucket === "next_3_days" && due?.severity === "high",
    JSON.stringify([due?.timeBucket, due?.severity]));
}

// ===== H. local-date helper agrees with clock ==============================
{
  const instant = new Date("2026-09-22T21:15:00Z");
  for (const tz of ["UTC", "Asia/Riyadh", "Europe/London", "America/New_York", "Asia/Kolkata"]) {
    const c = buildClock(instant, tz);
    check(`h-${tz}-consistent`, c.today === localDate(instant, tz) && c.timeZone === tz, `${c.today}`);
  }
}

// ---- Phase 4A.2: calendar windows are server-resolved local midnights ----
{
  check("w1-riyadh-midnight", zonedStartOfDayIso("2026-09-23", "Asia/Riyadh") === "2026-09-22T21:00:00.000Z");
  check("w2-utc-midnight", zonedStartOfDayIso("2026-09-23", "UTC") === "2026-09-23T00:00:00.000Z");
  // New York DST starts 2026-03-08 02:00 local: midnight is still EST (-5)
  check("w3-ny-dst-start-day", zonedStartOfDayIso("2026-03-08", "America/New_York") === "2026-03-08T05:00:00.000Z");
  check("w4-ny-after-dst", zonedStartOfDayIso("2026-03-09", "America/New_York") === "2026-03-09T04:00:00.000Z");
  const c = buildClock(new Date("2026-09-24T01:30:00Z"), "Asia/Riyadh"); // 04:30 local, 24 Sep
  check("w5-clock-yesterday", c.yesterday === "2026-09-23", c.yesterday);
  check("w6-clock-start-of-yesterday", c.startOfYesterdayIso === "2026-09-22T21:00:00.000Z", c.startOfYesterdayIso);
  check("w7-clock-start-of-today", c.startOfTodayIso === "2026-09-23T21:00:00.000Z", c.startOfTodayIso);
  check("w8-yesterday-before-today", c.startOfYesterdayIso < c.startOfTodayIso && c.startOfLast7DaysIso < c.startOfYesterdayIso);
}

console.log(`\nofficer-timezone tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
