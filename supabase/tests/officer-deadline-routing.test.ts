/* eslint-disable @typescript-eslint/no-explicit-any */
// Officer deadline-mutation routing + ambiguous-date clarification.
//
// Proven defect (saved live trace, r7 diagnostic 2026-09-28): "Change the
// deadline on BETA-200 to next Friday." routed to ORIENTATION+CONTRACT+
// ACTIVITY+EVIDENCE — the ACTION group (requestHumanApproval et al.) was
// never offered, so the Officer correctly-but-helplessly reported that no
// approval tool existed, and cited a missing clock that was in fact in the
// system prompt (RESOLVED CLOCK). Fix: mutation intent (change-verb +
// schedulable object, or an Arabic imperative at a word boundary) selects
// ACTION; the prompt states the clock is always resolved and that an
// ambiguous relative date needs an explicit date before a proposal.
//
// These are deterministic provider/registry tests — they prove the toolset
// routing and the prompt contract, NOT live model behavior.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-deadline-routing.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { selectToolGroups, TOOL_GROUPS, runOfficerTool } from "../../src/lib/officer/tools";
import { buildOfficerSystemPrompt } from "../../src/lib/officer/prompt";
import { buildClock } from "../../src/lib/officer/time";
import { authorizeAction } from "../../src/lib/officer/authority";
import type { OfficerContext } from "../../src/lib/officer/context";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const ACTION_TOOLS = new Set(TOOL_GROUPS.ACTION);
const offered = (q: string, contractScoped = false) => {
  const sel = selectToolGroups({ question: q, contractScoped });
  return {
    groups: sel.groups,
    names: new Set(sel.tools.map((t) => t.name)),
    hasAction: sel.groups.includes("ACTION"),
  };
};

/* ---------- mutation phrasing → ACTION offered ---------- */

function routingTests() {
  for (const q of [
    "Change the deadline on BETA-200 to next Friday.",           // the proven miss
    "Move the due date of the SLA report to next Monday.",
    "Postpone the deadline for the safety inspection by a week.",
    "Extend the delivery date on ALPHA-100 to next month.",
    "Reschedule the site visit to tomorrow.",
    "Update the end date for DELTA-400.",
    "Can you amend the deadline for the audit?",
  ]) {
    const s = offered(q);
    check(`EN mutation → ACTION offered: "${q.slice(0, 52)}…"`, s.hasAction && [...ACTION_TOOLS].every((t) => s.names.has(t)));
  }

  for (const q of [
    "غيّر موعد الاستحقاق على BETA-200 إلى الجمعة القادمة.",
    "غيّر الموعد النهائي إلى الأسبوع القادم.",
    "عدّل الموعد إلى الجمعة القادمة.",
    "أجّل موعد التسليم أسبوعًا.",
    "مدّد موعد الاستحقاق.",
  ]) {
    const s = offered(q);
    check(`AR imperative mutation → ACTION offered: "${q.slice(0, 44)}…"`, s.hasAction);
  }

  // Read-only / non-imperative phrasing must NOT open the write path.
  for (const q of [
    "What is the deadline on BETA-200?",
    "ما موعد الاستحقاق؟",
    "متى موعد التسليم؟",
    "What changed this week?",
    "ما الذي تغيّر في العقد؟",          // تغيّر = "changed" (read), not imperative
    "تغيّر الموعد الأسبوع الماضي؟",      // "did the date change" — a read
    "Did the vendor change the deadline last month?",
    "Show me contracts whose deadline is overdue.",
  ]) {
    const s = offered(q);
    check(`read-only → ACTION withheld: "${q.slice(0, 52)}"`, !s.hasAction, JSON.stringify(s.groups));
  }

  // An unmatched question still gets the full fallback (never narrower).
  const full = selectToolGroups({ question: "zzz xyzzy", contractScoped: false });
  check("unclassifiable question → full toolset fallback", full.fullFallback === true && full.tools.length > 10);

  // Contract-scoped mutation keeps contract scope AND gains ACTION.
  const scoped = offered("Change the deadline to next Friday.", true);
  check("contract-scoped mutation → ACTION + scope groups", scoped.hasAction && scoped.groups.includes("CONTRACT"));

  // The A02 lookup path: the proposal tools alone are not enough — the
  // obligation lookup tools must ride with ACTION so the model can resolve
  // "the deadline" to the contract's obligation set before asking.
  for (const q of [
    "Change the deadline on BETA-200 to next Friday.",
    "غيّر موعد الاستحقاق على BETA-200 إلى الجمعة القادمة.",
  ]) {
    const s = offered(q);
    check(`deadline mutation offers lookup tools beside ACTION: "${q.slice(0, 44)}…"`,
      s.hasAction && s.names.has("listObligations") && s.names.has("getObligation") && s.names.has("getContract"));
  }
}

/* ---------- refusal/permission paths stay closed ---------- */

function stubCtx(role: "member" | "owner", opts: { contractFound?: boolean } = {}): OfficerContext {
  const table = {
    contracts: { data: opts.contractFound === false ? null : { id: "c-foreign" } },
  } as Record<string, { data: unknown }>;
  const supabase = {
    from: (t: string) => {
      const res = table[t] ?? { data: null };
      const chain: any = new Proxy({}, {
        get(_t2, prop) {
          if (prop === "then") return (resolve: any) => Promise.resolve({ data: res.data, error: null }).then(resolve);
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: res.data, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  };
  return {
    supabase: supabase as never,
    organizationId: "org-a",
    userId: "user-1",
    role,
    clock: buildClock(new Date("2026-09-28T12:00:00Z"), "Asia/Riyadh"),
    locale: "en",
    organizationName: "Benchmark Org",
    officer: { displayName: "Officer", preferredLanguage: "auto", tone: "professional", enabled: true },
  };
}

async function refusalTests() {
  const FOREIGN = "99999999-8888-7777-6666-555555555555";
  // Foreign-tenant contract id resolves to null inside the org-scoped lookup.
  const ctx = stubCtx("owner", { contractFound: false });
  const r1 = await runOfficerTool(ctx, "requestHumanApproval", {
    actionType: "officer.escalate", summary: "esc", reason: "test", contractId: FOREIGN,
  });
  check("requestHumanApproval on foreign contract → refused", !r1.ok);
  const r2 = await runOfficerTool(ctx, "createInternalAction", {
    actionType: "officer.internal_task", title: "t", reason: "test", contractId: FOREIGN,
  });
  check("createInternalAction on foreign contract → refused", !r2.ok);

  // Role capability: a member may propose but never executes; owners hold
  // obligation.reschedule. The gate is server-side at both ends.
  check("member lacks obligation.reschedule (execute-time gate)",
    authorizeAction("member", "obligation.change_due_date").allowed === false);
  check("owner holds obligation.reschedule (execute-time gate)",
    authorizeAction("owner", "obligation.change_due_date").allowed === true);
  check("unknown action type refused", authorizeAction("member", "deadline.force_set").allowed === false);
  // No tool mutates a contract deadline directly — only proposal paths.
  const allToolNames = selectToolGroups({ question: "zzz", contractScoped: false }).tools.map((t) => t.name);
  check("no direct contract-mutation tool exists", !allToolNames.some((n) => /deadline|reschedule|mutate|update_contract/i.test(n)));
}

/* ---------- prompt: clock present, ambiguity rule, capability honesty ---------- */

function promptTests() {
  const ctx = stubCtx("member");
  const p = buildOfficerSystemPrompt({ ctx, memory: [], contractScope: null });
  check("prompt carries resolved org timezone", p.includes("organization timezone: Asia/Riyadh"));
  check("prompt carries resolved today (local)", /- today \(local\): 2026-09-28/.test(p));
  check("prompt forbids claiming a missing clock", /never claim the date or timezone is unavailable/.test(p));
  check("prompt requires explicit date before a deadline proposal", /ask for the explicit date before proposing anything that carries a deadline/.test(p));
  check("prompt anchors candidate dates to resolved clock", /compute them from today \(local\) in the organization timezone/.test(p));
  check("prompt: a date pick is clarification, not approval", /pick of a date or option is clarification, not approval/.test(p));

  const pNoAction = buildOfficerSystemPrompt({ ctx, memory: [], contractScope: null, actionToolsOffered: false });
  check("prompt without ACTION tools says the proposal path is unavailable",
    /No proposal or approval-request tool is offered in this session/.test(pNoAction));
  check("prompt with ACTION tools omits the unavailable notice", !p.includes("No proposal or approval-request tool is offered"));
}

/* ---------- wiring ---------- */

function wiringTests() {
  const conv = src("src/lib/officer/converse.ts");
  check("converse selects tools before building the prompt",
    conv.indexOf("selectToolGroups({") < conv.indexOf("buildOfficerSystemPrompt({"));
  check("converse passes actionToolsOffered from the real selection",
    /actionToolsOffered: selection\.tools\.some/.test(conv));
  check("idempotency + reused-proposal honesty tests still present",
    src("src/lib/officer/tools.ts").includes("reused=true") );
}

async function main() {
  routingTests();
  await refusalTests();
  promptTests();
  wiringTests();
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length} passed · ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
