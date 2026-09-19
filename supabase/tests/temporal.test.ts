// VAZORA Phase 2B.7 — temporal engine unit tests (deterministic, no LLM).
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/temporal.test.ts

import { extractTemporal } from "../../src/lib/ingestion/temporal";

type Case = { input: string; expect: Partial<{ frequency: string | null; due: string | null; relativeDays: number | null }> };

const cases: Case[] = [
  // Arabic — calendar day
  { input: "في اليوم الخامس من كل شهر", expect: { frequency: "monthly", due: "monthly_day_5" } },
  { input: "بحلول اليوم العاشر من كل شهر", expect: { frequency: "monthly", due: "monthly_day_10" } },
  { input: "في اليوم الثالث من كل شهر", expect: { frequency: "monthly", due: "monthly_day_3" } },
  { input: "شهريًا", expect: { frequency: "monthly", due: null } },
  { input: "قبل نهاية كل شهر", expect: { frequency: "monthly", due: "monthly_end" } },
  // Arabic — relative days
  { input: "خلال 7 أيام من الاستلام", expect: { frequency: null, due: "relative_days_7", relativeDays: 7 } },
  { input: "خلال خمسة أيام من التسليم", expect: { frequency: null, relativeDays: 5 } },
  // Arabic — wider cadence
  { input: "كل ثلاثة أشهر", expect: { frequency: "quarterly" } },
  { input: "سنويًا", expect: { frequency: "annually", due: null } },
  { input: "أسبوعيًا", expect: { frequency: "weekly", due: null } },
  // English — calendar day
  { input: "monthly", expect: { frequency: "monthly", due: null } },
  { input: "on the fifth day of each month", expect: { frequency: "monthly", due: "monthly_day_5" } },
  { input: "by the 10th of each month", expect: { frequency: "monthly", due: "monthly_day_10" } },
  { input: "no later than the 7th of the month", expect: { frequency: "monthly", due: "monthly_day_7" } },
  { input: "quarterly", expect: { frequency: "quarterly", due: null } },
  { input: "annually", expect: { frequency: "annually", due: null } },
  // English — relative days
  { input: "within 7 days of receipt", expect: { frequency: null, due: "relative_days_7", relativeDays: 7 } },
  { input: "no later than 10 days after period end", expect: { frequency: null, due: "relative_days_10", relativeDays: 10 } },
  { input: "before month-end", expect: { frequency: "monthly", due: "monthly_end" } },
  // Mixed
  { input: "Report monthly by اليوم السابع", expect: { frequency: "monthly", due: "monthly_day_7" } },
  // Negative
  { input: "deliver quarterly management consulting", expect: { due: null } },
  { input: "انس".length ? "اسم الشركة فقط." : "", expect: { frequency: null, due: null } },
];

let passed = 0, failed = 0;
for (const c of cases) {
  const got = extractTemporal(c.input);
  const okFreq = c.expect.frequency === undefined || got.frequency === c.expect.frequency;
  const okDue = c.expect.due === undefined || got.due === c.expect.due;
  const okRel = c.expect.relativeDays === undefined || got.relativeDays === c.expect.relativeDays;
  const ok = okFreq && okDue && okRel;
  if (ok) passed++;
  else {
    failed++;
    console.log("FAIL:", JSON.stringify(c.input), "->", JSON.stringify(got), "expected", JSON.stringify(c.expect));
  }
}
console.log(`temporal tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
