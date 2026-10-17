/* eslint-disable @typescript-eslint/no-explicit-any */
// Officer record-level citation discipline — deterministic tests (no model,
// no network). Proven defect (r7 gate, 2026-09-29): answers asserting an
// obligation's due/unassigned/status state could not cite it because
// getAssignments returned [] citations and getContractHealth dropped the
// obligation citations its own sweep had persisted on each observation.
// Fix: both tools now emit the actual obligation records' citations.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-record-citations.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runOfficerTool } from "../../src/lib/officer/tools";
import { buildOfficerSystemPrompt } from "../../src/lib/officer/prompt";
import { buildClock } from "../../src/lib/officer/time";
import type { OfficerContext } from "../../src/lib/officer/context";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

const ORG = "org-a";
const CONTRACT = "11111111-1111-4111-8111-111111111111";
const OBLIGATION = "22222222-2222-4222-8222-222222222222";
const OBLIGATION_AR = "33333333-3333-4333-8333-333333333333";

/** Proxy-backed supabase stub: each table resolves to its canned rows. */
function stubCtx(tables: Record<string, unknown>): OfficerContext {
  const supabase = {
    from: (t: string) => {
      const res = { data: tables[t] ?? [] };
      const chain: any = new Proxy({}, {
        get(_t2, prop) {
          if (prop === "then") return (resolve: any) => Promise.resolve({ data: res.data, error: null }).then(resolve);
          if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: (res.data as any[])?.[0] ?? null, error: null });
          return () => chain;
        },
      });
      return chain;
    },
  };
  return {
    supabase: supabase as never,
    organizationId: ORG,
    userId: "user-1",
    role: "owner",
    clock: buildClock(new Date("2026-09-29T12:00:00Z"), "Asia/Riyadh"),
    locale: "en",
    organizationName: "Benchmark Org",
    officer: { displayName: "Officer", preferredLanguage: "auto", tone: "professional", enabled: true },
  };
}

async function assignmentCitations() {
  const ctx = stubCtx({
    contract_obligations: [
      { id: OBLIGATION, contract_id: CONTRACT, title: "Quarterly security compliance statement", owner_role_suggested: "Project Manager" },
      // Arabic titles must survive as citation labels unchanged.
      { id: OBLIGATION_AR, contract_id: CONTRACT, title: "تقرير مستوى الخدمة الشهري", owner_role_suggested: null },
    ],
    obligation_assignment_suggestions: [
      // An approved owner on the first obligation; the second stays unassigned.
      { id: "s1", obligation_id: OBLIGATION, suggestion_kind: "owner", suggested_role: "Project Manager", suggested_person_id: null, suggested_person_name: null, approved: true, decided_by: "u", decided_at: "2026-09-29T00:00:00Z" },
    ],
    contracts: [{ id: CONTRACT, contract_number: "EPSILON-500" }],
  });
  const r = await runOfficerTool(ctx, "getAssignments", {});
  check("getAssignments succeeds", r.ok === true, JSON.stringify(r).slice(0, 200));
  const cites = (r as any).citations ?? [];
  const obCites = cites.filter((c: any) => c.target === "obligation");
  check("getAssignments emits one obligation citation per row", obCites.length === 2, JSON.stringify(cites));
  check("getAssignments obligation cite carries id + contract link",
    obCites.some((c: any) => c.id === OBLIGATION && c.contractId === CONTRACT && c.href === `/app/contracts/${CONTRACT}/obligations`));
  check("getAssignments cites the Arabic-titled obligation with its real id",
    obCites.some((c: any) => c.id === OBLIGATION_AR && c.label === "تقرير مستوى الخدمة الشهري"));
  check("getAssignments also emits the contract citation for row claims",
    cites.some((c: any) => c.target === "contract" && c.id === CONTRACT && c.label === "EPSILON-500"));
}

async function healthCitations() {
  const ctx = stubCtx({
    contracts: [{ id: CONTRACT, contract_number: "EPSILON-500", title: "Security services — Western region", status: "active", created_at: "2026-09-01T00:00:00Z" }],
    officer_sweep_runs: [{ started_at: "2026-09-29T06:00:00Z", completed_at: "2026-09-29T06:01:00Z", as_of_date: "2026-09-29", status: "completed", failures: [] }],
    contract_obligations: [{ id: OBLIGATION, contract_id: CONTRACT, review_status: "approved", activation_status: "active", updated_at: "2026-09-29T00:00:00Z" }],
    evidence_gaps: [],
    evidence_verification_discrepancies: [],
    obligation_evidence_requirements: [],
    officer_observations: [{
      id: "obs-1", contract_id: CONTRACT, obligation_id: OBLIGATION, evidence_requirement_id: null,
      kind: "unassigned", priority: 1, priority_reason: [], title: "Obligation has no confirmed owner",
      detail: null, citations: [{ target: "obligation", id: OBLIGATION, label: "Quarterly security compliance statement" }],
      status: "active", dedupe_key: "unassigned:x", first_detected_at: "2026-09-28T00:00:00Z", last_seen_at: "2026-09-29T06:00:00Z",
      acknowledged_by: null, resolved_at: null, severity: "medium", time_bucket: "today",
      recommended_action_type: null, supporting_facts: {}, reopen_count: 0,
    }],
  });
  const r = await runOfficerTool(ctx, "getContractHealth", {});
  check("getContractHealth succeeds", r.ok === true, JSON.stringify(r).slice(0, 300));
  const cites = (r as any).citations ?? [];
  check("getContractHealth keeps the contract citation",
    cites.some((c: any) => c.target === "contract" && c.id === CONTRACT));
  check("getContractHealth emits the obligation citation stored on the issue",
    cites.some((c: any) => c.target === "obligation" && c.id === OBLIGATION && c.contractId === CONTRACT),
    JSON.stringify(cites));
  const issues = (r as any).data?.contracts?.[0]?.issues ?? [];
  check("issue rows expose obligationId for downstream citing",
    issues[0]?.obligationId === OBLIGATION, JSON.stringify(issues).slice(0, 200));
}

function promptRules() {
  const p = buildOfficerSystemPrompt({ ctx: stubCtx({}), memory: [], contractScope: null });
  check("prompt: obligation-level claims cite the obligation, not the contract stand-in",
    /cites the obligation, not only its contract/.test(p));
  check("prompt: deadline change on a named contract looks up obligations first",
    /list that contract's obligations before asking anything/.test(p));
  check("prompt: single eligible obligation is named, not asked about",
    /name it and clarify only what is still unclear/.test(p));
  check("prompt: several eligible obligations may still be disambiguated",
    /several could match, asking which one is correct/.test(p));
  check("prompt: contract value is not exposure",
    /Contract value is not financial exposure/.test(p));
  check("prompt: value may only explain what is missing, never answer the exposure question",
    /Never present it as the answer to the exposure question/.test(p));
}

function wiring() {
  const tools = src("src/lib/officer/tools.ts");
  check("getAssignments still enforces org scope on the contract lookup",
    /from\("contracts"\)[\s\S]{0,120}eq\("organization_id", ctx\.organizationId\)/.test(tools));
  check("getContractHealth issue citations come from the stored observation, never fabricated",
    /i\.citations \?\? \[\]/.test(tools));
}

async function main() {
  await assignmentCitations();
  await healthCitations();
  promptRules();
  wiring();
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length} passed · ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
