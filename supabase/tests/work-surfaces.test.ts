// REAL WORK SURFACES — officer_actions queue, officer_observations feed,
// activity_log timeline and contract_clauses: repository-boundary and
// wiring tests with test-only dependency injection.
//
// Simulated failures are NOT a real Supabase outage test — the checked
// readers and page wiring are the units under test, with stub providers /
// stub supabase clients. Failure-branch rendering is asserted statically;
// live navigation is covered by the browser QA pass.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/work-surfaces.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readActivityList,
  readAgentEvents,
  readClauseList,
} from "../../src/data/checked-reads";
import { listContractClauses } from "../../src/data/supabase/clauses";
import { listOfficerActions, mapOfficerActionRow } from "../../src/data/supabase/officer-queue";
import type { DataProvider } from "../../src/data/repositories";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const ACTION_ROW = {
  id: "act-1",
  contract_id: "ctr-1",
  obligation_id: null,
  conversation_id: "conv-1",
  action_type: "officer.escalate",
  arguments: { summary: "Escalate missing insurance certificate" },
  reason: "Evidence is overdue",
  citations: [],
  risk_level: "medium",
  requires_approval: true,
  status: "waiting_for_approval",
  proposed_by: "user-1",
  approved_by: null,
  approved_at: null,
  rejected_by: null,
  rejected_at: null,
  rejection_reason: null,
  executed_at: null,
  execution_result: null,
  error_message: null,
  created_at: "2026-01-01T00:00:00Z",
};

/* ---------- stub supabase client with call recording ---------- */

type Res = { data: unknown; error: { message: string } | null };
function stubClient(responses: Record<string, Res | Res[]>) {
  const queues = new Map<string, Res[]>();
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  return {
    calls,
    from(table: string) {
      const res: Res | Res[] = responses[table] ?? { data: [], error: null };
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              let r = res;
              if (Array.isArray(r)) {
                const q = queues.get(table) ?? [...r];
                queues.set(table, q);
                r = q.shift() ?? { data: [], error: null };
              }
              const out = r as Res;
              return (resolve: (v: Res) => void, reject: (e: unknown) => void) =>
                Promise.resolve(out).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              calls.push({ table, method: String(prop), args });
              return chain;
            };
          },
        },
      );
      return chain;
    },
  };
}

const OK = (data: unknown): Res => ({ data, error: null });
const ERR = (): Res => ({ data: null, error: { message: "injected failure" } });

/* ---------- listOfficerActions boundary ---------- */

async function queueBoundaryTests() {
  {
    const client = stubClient({ officer_actions: OK([ACTION_ROW]) });
    const r = await listOfficerActions(client as never, "org-1");
    check("queue populated → ok + action row", r.ok && r.actions.length === 1 && r.actions[0].id === "act-1");
    check("queue org-scoped", client.calls.some((c) => c.method === "eq" && c.args[0] === "organization_id" && c.args[1] === "org-1"));
  }
  {
    const client = stubClient({ officer_actions: OK([]) });
    const r = await listOfficerActions(client as never, "org-1");
    check("queue successful-empty → ok:true + []", r.ok && r.actions.length === 0 && !r.truncated);
  }
  {
    const client = stubClient({ officer_actions: ERR() });
    const r = await listOfficerActions(client as never, "org-1");
    check("queue error → ok:false", !r.ok);
  }
  {
    const throwing = { from: () => { throw new Error("network down"); } };
    const r = await listOfficerActions(throwing as never, "org-1").catch(() => ({ ok: false as const }));
    check("queue thrown error → ok:false", !r.ok);
  }
  {
    const client = stubClient({ officer_actions: OK([ACTION_ROW]) });
    const r = await listOfficerActions(client as never, "org-1", { contractId: "ctr-1" });
    check("queue contract filter applied",
      r.ok && client.calls.some((c) => c.method === "eq" && c.args[0] === "contract_id" && c.args[1] === "ctr-1"));
  }
  {
    const client = stubClient({ officer_actions: OK([ACTION_ROW]) });
    const r = await listOfficerActions(client as never, "org-1", { statuses: ["waiting_for_approval"] });
    check("queue status filter applied",
      r.ok && client.calls.some((c) => c.method === "in" && c.args[0] === "status" && JSON.stringify(c.args[1]) === JSON.stringify(["waiting_for_approval"])));
  }
  {
    // limit+1 probing: LIMIT=100 → 101 rows must flag truncated.
    const rows = Array.from({ length: 101 }, (_, i) => ({ ...ACTION_ROW, id: `act-${i}` }));
    const client = stubClient({ officer_actions: OK(rows) });
    const r = await listOfficerActions(client as never, "org-1");
    check("queue truncation flagged, not rendered complete", r.ok && r.truncated && r.actions.length === 100);
  }
  {
    const r = await listOfficerActions(stubClient({ officer_actions: OK(null) }) as never, "org-1");
    check("queue non-array payload → ok:false", !r.ok);
  }
}

/* ---------- mapOfficerActionRow honesty ---------- */

function mappingTests() {
  const v = mapOfficerActionRow({ ...ACTION_ROW });
  check("row maps id/type/status/summary", v.id === "act-1" && v.actionType === "officer.escalate" && v.status === "waiting_for_approval");
  check("row preserves conversation + contract linkage", v.conversationId === "conv-1" && v.contractId === "ctr-1");

  const held = mapOfficerActionRow({
    ...ACTION_ROW,
    status: "approved",
    approved_by: "approver-1",
    approved_at: "2026-01-02T00:00:00Z",
    execution_result: { executed: false, held: "approved_but_not_executed_in_phase_4a" },
  });
  check("approved-but-held stays status=approved, executedAt empty", held.status === "approved" && held.executedAt === null);
  check("held marker preserved in executionResult", (held.executionResult as Record<string, unknown>).held === "approved_but_not_executed_in_phase_4a");

  const done = mapOfficerActionRow({
    ...ACTION_ROW,
    status: "completed",
    executed_at: "2026-01-02T00:00:00Z",
    execution_result: { executed: true, kind: "officer.internal_task" },
  });
  check("executed internal action → completed + executedAt", done.status === "completed" && done.executedAt !== null);

  const rejected = mapOfficerActionRow({ ...ACTION_ROW, status: "rejected", rejected_by: "u9", rejected_at: "2026-01-02T00:00:00Z", rejection_reason: "no" });
  check("rejected state preserved", rejected.status === "rejected" && rejected.rejectedBy === "u9");
}

/* ---------- clause basis: approved vs pending-review ---------- */

const CLAUSE = { id: "cl-1", clause_number: "14.2", heading: "Payment", text: "…", page_number: 4, sequence_number: 1 };

async function clauseBasisTests() {
  // Approved baseline only → basis approved.
  {
    const client = stubClient({
      contract_ingestion_runs: OK([{ id: "r1", status: "approved" }]),
      contract_clauses: OK([CLAUSE]),
    });
    const r = await listContractClauses(client as never, "org", "c1");
    check("clauses approved-only run → basis approved", r.ok && r.basis === "approved" && r.clauses.length === 1);
  }
  // Approved baseline + NEWER pending-review run → approved stays the baseline.
  {
    const client = stubClient({
      contract_ingestion_runs: OK([
        { id: "r-new", status: "ready_for_review" },
        { id: "r-old", status: "approved" },
      ]),
      contract_clauses: OK([CLAUSE]),
    });
    const r = await listContractClauses(client as never, "org", "c1");
    check("clauses approved+newer pending → basis stays approved",
      r.ok && r.basis === "approved" && client.calls.some((c) => c.method === "eq" && c.args[0] === "ingestion_run_id" && c.args[1] === "r-old"));
  }
  // Pending-review only → flagged unapproved, never presented as baseline.
  {
    const client = stubClient({
      contract_ingestion_runs: OK([{ id: "r1", status: "ready_for_review" }]),
      contract_clauses: OK([CLAUSE]),
    });
    const r = await listContractClauses(client as never, "org", "c1");
    check("clauses pending-only → basis ready_for_review (label required)", r.ok && r.basis === "ready_for_review");
  }
  // Failed baseline read → ok:false — NO silent fallback to unapproved rows.
  {
    const r = await listContractClauses(stubClient({ contract_ingestion_runs: ERR() }) as never, "org", "c1");
    check("clauses failed run read → ok:false (no silent unapproved fallback)", !r.ok);
  }
  {
    const r = await listContractClauses(stubClient({
      contract_ingestion_runs: OK([{ id: "r1", status: "approved" }]),
      contract_clauses: ERR(),
    }) as never, "org", "c1");
    check("clauses failed clause read → ok:false", !r.ok);
  }
  {
    const r = await listContractClauses(stubClient({ contract_ingestion_runs: OK([]) }) as never, "org", "c1");
    check("clauses no operative run → ok + empty + no basis", r.ok && r.basis === null && r.clauses.length === 0);
  }
  {
    // Draft/superseded runs are never selected.
    const client = stubClient({
      contract_ingestion_runs: OK([]), // filter excludes them at query level
      contract_clauses: OK([CLAUSE]),
    });
    const r = await listContractClauses(client as never, "org", "c1");
    check("clauses query restricts to approved|ready_for_review",
      r.ok && client.calls.some((c) => c.method === "in" && c.args[0] === "status"
        && JSON.stringify(c.args[1]) === JSON.stringify(["approved", "ready_for_review"])));
  }
}

/* ---------- checked-read helpers: demo/live/failure ---------- */

function fakeDb(overrides: Record<string, unknown>) {
  return overrides as unknown as DataProvider;
}

async function helperTests() {
  // --- clauses ---
  {
    const db = fakeDb({
      contracts: {
        listClauses: async () => [{ id: "cl-1" }],
        listClausesChecked: async () => ({ ok: true, clauses: [{ id: "cl-1" }] }),
      },
    });
    const demo = await readClauseList(db, "org", "c1", true);
    const live = await readClauseList(db, "org", "c1", false);
    check("clauses demo → fixtures via listClauses", demo.ok && demo.clauses.length === 1);
    check("clauses live → checked reader", live.ok && live.clauses.length === 1);
  }
  {
    const db = fakeDb({ contracts: { listClausesChecked: async () => ({ ok: false }) } });
    const r = await readClauseList(db, "org", "c1", false);
    check("clauses failed read → ok:false (never empty)", !r.ok && r.clauses.length === 0);
  }
  {
    const db = fakeDb({ contracts: { listClauses: async () => [{ id: "cl-1" }] } });
    const r = await readClauseList(db, "org", "c1", false);
    check("clauses live without checked reader → ok:false (no silent legacy)", !r.ok);
  }
  {
    const db = fakeDb({ contracts: { listClausesChecked: async () => { throw new Error("down"); } } });
    const r = await readClauseList(db, "org", "c1", false);
    check("clauses thrown → ok:false", !r.ok);
  }

  // --- agent events (observations) ---
  {
    const db = fakeDb({
      agent: {
        listEvents: async () => [{ id: "ev-1" }],
        listEventsChecked: async () => ({ ok: true, events: [{ id: "ev-1" }], truncated: false }),
      },
    });
    const demo = await readAgentEvents(db, "org", true, { contractId: "c1" });
    const live = await readAgentEvents(db, "org", false, { contractId: "c1" });
    check("events demo → fixtures via listEvents", demo.ok && demo.events.length === 1);
    check("events live → checked reader", live.ok && live.events.length === 1);
  }
  {
    const db = fakeDb({ agent: { listEventsChecked: async () => ({ ok: true, events: [{ id: "e" }], truncated: true }) } });
    const r = await readAgentEvents(db, "org", false);
    check("events truncation propagated", r.ok && r.truncated === true);
  }
  {
    const db = fakeDb({ agent: { listEventsChecked: async () => ({ ok: false }) } });
    const r = await readAgentEvents(db, "org", false);
    check("events failed read → ok:false", !r.ok);
  }
  {
    const db = fakeDb({ agent: { listEvents: async () => [{ id: "e" }] } });
    const r = await readAgentEvents(db, "org", false);
    check("events live without checked reader → ok:false", !r.ok);
  }

  // --- activity ---
  {
    const db = fakeDb({
      activity: {
        list: async () => [{ id: "a1" }],
        listChecked: async () => ({ ok: true, activity: [{ id: "a1" }], truncated: false }),
      },
    });
    const demo = await readActivityList(db, "org", true, { contractId: "c1" });
    const live = await readActivityList(db, "org", false, { contractId: "c1" });
    check("activity demo → fixtures via list", demo.ok && demo.activity.length === 1);
    check("activity live → checked reader", live.ok && live.activity.length === 1);
  }
  {
    const db = fakeDb({ activity: { listChecked: async () => ({ ok: false }) } });
    const r = await readActivityList(db, "org", false);
    check("activity failed read → ok:false", !r.ok);
  }
  {
    const db = fakeDb({ activity: { listChecked: async () => ({ ok: true, activity: [], truncated: true }) } });
    const r = await readActivityList(db, "org", false);
    check("activity truncation propagated", r.ok && r.truncated === true && r.activity.length === 0);
  }
  {
    const db = fakeDb({ activity: { list: async () => [{ id: "a" }] } });
    const r = await readActivityList(db, "org", false);
    check("activity live without checked reader → ok:false", !r.ok);
  }
}

/* ---------- page + server-action wiring (static) ---------- */

function wiringTests() {
  const tasks = src("src/app/[locale]/app/tasks/page.tsx");
  check("tasks page reads real officer_actions", tasks.includes("listOfficerActions("));
  check("tasks page groups real statuses", tasks.includes('"waiting_for_approval"') && tasks.includes('"approved"') && tasks.includes('"completed"') && tasks.includes('"rejected"') && tasks.includes('"suggested"'));
  check("tasks page role-gates approval", tasks.includes('roleHasCapability(ctx.role, "officer.action.approve")'));
  check("tasks page reuses existing approve/reject server actions", tasks.includes("approveOfficerActionForm") && tasks.includes("rejectOfficerActionForm"));
  check("tasks page returnTo=/app/tasks", tasks.includes('returnTo="/app/tasks"'));
  check("tasks page renders truncation honestly", tasks.includes("queue.truncated"));
  check("tasks page failure → DataLoadFailed, not empty queues", tasks.includes("if (!queue.ok)"));
  check("tasks page demo path uses fixtures", tasks.includes("db.actions.list("));

  const agentActions = src("src/app/[locale]/app/agent/actions.ts");
  check("approve/reject honor allowlisted returnTo", agentActions.includes("RETURN_SURFACES") && agentActions.includes('"/app/tasks"'));
  check("returnTo falls back to /app/agent", agentActions.includes("/app/agent${conversationId"));
  check("approve path still reauthorizes server-side", agentActions.includes("approveOfficerAction(ctx, actionId)"));
  check("reject path still reauthorizes server-side", agentActions.includes("rejectOfficerAction(ctx, actionId, reason)"));

  const officerPage = src("src/app/[locale]/app/contracts/[id]/officer/page.tsx");
  check("officer page uses checked events read", officerPage.includes("readAgentEvents("));
  check("officer page reads contract-scoped officer_actions", officerPage.includes("listOfficerActions(") && officerPage.includes("contractId: id"));
  check("officer page failure → notice not empty feed", officerPage.includes("DataLoadFailed"));
  check("officer page gates approve on real capability", officerPage.includes('roleHasCapability(ctx.role, "officer.action.approve")'));
  check("officer page passes contract-scoped returnTo", officerPage.includes("/officer`"));

  const ask = src("src/components/app/officer-ask.tsx");
  check("OfficerAsk live path opens the real conversation", ask.includes("startOfficerConversation"));
  check("OfficerAsk passes contractId to conversation", ask.includes('name="contractId"'));
  check("OfficerAsk demo is an explicit preview, no fake input", ask.includes("askDemo") && !ask.includes("aria-disabled") && !ask.includes("placeholder="));

  const activity = src("src/app/[locale]/app/contracts/[id]/activity/page.tsx");
  check("activity page uses checked read", activity.includes("readActivityList("));
  check("activity page failure → notice", activity.includes("DataLoadFailed"));
  check("activity page truncation note", activity.includes("truncated"));
  check("activity page no unchecked db.activity.list", !activity.includes("db.activity.list("));

  const card = src("src/components/app/officer/action-card.tsx");
  check("badge reflects the row's actual status key", card.includes("t(`status.${action.status}`)"));
  check("held note only on approved-and-never-executed", card.includes('action.status === "approved" && !action.executedAt'));

  const overview = src("src/app/[locale]/app/contracts/[id]/page.tsx");
  check("overview uses readClauseList", overview.includes("readClauseList("));
  check("overview labels unapproved clause extraction", overview.includes('clauseBasis === "ready_for_review"') && overview.includes("unapprovedClauses"));
  check("overview uses checked events + activity", overview.includes("readAgentEvents(") && overview.includes("readActivityList("));
  check("overview reads live officer actions", overview.includes("listOfficerActions("));
  check("overview clause trace gates on clause read", overview.includes("!clauses"));
  check("overview no unchecked stub calls remain",
    !overview.includes("db.agent.listEvents(") && !overview.includes("db.activity.list(") && !overview.includes("db.contracts.listClauses("));

  const provider = src("src/data/supabase/provider.ts");
  check("provider events read officer_observations, active+acknowledged only",
    provider.includes('from("officer_observations")') && provider.includes('"active", "acknowledged"'));
  check("provider activity reads activity_log", provider.includes('from("activity_log")'));
  check("provider activity resolves contract via entity tables", provider.includes('eq("contract_id", contractId).in("id"'));
  check("provider activity honors metadata contract linkage", provider.includes("metadata") && provider.includes('contract_id'));
  check("provider obligations join clause source refs", provider.includes("obligation_source_refs(clause_id)"));
  check("provider exposes checked variants", provider.includes("listEventsChecked") && provider.includes("listChecked") && provider.includes("listClausesChecked"));
  check("provider clauses delegate to the operative-run reader", provider.includes("listContractClauses"));

  const clauses = src("src/data/supabase/clauses.ts");
  check("clauses approved baseline beats newer pending run", clauses.includes('runs.find((r) => r.status === "approved")'));
  check("clauses failed run read → ok:false, no unapproved fallback", clauses.includes("if (runError || !Array.isArray(runs)) return { ok: false }"));
  check("clauses deterministic order", clauses.includes('order("sequence_number"') && clauses.includes('order("id"'));

  // i18n — every new key exists in both locales.
  const en = JSON.parse(src("src/messages/en.json"));
  const ar = JSON.parse(src("src/messages/ar.json"));
  const needTasks = ["waiting", "held", "completed", "closed", "suggested"];
  check("tasks group keys exist en+ar",
    needTasks.every((k) => en.app.tasks.groups[k]) && needTasks.every((k) => ar.app.tasks.groups[k]));
  check("tasks truncated key en+ar", !!en.app.tasks.truncated && !!ar.app.tasks.truncated);
  check("officer contract keys en+ar",
    ["contractActions", "noContractActions", "askOpen", "askDemo"].every((k) => en.app.officer[k] && ar.app.officer[k]));
  check("activity truncated + contract.noActions en+ar",
    !!en.app.activity.truncated && !!ar.app.activity.truncated && !!en.app.contract.noActions && !!ar.app.contract.noActions);
  check("held group label is honest (approved, not completed)", en.app.tasks.groups.held.includes("not completed"));
  check("unapproved-clause label exists en+ar",
    !!en.app.contract.unapprovedClauses && !!ar.app.contract.unapprovedClauses
    && en.app.contract.unapprovedClauses.toLowerCase().includes("unapproved"));
}

async function main() {
  await queueBoundaryTests();
  mappingTests();
  await clauseBasisTests();
  await helperTests();
  wiringTests();

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
