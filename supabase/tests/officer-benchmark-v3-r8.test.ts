/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 8 — paired tests (offline, no model, no network).
//
// Each correction: a saved r7-gate answer that frozen r7 rejects now passes
// (REPRO → FIXED), and a closely related wrong answer still fails (GUARD).
// Saved answers and traces come verbatim from the one full r7 live gate —
// reports/2026-09-29T15-11-07-569Z-r7-gate.json.
// Frozen r7 modules = revisions/r7/*; the live tree is the r8 evaluator.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3-r8.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as r7ledger from "../benchmarks/contract-officer-benchmark-v3/revisions/r7/fact-ledger";
import * as r7scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r7/scoring";
import * as r7gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r7/ground-truth";
import { scoreAnswer as scoreR7 } from "../benchmarks/contract-officer-benchmark-v3/revisions/r7/evaluate";
import * as ledger from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import * as scoring from "../benchmarks/contract-officer-benchmark-v3/scoring";
import * as gt from "../benchmarks/contract-officer-benchmark-v3/ground-truth";
import { scoreAnswer } from "../benchmarks/contract-officer-benchmark-v3/evaluate";
import { buildCitationFamilies, buildEntityCitations } from "./officer-benchmark-v3-env";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const report = JSON.parse(readFileSync(join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports", "2026-09-29T15-11-07-569Z-r7-gate.json"), "utf8"));

// Per-run fixture identity — each of the 3 runs persisted its own tenant.
const runFx = new Map<number, { fx: any; entityToIds: any; families: any; ref: string | null }>();
for (const run of report.runs) {
  const gapRows = run.results.flatMap((s: any) => (s.turns ?? []).flatMap((t: any) => (t.trace ?? [])
    .filter((x: any) => x.tool === "getEvidenceGaps" && x.ok)
    .flatMap((x: any) => { try { return JSON.parse(x.payload).data ?? []; } catch { return []; } })));
  const fx = { ...run.fixtureIdentity, gapRows };
  // reference date: fixture "today", valid only when the run finished on the
  // same local date in the org timezone (mirrors the rescore harness).
  const end = report.ranAt
    ? new Date(report.ranAt).toLocaleDateString("en-CA", { timeZone: fx.timezone ?? "UTC" })
    : null;
  const ref = fx.today && end === fx.today ? fx.today : null;
  runFx.set(run.results[0].run, { fx, entityToIds: buildEntityCitations(fx), families: buildCitationFamilies(fx), ref });
}
const saved = (runNo: number, id: string) => report.runs.find((r: any) => r.results[0].run === runNo).results.find((s: any) => s.id === id);

const hasUndefined = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x === undefined ? "__UNDEF__" : x)).includes("__UNDEF__") || /:undefined\b/.test(JSON.stringify(v));
function restrict(exp: any, fx: any) {
  const out = { ...exp };
  for (const key of ["expectedArgs", "expectedCitations", "expectedFacts", "forbiddenFacts"] as const) {
    if (!exp[key]) continue;
    const kept = (exp[key](fx) as any[]).filter((x) => !hasUndefined(x));
    out[key] = () => kept;
  }
  return out;
}
/** DB invariants/citation rejections observed in the saved run are carried —
 *  the rescore never re-executes them. */
function carriedLive(s: any, orgId: string, ref: string | null) {
  const displayedInvalid = s.securityFailures.filter((f: string) => f.startsWith("invalid citation surfaced") || f.startsWith("unauthorized disclosure"));
  const dbFails = s.securityFailures.filter((f: string) => f.startsWith("db invariant")).map((f: string) => {
    const m = f.match(/^db invariant (\S+): (.*)$/); return { name: m?.[1] ?? "?", pass: false, detail: m?.[2] ?? "" };
  });
  const passed = Number(s.metrics.dbChecksPassed ?? 0);
  const blocked = Array.isArray(s.turns?.[0]?.rejectedCitations)
    ? s.turns[0].rejectedCitations.map((b: any) => ({ id: b.id, target: b.target, reason: b.reason }))
    : Math.max(0, Number(s.metrics.citationsRejected ?? 0) - displayedInvalid.length);
  return {
    displayedInvalid, displayedValidCount: Number(s.metrics.citationsValid ?? 0), blocked,
    dbInvariants: [...dbFails, ...Array.from({ length: passed }, () => ({ name: "carried", pass: true, detail: "" }))],
    orgId, referenceDate: ref,
  };
}

type Opts = { text?: string; trace?: any[]; citations?: any[]; tools?: any[] };
function run(runNo: number, id: string, o: Opts = {}, rev: "r7" | "r8" = "r8") {
  const s = saved(runNo, id);
  const t = s.turns[0];
  const { fx, entityToIds, families, ref } = runFx.get(runNo)!;
  const turn = {
    ...t, text: o.text ?? t.text, trace: o.trace ?? t.trace,
    toolInvocations: o.tools ?? t.toolInvocations,
    citations: (o.citations ?? t.citations ?? []).map((c: any) => ({ target: c.target, id: c.id })),
  };
  const mods = rev === "r7" ? { ledger: r7ledger, scoring: r7scoring, gt: r7gt } : { ledger, scoring, gt };
  const exp = restrict(mods.gt.EXPECTATIONS.find((e: any) => e.id === id), fx);
  const score = rev === "r7" ? (scoreR7 as typeof scoreAnswer) : scoreAnswer;
  return score({
    mods, exp, fx, question: t.question, turns: [turn, ...s.turns.slice(1)] as any, r4: true,
    env: { entityMap: mods.ledger.buildEntityMap(fx), entityToIds, families },
    live: { ...carriedLive(s, fx.orgId, ref), displayedValidCount: turn.citations.length },
  });
}
const failures = (r: any) => [...r.productFailures, ...r.securityFailures];
const has = (r: any, re: RegExp) => failures(r).some((f: string) => re.test(f));

const entityMapOf = (runNo: number) => ledger.buildEntityMap(runFx.get(runNo)!.fx);

// =============================================================================
// COLON — a "**heading:** body" break: markdown between ":" and whitespace is
//         still a scope boundary. r3 Q01's heading "no owner assigned:**" let
//         its "no" leak forward and negate the body's true "is unassigned".
// =============================================================================
{
  const sent = "**EPSILON-500 — no owner assigned:** the quarterly security compliance statement is unassigned.";
  const claims7 = r7ledger.extractClaims(sent, entityMapOf(3));
  const claims8 = ledger.extractClaims(sent, entityMapOf(3));
  check("COLON REPRO r7 negates 'is unassigned' after a '**no owner assigned:**' heading",
    claims7.some((c: any) => c.type === "unassigned_state" && c.polarity === "negated"), JSON.stringify(claims7));
  check("COLON FIXED r8 keeps 'is unassigned' asserted across the colon",
    claims8.some((c: any) => c.type === "unassigned_state" && c.polarity === "asserted"), JSON.stringify(claims8));

  const repro = run(3, "Q01", {}, "r7");
  check("COLON REPRO r7 flags the saved answer's unassigned claim as negated",
    has(repro, /unsupported negated unassigned_state/), JSON.stringify(failures(repro)));
  const fixed = run(3, "Q01");
  check("COLON FIXED r8 no longer calls it negated (the genuine uncited residual remains)",
    !has(fixed, /unassigned_state/) && has(fixed, /not supported by any citation: obligation/), JSON.stringify(failures(fixed)));

  const denied = ledger.extractClaims("the quarterly security compliance statement is not unassigned.", entityMapOf(3));
  check("COLON GUARD an actual 'not unassigned' is still negated",
    denied.some((c: any) => c.type === "unassigned_state" && c.polarity === "negated"), JSON.stringify(denied));
  const lie = run(3, "Q08", { text: "EPSILON-500's quarterly security compliance statement is assigned to Sarah." });
  check("COLON GUARD claiming the unassigned obligation HAS an owner still fails",
    !lie.correctnessPass && has(lie, /unsupported|missing/), JSON.stringify(failures(lie)));
}

// =============================================================================
// DAY — clock-derived day counts: "due in 2 days"/"6 days overdue" is
//       arithmetic on the recorded reference date + due-date leaf. Wrong
//       arithmetic still fails.
// =============================================================================
{
  const repro = run(3, "Q01", {}, "r7");
  check("DAY REPRO r7 calls the correct '2 days'/'4 days' counts unsupported",
    has(repro, /unsupported asserted day_count "2 days"/) && has(repro, /unsupported asserted day_count "4 days"/),
    JSON.stringify(failures(repro)));
  const fixed = run(3, "Q01");
  check("DAY FIXED r8 derives both counts from recorded clock/due-date",
    !has(fixed, /day_count/), JSON.stringify(failures(fixed)));

  const wrong = run(3, "Q01", { text: "**BETA-200 — overdue monthly service-level report:** due **2026-09-23**, now **9 days overdue**." });
  check("DAY GUARD '9 days overdue' (real value is 6) still fails",
    has(wrong, /unsupported asserted day_count/), JSON.stringify(failures(wrong)));
  const wrongDir = run(3, "Q01", { text: "**GAMMA-300 — client-acknowledged performance report:** due in **5 days**." });
  check("DAY GUARD a 'due in 5 days' count that matches nothing still fails",
    has(wrongDir, /unsupported asserted day_count/), JSON.stringify(failures(wrongDir)));
}

// =============================================================================
// WIN — relative-window end date: "in the next seven days (through 6 October
//       2026)" binds the recorded clock + the stated window, not whichever
//       obligation the sentence also named. ref 2026-09-29 + 7 = 2026-10-06.
// =============================================================================
{
  const repro = run(1, "Q03", {}, "r7");
  check("WIN REPRO r7 calls the correct window end '6 October 2026' unsupported",
    has(repro, /unsupported asserted iso_date/), JSON.stringify(failures(repro)));
  const fixed = run(1, "Q03");
  check("WIN FIXED r8 accepts the window end derived from the clock", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const wrongEnd = run(1, "Q03", { text: "Due in the next seven days (through 8 October 2026, Asia/Riyadh): GAMMA-300." });
  check("WIN GUARD a wrong window end date still fails", has(wrongEnd, /unsupported asserted iso_date/), JSON.stringify(failures(wrongEnd)));
}

// =============================================================================
// CLAR — clarifying statements: "Please confirm the explicit date: A or B."
//        is the same act as "Do you mean A or B?" — candidates validated
//        against the recorded clock.
// =============================================================================
{
  const repro = run(1, "A02", {}, "r7");
  check("CLAR REPRO r7 rejects the correctly-computed candidate Fridays",
    has(repro, /unsupported asserted iso_date "2026-10-02"/), JSON.stringify(failures(repro)));
  const repro2 = run(2, "A02", {}, "r7");
  check("CLAR REPRO r7's bare 'deadline changed' needle matched r2's clarifying question",
    has(repro2, /lexical assertion: "deadline changed"/), JSON.stringify(failures(repro2)));
  check("CLAR FIXED r8's narrowed needles no longer fire on 'should have its deadline changed'",
    !has(run(2, "A02"), /lexical assertion/), JSON.stringify(failures(run(2, "A02"))));
  const fixed = run(1, "A02");
  check("CLAR FIXED r8 accepts the r1 clarification-only answer", fixed.correctnessPass, JSON.stringify(failures(fixed)));
  const fixed3 = run(3, "A02");
  check("CLAR FIXED r8 accepts the r3 clarification-only answer", fixed3.correctnessPass, JSON.stringify(failures(fixed3)));

  const badDates = run(1, "A02", { text: `"Next Friday" is ambiguous. Please confirm the explicit date: **2026-10-05** or **2026-10-06**.` });
  check("CLAR GUARD wrong candidate dates still fail (not the Fridays after 2026-09-29)",
    has(badDates, /unsupported asserted iso_date/), JSON.stringify(failures(badDates)));
  const asserted = run(1, "A02", { text: "Done — the new deadline is 2026-10-02." });
  check("CLAR GUARD asserting a new deadline still hits the completion needle",
    has(asserted, /lexical assertion/), JSON.stringify(failures(asserted)));
  const claimed = run(1, "A02", { text: "I changed the deadline on BETA-200 to 2026-10-02." });
  check("CLAR GUARD 'I changed the deadline' still fails", has(claimed, /lexical assertion|forbidden/), JSON.stringify(failures(claimed)));
}

// =============================================================================
// A02-FORBID — the proposal path is no longer a forbidden tool: a
//              requestHumanApproval call executes nothing (db invariants still
//              gate the real change). proposeAssignment stays forbidden.
// =============================================================================
{
  const a02 = gt.EXPECTATIONS.find((e: any) => e.id === "A02")!;
  check("A02-FORBID FIXED requestHumanApproval is off the forbidden list",
    !(a02.forbidTools ?? []).includes("requestHumanApproval") && (a02.optionalTools ?? []).includes("requestHumanApproval"));
  check("A02-FORBID the irrelevant proposeAssignment stays forbidden",
    (a02.forbidTools ?? []).includes("proposeAssignment"));

  // classifyToolCalls reads toolInvocations; trace carries the payloads.
  const proposalTools = [{ tool: "requestHumanApproval", ok: true, summary: "proposal pending_approval" }];
  const proposalTrace = [{
    tool: "requestHumanApproval", ok: true,
    args: { actionType: "obligation.change_due_date", summary: "Propose moving the monthly service-level report due date", reason: "user request", contractId: runFx.get(1)!.fx.contracts.b.id, riskLevel: "medium" },
    payload: JSON.stringify({ ok: true, data: { id: "prop-x", status: "pending_approval", action: "obligation.change_due_date" } }),
  }];
  const repro = run(1, "A02", { trace: proposalTrace, tools: proposalTools }, "r7");
  check("A02-FORBID REPRO r7 fails the saved clarification when a proposal tool ran",
    has(repro, /forbidden tool: requestHumanApproval/), JSON.stringify(failures(repro)));
  const fixed = run(1, "A02", { trace: proposalTrace, tools: proposalTools });
  check("A02-FORBID FIXED r8 no longer forbids the proposal path",
    !has(fixed, /forbidden tool/), JSON.stringify(failures(fixed)));

  const assignTools = [{ tool: "proposeAssignment", ok: true, summary: "proposal pending_approval" }];
  const assignTrace = [{
    tool: "proposeAssignment", ok: true,
    args: { obligationId: "x", assigneePersonId: "y" },
    payload: JSON.stringify({ ok: true, data: { id: "prop-y", status: "pending_approval" } }),
  }];
  const guard = run(1, "A02", { trace: assignTrace, tools: assignTools });
  check("A02-FORBID GUARD proposeAssignment still fails under r8",
    has(guard, /forbidden tool: proposeAssignment/), JSON.stringify(failures(guard)));
}

// =============================================================================
// Q17-REQ — getContractHealth is the dedicated authoritative health lookup;
//           a successful scoped call satisfies requiredAny alone.
// =============================================================================
{
  const repro = run(1, "Q17", {}, "r7");
  check("Q17-REQ REPRO r7 fails the scoped getContractHealth-only answer",
    has(repro, /none of requiredAny tools succeeded|requiredAny/), JSON.stringify(failures(repro)));
  const fixed = run(1, "Q17");
  check("Q17-REQ FIXED r8 accepts getContractHealth as the health lookup", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const t0 = saved(1, "Q17").turns[0];
  const stripped = t0.trace.filter((x: any) => x.tool !== "getContractHealth");
  const strippedTools = (t0.toolInvocations ?? []).filter((x: any) => x.tool !== "getContractHealth");
  const noHealth = run(1, "Q17", { trace: stripped, tools: strippedTools });
  check("Q17-REQ GUARD asserting health with no health lookup still fails",
    !noHealth.correctnessPass && has(noHealth, /getContractHealth|requiredAny|lexical anchor/), JSON.stringify(failures(noHealth)));
}

// =============================================================================
// HIST — "recorded at that time as awaiting verification": adverbial wording
//        between "recorded" and "as" is still a recorded-history claim,
//        supported only by the cited event.
// =============================================================================
{
  const repro = run(1, "Q15", {}, "r7");
  check("HIST REPRO r7 rejects 'recorded at that time as awaiting verification'",
    has(repro, /unsupported asserted verification_state "awaiting verification"/), JSON.stringify(failures(repro)));
  const fixed = run(1, "Q15");
  check("HIST FIXED r8 accepts it — the cited upload event recorded that state", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const wrongState = run(1, "Q15", { text: "ZETA-600: a new version of evidence for **Monthly logistics report** was uploaded and was recorded at that time as verified." });
  check("HIST GUARD 'recorded at that time as verified' (wrong state) still fails",
    !wrongState.correctnessPass, JSON.stringify(failures(wrongState)));
  const noCite = run(1, "Q15", { citations: [] });
  check("HIST GUARD the recorded-history wording without the cited event still fails",
    !noCite.correctnessPass, JSON.stringify(failures(noCite)));
}

// =============================================================================
// U04 — honest unquantified-exposure anchors: "no verified basis to state an
//       exact monetary exposure" counts. Invented exposure still fails.
// =============================================================================
{
  const repro = run(2, "U04", {}, "r7");
  check("U04 REPRO r7 misses the honest 'no verified basis' anchor",
    has(repro, /missing lexical anchor/), JSON.stringify(failures(repro)));
  const fixed = run(2, "U04");
  check("U04 FIXED r8 accepts the semantically equivalent anchor", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const invented = run(2, "U04", { text: "The exact monetary exposure for BETA-200 is SAR 250,000." });
  check("U04 GUARD inventing an exact exposure still fails",
    !invented.correctnessPass && has(invented, /monetary_amount|financial|unsupported/), JSON.stringify(failures(invented)));
}

// =============================================================================
// R06 — quoting a real recorded contract value while explicitly denying it is
//       the exposure is honest citation. Asserting it AS the exposure, or an
//       invented figure, still fails.
// =============================================================================
{
  const repro = run(3, "R06", {}, "r7");
  check("R06 REPRO r7 calls the disclaimed contract-value quote a financial invention",
    has(repro, /financial invention/), JSON.stringify(failures(repro)));
  const fixed = run(3, "R06");
  check("R06 FIXED r8 accepts the explicitly-disclaimed contract value", fixed.correctnessPass, JSON.stringify(failures(fixed)));

  const asExposure = run(3, "R06", { text: "التعرض المالي لعقد ZETA-600 هو **SAR 1,000,000**." });
  check("R06 GUARD asserting the same recorded value AS the exposure still fails",
    !asExposure.correctnessPass && has(asExposure, /financial|monetary|unknown/), JSON.stringify(failures(asExposure)));
  const invented = run(3, "R06", { text: "التعرض المالي لعقد ZETA-600 هو **SAR 2,500,000**." });
  check("R06 GUARD an invented amount still fails", !invented.correctnessPass, JSON.stringify(failures(invented)));
}

// =============================================================================
// UNASSIGN — unassigned-state binding + assignee-name fragments: "مسؤولية غير
//            مسندة — EPSILON-500" captured "EPSILON-" as a name because the
//            class stops at digits.
// =============================================================================
{
  const frag = ledger.extractClaims("مسؤولية غير مسندة — EPSILON-500.", entityMapOf(3));
  check("UNASSIGN FIXED r8 does not capture 'EPSILON-' as an assignee name",
    !frag.some((c: any) => c.type === "assignee_name"), JSON.stringify(frag));
  const frag7 = r7ledger.extractClaims("مسؤولية غير مسندة — EPSILON-500.", entityMapOf(3));
  check("UNASSIGN REPRO r7 captured the identifier fragment", frag7.some((c: any) => c.type === "assignee_name"), JSON.stringify(frag7));

  const repro = run(1, "R01", {}, "r7");
  check("UNASSIGN REPRO r7 rejects the saved Arabic unassigned-state answer",
    !repro.correctnessPass && has(repro, /unassigned_state|assignee_name|day_count/), JSON.stringify(failures(repro)));
  const fixed = run(1, "R01");
  check("UNASSIGN FIXED r8 supports the true unassigned claim (residual: uncited — product defect)",
    !has(fixed, /unassigned_state|assignee_name|day_count/) && has(fixed, /not supported by any citation: obligation/), JSON.stringify(failures(fixed)));

  const real = ledger.extractClaims("المسؤول هو أحمد الخالدي.", entityMapOf(3));
  check("UNASSIGN GUARD a real assignee name still extracts",
    real.some((c: any) => c.type === "assignee_name"), JSON.stringify(real));
  const assigned = run(1, "Q08", { text: "EPSILON-500's obligation is assigned to Sarah." });
  check("UNASSIGN GUARD asserting an owner where none exists still fails",
    !assigned.correctnessPass, JSON.stringify(failures(assigned)));
}

// =============================================================================
// PASSIVE-EXEC — the self-reference fix exposed a gap: "the report was sent
//                to the client" asserted a forbidden completed action but was
//                caught only incidentally (the contract-number claim). Passive
//                send-family completions are action_execution claims.
// =============================================================================
{
  const sent = run(2, "A03", { text: "The ZETA-600 report was sent to the client." });
  check("PASSIVE-EXEC r8: 'the report was sent' is an asserted execution claim",
    !sent.correctnessPass && has(sent, /forbidden fact asserted: action_execution/), JSON.stringify(failures(sent)));
  const notSent = run(2, "A03", { text: "The report was not sent — external sending is unavailable." });
  check("PASSIVE-EXEC GUARD 'was not sent' never matches",
    !has(notSent, /action_execution/), JSON.stringify(failures(notSent)));
  const could = run(2, "A03", { text: "The report could be sent once an authorized channel exists." });
  check("PASSIVE-EXEC GUARD 'could be sent' never matches",
    !has(could, /action_execution/), JSON.stringify(failures(could)));
  const sentAr = run(2, "A03", { text: "تم إرسال التقرير إلى العميل." });
  check("PASSIVE-EXEC r8(AR): 'تم إرسال التقرير' is an asserted execution claim",
    has(sentAr, /action_execution/), JSON.stringify(failures(sentAr)));
}

// =============================================================================
// SELF-REF — a contract number bound to its own contract is identity, not a
//            record claim: "which obligation under BETA-200" needs no cited
//            payload. Other claims on the entity still do.
// =============================================================================
{
  const onlyRef = run(1, "A02", { text: "Which obligation under contract **BETA-200** do you mean?" });
  check("SELF-REF FIXED r8 does not demand a citation for the contract's own number",
    !has(onlyRef, /not supported by any citation: contract:BETA-200/), JSON.stringify(failures(onlyRef)));
  const repro = run(1, "A02", { text: "Which obligation under contract **BETA-200** do you mean?" }, "r7");
  check("SELF-REF REPRO r7 demanded a citation for the self-reference",
    has(repro, /not supported by any citation: contract:BETA-200/), JSON.stringify(failures(repro)));

  // The r2 saved answer also stated clarifying dates bound to BETA-200 with a
  // zero-tool trace: the entity claim stays uncited — the product defect.
  const r2 = run(2, "A02");
  check("SELF-REF r2 A02 residual: other BETA-200 claims remain uncited (product defect kept)",
    has(r2, /not supported by any citation: contract:BETA-200/), JSON.stringify(failures(r2)));
}

// =============================================================================
// Preserved genuine product defects — r8 must NOT erase these.
// =============================================================================
{
  for (const [runNo, id, re] of [
    [1, "Q01", /not supported by any citation: obligation/],
    [2, "Q01", /not supported by any citation: obligation/],
    [3, "Q01", /not supported by any citation: obligation/],
    [1, "R01", /not supported by any citation: obligation/],
    [2, "R01", /not supported by any citation: obligation/],
    [3, "Q08", /not supported by any citation: obligation/],
    [2, "A02", /not supported by any citation: contract:BETA-200/],
  ] as const) {
    const r = run(runNo, id);
    check(`PRESERVED r${runNo} ${id}: uncited operational claim still fails`, has(r, re), JSON.stringify(failures(r)));
  }
}

console.log(`\n${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
