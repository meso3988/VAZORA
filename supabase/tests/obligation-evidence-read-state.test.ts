// Obligation / evidence / review read-state — repository-boundary and
// composed-read tests with test-only dependency injection.
//
// Scope: obligations.list / obligations.getById, evidence.list and the
// dependent reads used to construct evidence results (matrix, inbox, item
// detail), and the review page's direct contract_obligations /
// obligation_assignment_suggestions reads.
//
// Simulated failures are NOT a real Supabase outage test — the repository
// boundary and the composed-read functions are the units under test, with
// a stub supabase client injected via the optional `client` parameter.
// Failure-branch rendering is asserted statically; live navigation is
// covered by the browser smoke suite.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/obligation-evidence-read-state.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readEvidenceList, readObligation, readObligationList } from "../../src/data/checked-reads";
import {
  getContractEvidenceMatrix,
  getEvidenceItemDetail,
  listEvidenceInbox,
} from "../../src/data/supabase/evidence-detail";
import type { DataProvider } from "../../src/data/repositories";
import type { Obligation } from "../../src/domain/types";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const OBLIGATION = { id: "ob-1", title: { en: "Deliver monthly report" } } as unknown as Obligation;
const UUID = "11111111-2222-3333-4444-555555555555";
const FOREIGN = "99999999-8888-7777-6666-555555555555";
const DEMO_ID = "ob_nds_dc_001"; // demo fixture ids are not UUIDs

/* ---------- repository-boundary fakes ---------- */

type ListResult = "populated" | "empty" | "error" | "throw" | "fail-then-populated";
function fakeListDb(result: ListResult) {
  const state = { checkedCalls: 0, legacyCalls: 0 };
  const db = {
    obligations: {
      list: async () => {
        state.legacyCalls++;
        return [OBLIGATION];
      },
      listChecked: async () => {
        state.checkedCalls++;
        const r = result === "fail-then-populated" ? (state.checkedCalls === 1 ? "error" : "populated") : result;
        if (r === "error") return { ok: false as const };
        if (r === "throw") throw new Error("network down");
        return { ok: true as const, obligations: r === "empty" ? [] : [OBLIGATION] };
      },
    },
    evidence: {
      list: async () => [{ id: "ev-1" }],
      listChecked: async () => {
        state.checkedCalls++;
        const r = result === "fail-then-populated" ? (state.checkedCalls === 1 ? "error" : "populated") : result;
        if (r === "error") return { ok: false as const };
        if (r === "throw") throw new Error("network down");
        return { ok: true as const, evidence: r === "empty" ? [] : [{ id: "ev-1" }] };
      },
    },
  } as unknown as DataProvider;
  return { db, state };
}

function fakeGetDb(result: "found" | "not_found" | "error" | "throw" | "fail-then-found", demoFixture = false) {
  const state = { checkedCalls: 0, queried: [] as string[] };
  const db = {
    obligations: {
      getById: async (_org: string, id: string) => {
        state.queried.push(id);
        return demoFixture ? OBLIGATION : null;
      },
      getByIdChecked: async (_org: string, id: string) => {
        state.checkedCalls++;
        state.queried.push(id);
        const r = result === "fail-then-found" ? (state.checkedCalls === 1 ? "error" : "found") : result;
        if (r === "error") return { status: "unavailable" as const };
        if (r === "throw") throw new Error("network down");
        return r === "found"
          ? { status: "found" as const, obligation: OBLIGATION }
          : { status: "not_found" as const };
      },
    },
  } as unknown as DataProvider;
  return { db, state };
}

async function boundaryTests() {
  // --- obligations list ---
  {
    const { db, state } = fakeListDb("populated");
    const r = await readObligationList(db, "org", false);
    check("obligations.list populated → ok + rows", r.ok && r.obligations.length === 1);
    check("obligations.list populated used listChecked", state.checkedCalls === 1 && state.legacyCalls === 0);
  }
  {
    const { db } = fakeListDb("empty");
    const r = await readObligationList(db, "org", false);
    check("obligations.list successful-empty → ok:true + []", r.ok && r.obligations.length === 0);
  }
  {
    const { db } = fakeListDb("error");
    const r = await readObligationList(db, "org", false);
    check("obligations.list returned error → ok:false", !r.ok);
  }
  {
    const { db } = fakeListDb("throw");
    const r = await readObligationList(db, "org", false);
    check("obligations.list thrown error → ok:false", !r.ok);
  }
  {
    const { db } = fakeListDb("fail-then-populated");
    const r1 = await readObligationList(db, "org", false);
    const r2 = await readObligationList(db, "org", false);
    check("obligations.list recovery after failure", !r1.ok && r2.ok && r2.obligations.length === 1);
  }
  {
    // Live provider without listChecked → explicit failure, never silent legacy list().
    const { db, state } = fakeListDb("populated");
    delete (db.obligations as unknown as Record<string, unknown>).listChecked;
    const r = await readObligationList(db, "org", false);
    check("obligations live without listChecked → ok:false (no silent fallback)", !r.ok && state.legacyCalls === 0);
  }
  {
    // Demo sessions read fixtures via list() even when listChecked exists.
    const { db, state } = fakeListDb("populated");
    const r = await readObligationList(db, "demo-org", true);
    check("obligations demo → fixtures via list()", r.ok && state.legacyCalls === 1 && state.checkedCalls === 0);
  }

  // --- obligations getById ---
  {
    const { db } = fakeGetDb("found");
    const r = await readObligation(db, "org", UUID, false);
    check("obligations.getById found", r.status === "found" && r.obligation === OBLIGATION);
  }
  {
    const { db } = fakeGetDb("not_found");
    const r = await readObligation(db, "org", UUID, false);
    check("obligations.getById not_found", r.status === "not_found");
  }
  {
    const { db } = fakeGetDb("error");
    const r = await readObligation(db, "org", UUID, false);
    check("obligations.getById returned error → unavailable", r.status === "unavailable");
  }
  {
    const { db } = fakeGetDb("throw");
    const r = await readObligation(db, "org", UUID, false);
    check("obligations.getById thrown error → unavailable", r.status === "unavailable");
  }
  {
    const { db } = fakeGetDb("fail-then-found");
    const r1 = await readObligation(db, "org", UUID, false);
    const r2 = await readObligation(db, "org", UUID, false);
    check("obligations.getById recovery", r1.status === "unavailable" && r2.status === "found");
  }
  {
    // Foreign-tenant id: scoped query finds nothing → not_found, no disclosure.
    const { db } = fakeGetDb("not_found");
    const r = await readObligation(db, "org-a", FOREIGN, false);
    check("obligations foreign-tenant id → not_found", r.status === "not_found");
  }
  {
    // Non-UUID live id → not_found without a query; demo ids skip the check.
    const { db, state } = fakeGetDb("found");
    const r = await readObligation(db, "org", "not-a-uuid", false);
    check("obligations live non-UUID → not_found, no query", r.status === "not_found" && state.queried.length === 0);
    const rd = await readObligation(db, "demo-org", DEMO_ID, true);
    check("obligations demo non-UUID fixture id queried", state.queried.includes(DEMO_ID) && rd.status === "not_found");
  }
  {
    const { db, state } = fakeGetDb("found", true);
    const rd = await readObligation(db, "demo-org", DEMO_ID, true);
    check("obligations demo fixture found via getById", rd.status === "found" && state.checkedCalls === 0);
  }
  {
    const { db } = fakeGetDb("found");
    delete (db.obligations as unknown as Record<string, unknown>).getByIdChecked;
    const r = await readObligation(db, "org", UUID, false);
    check("obligations live without getByIdChecked → unavailable", r.status === "unavailable");
  }

  // --- evidence list ---
  {
    const { db } = fakeListDb("populated");
    const r = await readEvidenceList(db, "org", false);
    check("evidence.list populated → ok + rows", r.ok && r.evidence.length === 1);
  }
  {
    const { db } = fakeListDb("empty");
    const r = await readEvidenceList(db, "org", false);
    check("evidence.list successful-empty → ok:true + []", r.ok && r.evidence.length === 0);
  }
  {
    const { db } = fakeListDb("error");
    const r = await readEvidenceList(db, "org", false);
    check("evidence.list returned error → ok:false", !r.ok);
  }
  {
    const { db } = fakeListDb("throw");
    const r = await readEvidenceList(db, "org", false);
    check("evidence.list thrown error → ok:false", !r.ok);
  }
  {
    const { db } = fakeListDb("fail-then-populated");
    const r1 = await readEvidenceList(db, "org", false);
    const r2 = await readEvidenceList(db, "org", false);
    check("evidence.list recovery after failure", !r1.ok && r2.ok && r2.evidence.length === 1);
  }
  {
    const { db, state } = fakeListDb("populated");
    delete (db.evidence as unknown as Record<string, unknown>).listChecked;
    const r = await readEvidenceList(db, "org", false);
    check("evidence live without listChecked → ok:false (no silent fallback)", !r.ok);
    void state;
  }
  {
    const { db } = fakeListDb("populated");
    const r = await readEvidenceList(db, "demo-org", true);
    check("evidence demo → fixtures via list()", r.ok && r.evidence.length === 1);
  }
}

/* ---------- composed-read stub client ---------- */

// A minimal thenable query chain: .from(t).select(...).eq(...).in(...)… is
// awaitable and resolves to the preset response for that table. A response
// value may be an array consumed one response per query to that table.
type Res = { data: unknown; error: { message: string } | null };
function stubClient(responses: Record<string, Res | Res[]>) {
  const queues = new Map<string, Res[]>();
  return {
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
            return () => chain;
          },
        },
      ) as Record<string | symbol, unknown>;
      return chain;
    },
  } as never;
}

const OK = (data: unknown): Res => ({ data, error: null });
const ERR = (): Res => ({ data: null, error: { message: "injected failure" } });

async function composedReadTests() {
  // --- getContractEvidenceMatrix ---
  {
    const r = await getContractEvidenceMatrix("org", "c1", stubClient({ contract_obligations: OK([]) }));
    check("matrix empty contract → ok:true + []", r.ok && r.rows.length === 0);
  }
  {
    const r = await getContractEvidenceMatrix("org", "c1", stubClient({
      contract_obligations: OK([{ id: "ob1", title: "t", requirement_text: "req", frequency: null, due_rule_raw: null, due_date_normalized: null, ai_payload: {} }]),
      obligation_evidence_requirements: OK([{ id: "rq1", obligation_id: "ob1", name: "n", description: "d", evidence_type: "doc", required: true }]),
    }));
    check("matrix populated → ok:true + row", r.ok && r.rows.length === 1 && r.rows[0].requirement.id === "rq1");
  }
  {
    // Dependent failure: checks read fails → not "no verification".
    const r = await getContractEvidenceMatrix("org", "c1", stubClient({
      contract_obligations: OK([{ id: "ob1", title: "t", requirement_text: "req", frequency: null, due_rule_raw: null, due_date_normalized: null, ai_payload: {} }]),
      obligation_evidence_requirements: OK([{ id: "rq1", obligation_id: "ob1", name: "n", description: "d", evidence_type: "doc", required: true }]),
      evidence_verification_checks: ERR(),
    }));
    check("matrix dependent checks failure → ok:false (not zero checks)", !r.ok);
  }
  {
    // Dependent failure: gaps read fails → not "no gaps".
    const r = await getContractEvidenceMatrix("org", "c1", stubClient({
      contract_obligations: OK([{ id: "ob1", title: "t", requirement_text: "req", frequency: null, due_rule_raw: null, due_date_normalized: null, ai_payload: {} }]),
      obligation_evidence_requirements: OK([{ id: "rq1", obligation_id: "ob1", name: "n", description: "d", evidence_type: "doc", required: true }]),
      evidence_gaps: ERR(),
    }));
    check("matrix dependent gaps failure → ok:false (not zero gaps)", !r.ok);
  }
  {
    // Discrepancy read failure → not "no discrepancy" (would fabricate a clean state).
    const r = await getContractEvidenceMatrix("org", "c1", stubClient({
      contract_obligations: OK([{ id: "ob1", title: "t", requirement_text: "req", frequency: null, due_rule_raw: null, due_date_normalized: null, ai_payload: {} }]),
      obligation_evidence_requirements: OK([{ id: "rq1", obligation_id: "ob1", name: "n", description: "d", evidence_type: "doc", required: true }]),
      evidence_verification_discrepancies: ERR(),
    }));
    check("matrix dependent discrepancies failure → ok:false", !r.ok);
  }
  {
    // Thrown client failure → ok:false.
    const throwing = { from: () => { throw new Error("network down"); } } as never;
    const r = await getContractEvidenceMatrix("org", "c1", throwing);
    check("matrix thrown error → ok:false", !r.ok);
  }

  // --- listEvidenceInbox ---
  {
    const r = await listEvidenceInbox("org", stubClient({ evidence_items: OK([]) }));
    check("inbox empty → ok:true + []", r.ok && r.rows.length === 0);
  }
  {
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", status: "pending", created_at: "2025-01-01" };
    const r = await listEvidenceInbox("org", stubClient({ evidence_items: OK([item]) }));
    check("inbox populated → row with effectiveStatus", r.ok && r.rows.length === 1 && typeof r.rows[0].effectiveStatus === "string");
  }
  {
    // Dependent failure: gaps read fails → not "zero open gaps".
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", status: "pending", created_at: "2025-01-01" };
    const r = await listEvidenceInbox("org", stubClient({ evidence_items: OK([item]), evidence_gaps: ERR() }));
    check("inbox dependent gaps failure → ok:false", !r.ok);
  }
  {
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", status: "pending", created_at: "2025-01-01" };
    const r = await listEvidenceInbox("org", stubClient({ evidence_items: OK([item]), evidence_verification_discrepancies: ERR() }));
    check("inbox dependent discrepancies failure → ok:false", !r.ok);
  }
  {
    const throwing = { from: () => { throw new Error("network down"); } } as never;
    const r = await listEvidenceInbox("org", throwing);
    check("inbox thrown error → ok:false", !r.ok);
  }

  // --- getEvidenceItemDetail ---
  {
    const r = await getEvidenceItemDetail("org", "e1", stubClient({ evidence_items: OK(null) }));
    check("detail missing item → not_found", r.status === "not_found");
  }
  {
    const r = await getEvidenceItemDetail("org", "e1", stubClient({ evidence_items: ERR() }));
    check("detail item read error → unavailable", r.status === "unavailable");
  }
  {
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", evidence_type: "doc", status: "pending", created_by: "u", created_at: "2025-01-01" };
    const r = await getEvidenceItemDetail("org", "e1", stubClient({ evidence_items: OK(item) }));
    check("detail found → status:found with detail", r.status === "found" && r.detail.id === "e1");
  }
  {
    // Dependent failure: versions read fails → not "no versions".
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", evidence_type: "doc", status: "pending", created_by: "u", created_at: "2025-01-01" };
    const r = await getEvidenceItemDetail("org", "e1", stubClient({ evidence_items: OK(item), evidence_versions: ERR() }));
    check("detail dependent versions failure → unavailable", r.status === "unavailable");
  }
  {
    // Dependent failure: verification runs read fails → not "no verification".
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", evidence_type: "doc", status: "pending", created_by: "u", created_at: "2025-01-01" };
    const r = await getEvidenceItemDetail("org", "e1", stubClient({ evidence_items: OK(item), evidence_verification_runs: ERR() }));
    check("detail dependent runs failure → unavailable", r.status === "unavailable");
  }
  {
    const item = { id: "e1", contract_id: "c1", obligation_id: null, title: "Invoice", evidence_type: "doc", status: "pending", created_by: "u", created_at: "2025-01-01" };
    const r = await getEvidenceItemDetail("org", "e1", stubClient({ evidence_items: OK(item), evidence_verification_discrepancies: ERR() }));
    check("detail dependent discrepancies failure → unavailable", r.status === "unavailable");
  }
  {
    const throwing = { from: () => { throw new Error("network down"); } } as never;
    const r = await getEvidenceItemDetail("org", "e1", throwing);
    check("detail thrown error → unavailable", r.status === "unavailable");
  }
}

/* ---------- consumer wiring + review safety (static) ---------- */

function wiringTests() {
  const obligationsPage = src("src/app/[locale]/app/contracts/[id]/obligations/page.tsx");
  check("obligations page uses readObligationList", obligationsPage.includes("readObligationList("));
  check("obligations page renders failure notice", obligationsPage.includes("DataLoadFailed"));
  check("obligations page has no unchecked db.obligations.list", !obligationsPage.includes("db.obligations.list("));

  const contractEvidence = src("src/app/[locale]/app/contracts/[id]/evidence/page.tsx");
  check("contract evidence uses readEvidenceList + readObligationList",
    contractEvidence.includes("readEvidenceList(") && contractEvidence.includes("readObligationList("));
  check("contract evidence gates sections on read failure",
    contractEvidence.includes("!evidenceData || !obligationData"));
  check("contract evidence matrix failure renders notice", contractEvidence.includes("matrixRead.ok"));
  check("contract evidence no unchecked db.obligations/evidence.list",
    !contractEvidence.includes("db.obligations.list(") && !contractEvidence.includes("db.evidence.list("));

  const overview = src("src/app/[locale]/app/contracts/[id]/page.tsx");
  check("overview uses readObligationList + readEvidenceList",
    overview.includes("readObligationList(") && overview.includes("readEvidenceList("));
  check("overview ingestion reads check errors",
    overview.includes("if (error) return { ok: false as const }") && overview.includes("if (countError) return { ok: false as const }"));
  check("overview hides IngestionControls on failed reads", overview.includes("!latestRunRead.ok || !summaryRead.ok"));
  check("overview no unchecked db.obligations/evidence.list",
    !overview.includes("db.obligations.list(") && !overview.includes("db.evidence.list("));

  const globalEvidence = src("src/app/[locale]/app/evidence/page.tsx");
  check("global evidence uses readEvidenceList", globalEvidence.includes("readEvidenceList("));
  check("global evidence inbox failure renders notice", globalEvidence.includes("!inboxRead.ok"));
  check("global evidence no unchecked db.evidence.list", !globalEvidence.includes("db.evidence.list("));

  const inspector = src("src/app/[locale]/app/evidence/[id]/page.tsx");
  check("inspector handles unavailable before notFound",
    inspector.indexOf('"unavailable"') < inspector.indexOf('"not_found"'));
  check("inspector renders DataLoadFailed on unavailable", inspector.includes("DataLoadFailed"));

  // Review page — the board must not render from unavailable data.
  const review = src("src/app/[locale]/app/contracts/[id]/review/page.tsx");
  check("review checks both query errors", review.includes("obResult.error") && review.includes("suggResult.error"));
  check("review failure returns before ReviewBoard (no false all-reviewed)",
    review.indexOf("reviewDataLoadFailed") < review.indexOf("<ReviewBoard"));
  check("review failure path does not render ReviewBoard conditionally",
    !/ok\s*&&\s*<ReviewBoard|!.*\?\s*<ReviewBoard/.test(review));
  check("review catches thrown query errors", review.includes(".catch(() => null)"));

  // Server-side write gate — the notice is not the only protection:
  // activateContract re-reads obligations and refuses on error/zero-approved.
  const actions = src("src/app/[locale]/app/contracts/[id]/review-actions.ts");
  check("activateContract refuses on read error (err=read)", actions.includes("err=read"));
  check("activateContract requires approved.length && unresolved===0",
    actions.includes("!approved.length || unresolved > 0"));

  // i18n — both locales, distinct from empty-state copy.
  const en = JSON.parse(src("src/messages/en.json"));
  const ar = JSON.parse(src("src/messages/ar.json"));
  check("en dataLoadFailed + reviewDataLoadFailed exist",
    typeof en.common.dataLoadFailed === "string" && typeof en.common.reviewDataLoadFailed === "string");
  check("ar dataLoadFailed + reviewDataLoadFailed exist",
    typeof ar.common.dataLoadFailed === "string" && typeof ar.common.reviewDataLoadFailed === "string");
  check("en/ar failure notices differ",
    en.common.dataLoadFailed !== ar.common.dataLoadFailed &&
    en.common.reviewDataLoadFailed !== ar.common.reviewDataLoadFailed);
  check("failure notice differs from empty-state semantics",
    !en.common.dataLoadFailed.toLowerCase().includes("no evidence yet"));
}

async function main() {
  await boundaryTests();
  await composedReadTests();
  wiringTests();

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}

main();
