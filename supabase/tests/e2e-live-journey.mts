/* eslint-disable @typescript-eslint/no-explicit-any */
// LIVE delivery journey — one real extraction + one real Officer turn.
// Server: QA build with VAZORA_AI_BASE_URL → qa-model-proxy.mts (budget and
// request ceiling enforced there), VAZORA_EXTRACTION_MAX_OUTPUT_TOKENS set,
// VAZORA_OFFICER_MAX_RETRIES=0. Tenant: the empty QA organization.
//
// UI upload → real extraction → raw output vs the frozen reference (6
// obligations, bench-en-svc) → human review in the UI → activation →
// obligation states → one live Officer question → sign out / in → persisted.
//
// Review rule, fixed BEFORE seeing output: approve a candidate whose source
// clause maps to a reference obligation's clause; reject any other candidate
// with a note; no edits. Raw extraction quality is scored before review.
// Any failure is recorded and the run stops; nothing is retried.
//
// Run: QA_BASE=http://localhost:3007 node --import tsx supabase/tests/e2e-live-journey.mts

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const who = st.empty;
const BASE = process.env.QA_BASE ?? "http://localhost:3007";
const OUT = process.env.LJ_OUT ?? "/tmp/live-journey";
mkdirSync(OUT, { recursive: true });
const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/messages/ar.json", "utf8"));
const GT = JSON.parse(readFileSync("supabase/tests/fixtures/bench-en-svc.ground-truth.json", "utf8"));
const CONTRACT_NO = "QA-SVC-001";
const QUESTION = "For contract QA-SVC-001, list the active obligations with their next due date and the evidence each one requires. Cite the records.";

const results: { t: string; ok: boolean; d?: string }[] = [];
const log = (s: string) => { console.log(s); appendFileSync(`${OUT}/journey.log`, s + "\n"); };
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };
const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
const proxy = () => { try { return JSON.parse(readFileSync(`${OUT}/proxy-state.json`, "utf8")); } catch { return null; } };
function stop(reason: string): never {
  log(`STOP — ${reason}`);
  save("results.json", { results, stoppedAt: reason, proxy: proxy() });
  process.exit(1);
}

async function db() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as any;
  const { error } = await c.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`db sign-in: ${error.message}`);
  return c;
}

async function login(page: Page, locale: string) {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
}

const clauseOf = (o: any) => String(o.ai_payload?.source_clause_number ?? o.source_clause ?? "").trim();
/** Reference clause a candidate maps to: exact, or a sub-clause of it (10.4 → 10). */
const refFor = (clause: string) => GT.obligations.find((g: any) => clause === g.clause || clause.startsWith(`${g.clause}.`)) ?? null;

async function main() {
  log(`=== LIVE JOURNEY ${new Date().toISOString()} base=${BASE} tenant=${who.orgId}`);
  const c = await db();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await login(page, "en");

  // 1. Create the contract in the UI (the create action returns to the list).
  //    A first attempt already created it through this same form before
  //    failing on the redirect expectation (0 model requests); reuse it.
  const { data: existing } = await c.from("contracts").select("id").eq("organization_id", who.orgId).eq("contract_number", CONTRACT_NO);
  if (!existing?.length) {
    await page.goto(`${BASE}/en/app/contracts/new`);
    await page.locator('input[name="title"]').fill("QA Synthetic Services Contract (bench-en-svc)");
    await page.locator('input[name="contractNumber"]').fill(CONTRACT_NO);
    await page.locator('input[name="clientName"]').fill("Synthetic Client Authority");
    await page.locator('input[name="startDate"]').fill("2026-09-01");
    await page.locator('input[name="endDate"]').fill("2027-08-31");
    await page.locator('form button[type="submit"]').last().click();
    await page.waitForURL(/\/en\/app\/contracts(\?|$)/, { timeout: 60000 });
  }
  await page.goto(`${BASE}/en/app/contracts`);
  await page.locator(`tbody a:has-text("${CONTRACT_NO}")`).first().click();
  await page.waitForURL(/\/en\/app\/contracts\/[0-9a-f-]{36}/, { timeout: 60000 });
  const contractId = page.url().match(/contracts\/([0-9a-f-]{36})/)![1];
  rec("contract created from the UI and opened from the list", !!contractId, `${contractId}${existing?.length ? " (created by the first attempt)" : ""}`);

  // 2. Upload the synthetic contract from the UI (once; attempt 2 uploaded it
  //    and attempt 3 added a duplicate copy before this guard existed).
  const { data: priorDocs } = await c.from("contract_documents").select("id").eq("organization_id", who.orgId).eq("contract_id", contractId);
  if (!priorDocs?.length) {
    await page.locator('input[type="file"]').first().setInputFiles("supabase/tests/fixtures/bench-en-svc.docx");
    await page.getByRole("button", { name: en.app.documents.upload, exact: true }).click();
    await page.waitForURL(/uploaded=/, { timeout: 120000 });
  }
  const { data: docs } = await c.from("contract_documents").select("id, file_name, file_size, created_at").eq("organization_id", who.orgId).eq("contract_id", contractId).order("created_at");
  rec("document uploaded from the UI and stored", (docs ?? []).length >= 1 && docs.every((d: any) => d.file_name === "bench-en-svc.docx"),
    `${docs?.length} stored (the extraction used the first; a second identical copy came from a test-script rerun)`);
  await page.screenshot({ path: `${OUT}/01-uploaded.png`, fullPage: true });

  // 3. Real extraction (exactly one attempt — never a second one).
  const { data: priorRuns } = await c.from("contract_ingestion_runs").select("id, status").eq("organization_id", who.orgId).eq("contract_id", contractId);
  let analysis: string | null = null;
  if (priorRuns?.length) {
    // Attempt 2 performed the one approved extraction (proxy request #1); the
    // browser missed its redirect. Reuse that run; do not click Analyze again.
    log(`extraction already performed (runs: ${JSON.stringify(priorRuns)}); not re-running`);
    await page.goto(`${BASE}/en/app/contracts/${contractId}`);
    await page.waitForLoadState("networkidle");
    analysis = priorRuns[0].status === "failed" ? "fail" : "ok";
    const p = proxy();
    rec("extraction made exactly one model request in total", p?.sent === 1, `proxy sent=${p?.sent}`);
  } else {
    const before = proxy();
    await page.getByRole("button", { name: en.app.ingestion.analyze, exact: true }).click();
    await page.waitForURL(/analysis=/, { timeout: 300000 });
    analysis = new URL(page.url()).searchParams.get("analysis");
    const after = proxy();
    rec("extraction made exactly one model request", (after?.sent ?? 0) - (before?.sent ?? 0) === 1, `proxy sent ${before?.sent} → ${after?.sent}`);
  }
  const { data: runs } = await c.from("contract_ingestion_runs").select("*").eq("organization_id", who.orgId).eq("contract_id", contractId).order("created_at", { ascending: false });
  const run = runs?.[0];
  save("ingestion-run.json", runs);
  await page.screenshot({ path: `${OUT}/02-analysis.png`, fullPage: true });
  if (analysis !== "ok" || !run || run.status === "failed") {
    rec("extraction completed", false, `analysis=${analysis} run=${run?.status} error=${run?.error_code ?? ""} ${run?.error_message ?? ""}`);
    stop("extraction failed — recorded, not retried");
  }
  rec("extraction completed (run ready for review)", run.status === "ready_for_review", `run status ${run.status}`);

  // 4. Raw extraction vs the frozen reference — BEFORE any human review.
  const { data: raw } = await c.from("contract_obligations")
    .select("id, title, requirement_text, obligation_type, frequency, due_rule_raw, due_date_normalized, due_rule_normalized, financial_condition, penalty_condition, payment_linked, external_dependency, owner_role_suggested, ai_confidence, needs_source_review, review_status, ai_payload, obligation_source_refs(clause_id, page_number, source_snippet), obligation_evidence_requirements(name, required)")
    .eq("organization_id", who.orgId).eq("contract_id", contractId).order("created_at", { ascending: true });
  save("raw-extraction-obligations.json", raw);
  const candidates: { id: string; title: string; clause: string; ref: string | null; o: any }[] = (raw ?? []).map((o: any) => ({ id: o.id, title: o.title, clause: clauseOf(o), ref: refFor(clauseOf(o))?.clause ?? null, o }));
  const comparison = GT.obligations.map((g: any) => {
    const hits = candidates.filter((x) => x.ref === g.clause);
    const h = hits[0]?.o;
    return {
      referenceClause: g.clause, reference: g.requirement, matched: hits.length > 0, candidates: hits.map((x) => `${x.clause}: ${x.title}`),
      fields: h ? {
        frequency: { ref: g.frequency, got: h.frequency, agree: (g.frequency ?? null) === (h.frequency ?? null) },
        payment_linked: { ref: g.payment_linked, got: h.payment_linked, agree: g.payment_linked == null || g.payment_linked === h.payment_linked },
        financial: { ref: g.financial, got: h.financial_condition ?? h.penalty_condition, agree: (g.financial != null) === !!(h.financial_condition || h.penalty_condition) },
        external_dependency: { ref: g.external_dependency, got: h.external_dependency, agree: (g.external_dependency != null) === !!h.external_dependency },
        evidence: { ref: g.evidence, got: (h.obligation_evidence_requirements ?? []).map((e: any) => e.name) },
        source: { clauseRecorded: !!clauseOf(h), snippet: (h.obligation_source_refs ?? [])[0]?.source_snippet ?? null },
      } : null,
    };
  });
  const unmatched = candidates.filter((x) => !x.ref).map((x) => `${x.clause || "(no clause)"}: ${x.title}`);
  save("raw-vs-reference.json", { reference: "supabase/tests/fixtures/bench-en-svc.ground-truth.json (frozen)", candidates: candidates.length, matchedReference: comparison.filter((r: any) => r.matched).length, of: GT.obligations.length, unmatchedCandidates: unmatched, comparison });
  log(`RAW: ${candidates.length} candidates · reference matched ${comparison.filter((r: any) => r.matched).length}/${GT.obligations.length} · unmatched candidates ${unmatched.length}`);
  for (const r of comparison) log(`  ref §${r.referenceClause} ${r.matched ? "MATCHED" : "MISSED"} ${r.candidates.join(" | ")}`);
  for (const u of unmatched) log(`  candidate without reference: ${u}`);

  // 5. Human review in the UI (pre-declared rule; no edits).
  const decisions: { id: string; title: string; clause: string; decision: "approve" | "reject" }[] = candidates.map((x) => ({ id: x.id, title: x.title, clause: x.clause, decision: x.ref ? "approve" : "reject" }));
  save("review-decisions.json", decisions);
  for (const d of decisions) {
    await page.goto(`${BASE}/en/app/contracts/${contractId}/review`);
    await page.waitForLoadState("networkidle");
    await page.locator("main button").filter({ hasText: new RegExp(`^\\s*${en.app.review.cats.all}\\s*\\d+\\s*$`) }).first().click();
    await page.locator("ul button").filter({ hasText: d.title }).first().click();
    if (d.decision === "approve") {
      await page.locator(`form:has(input[name="obligationId"][value="${d.id}"]):not(:has(input[name="note"]))`).getByRole("button", { name: en.app.review.actions.approve }).click();
    } else {
      await page.getByRole("button", { name: en.app.review.actions.reject, exact: true }).first().click();
      const f = page.locator(`form:has(input[name="obligationId"][value="${d.id}"]):has(input[name="note"])`);
      await f.locator('input[name="note"]').fill("QA review: no corresponding obligation in the synthetic contract reference");
      await f.getByRole("button", { name: en.app.review.actions.reject }).click();
    }
    await page.waitForLoadState("networkidle");
  }
  const { data: reviewed } = await c.from("contract_obligations").select("id, review_status, activation_status").eq("contract_id", contractId).eq("organization_id", who.orgId);
  const approvedIds = decisions.filter((d) => d.decision === "approve").map((d) => d.id);
  rec("review decisions persisted exactly as decided in the UI",
    (reviewed ?? []).every((r: any) => r.review_status === (approvedIds.includes(r.id) ? "approved" : "rejected")),
    JSON.stringify((reviewed ?? []).map((r: any) => r.review_status)));
  if (!approvedIds.length) stop("no candidate matched the reference — nothing to activate");

  // 6. Activation from the UI.
  await page.goto(`${BASE}/en/app/contracts/${contractId}/review`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: en.app.review.actions.activate }).click();
  await page.waitForURL(/activated=1/, { timeout: 60000 });
  const { data: act } = await c.from("contract_obligations").select("id, review_status, activation_status").eq("contract_id", contractId).eq("organization_id", who.orgId);
  rec("activation: approved obligations active, rejected ones not",
    (act ?? []).every((r: any) => (r.review_status === "approved") === (r.activation_status === "active")), JSON.stringify((act ?? []).map((r: any) => `${r.review_status}/${r.activation_status}`)));

  // 7. Obligation states (EN + AR) — lifecycle / deadline / evidence.
  for (const locale of ["en", "ar"] as const) {
    if (locale === "ar") await page.goto(`${BASE}/ar/app/contracts/${contractId}/obligations`);
    else await page.goto(`${BASE}/en/app/contracts/${contractId}/obligations`);
    await page.waitForLoadState("networkidle");
    const rows = page.locator("tbody tr");
    const n = await rows.count();
    const states: string[] = [];
    for (let i = 0; i < n; i++) {
      const cell = rows.nth(i).locator("td").last();
      states.push(`${await cell.locator("[data-ob-lifecycle]").getAttribute("data-ob-lifecycle")}/${await cell.locator("[data-ob-deadline]").getAttribute("data-ob-deadline")}/${await cell.locator("[data-ob-evidence]").getAttribute("data-ob-evidence")}`);
    }
    const verifiedWord = (locale === "ar" ? ar : en).status.verified;
    const body = await page.locator("main").innerText();
    rec(`${locale}: ${n} activated obligations shown with separate states`, n === approvedIds.length && states.every((s) => s.startsWith("active/") && !s.endsWith("/verified")), states.join(" · "));
    rec(`${locale}: no "${verifiedWord}" for obligations with no verified evidence`, !body.includes(verifiedWord));
    await page.screenshot({ path: `${OUT}/03-obligations-${locale}.png`, fullPage: true });
  }

  // 8. One live Officer question on the activated contract.
  const pBefore = proxy();
  await page.goto(`${BASE}/en/app/contracts/${contractId}/officer`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: en.app.officer.askOpen }).click();
  await page.waitForURL(/\/en\/app\/agent\?c=/, { timeout: 60000 });
  const conv = new URL(page.url()).searchParams.get("c")!;
  await page.locator('textarea[name="question"]').fill(QUESTION);
  await page.locator('form:has(textarea[name="question"]) button[type="submit"]').click();
  await page.waitForURL((u) => u.searchParams.get("c") === conv && !/approved=|proposed=/.test(u.search), { timeout: 240000 });
  await page.waitForLoadState("networkidle");
  const errorParam = new URL(page.url()).searchParams.get("error");
  const pAfter = proxy();
  const { data: msgs } = await c.from("officer_messages").select("role, content, citations, tool_invocations, provider, model, usage_tokens_input, usage_tokens_output, created_at").eq("conversation_id", conv).order("created_at", { ascending: true });
  save("officer-conversation.json", msgs);
  const answer = (msgs ?? []).find((m: any) => m.role === "assistant");
  rec("officer: answered without error", !errorParam && !!answer, errorParam ? `error=${errorParam}` : `${String(answer?.content ?? "").slice(0, 160)}…`);
  rec("officer: model requests for the turn within the ceiling", (pAfter?.sent ?? 0) - (pBefore?.sent ?? 0) <= 8, `proxy sent ${pBefore?.sent} → ${pAfter?.sent}`);
  const cited = Array.isArray(answer?.citations) ? answer.citations : [];
  rec("officer: answer cites records of this contract", cited.some((x: any) => x.contractId === contractId || x.id === contractId), `${cited.length} citations`);
  const { count: actionsCreated } = await c.from("officer_actions").select("id", { count: "exact", head: true }).eq("organization_id", who.orgId);
  rec("officer: a read-only question created no actions", (actionsCreated ?? 0) === 0, `actions=${actionsCreated}`);
  await page.screenshot({ path: `${OUT}/04-officer-answer.png`, fullPage: true });

  // 9. Sign out, sign in, results persisted.
  await page.getByRole("button", { name: en.app.nav.signOut }).first().click();
  await page.waitForURL(/\/(en|ar)(\/login|\/?$|\?)/, { timeout: 60000 });
  await login(page, "en");
  await page.goto(`${BASE}/en/app/contracts/${contractId}/obligations`);
  await page.waitForLoadState("networkidle");
  rec("after sign-in: activated obligations persisted", (await page.locator("tbody tr [data-ob-lifecycle='active']").count()) === approvedIds.length);
  await page.goto(`${BASE}/en/app/agent?c=${conv}`);
  await page.waitForLoadState("networkidle");
  const convBody = await page.locator("main").innerText();
  rec("after sign-in: conversation and answer persisted", convBody.includes(QUESTION.slice(0, 40)) && !!answer && convBody.includes(String(answer.content).slice(0, 30)));
  await page.screenshot({ path: `${OUT}/05-after-relogin.png`, fullPage: true });

  await browser.close();
  save("results.json", { contractId, conversationId: conv, results, proxy: proxy() });
  const failed = results.filter((r) => !r.ok);
  log(`\n${results.length - failed.length}/${results.length} passed · proxy ${JSON.stringify(proxy())}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { log(`ERROR ${e?.stack ?? e}`); save("results.json", { results, error: String(e), proxy: proxy() }); process.exit(1); });
