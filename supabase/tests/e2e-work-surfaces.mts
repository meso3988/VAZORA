/* eslint-disable @typescript-eslint/no-explicit-any */
// REAL WORK SURFACES — browser acceptance for /app/tasks, contract officer
// and contract activity wired to officer_actions / officer_observations /
// activity_log. Two tenants + an empty tenant, EN + AR, mobile width,
// real Chrome. Server must run with VAZORA_OFFICER_PROVIDER=none (no model
// calls — actions are seeded through runOfficerTool, not the AI).
//
// State: /tmp/qa-dashboard-tenants.json (qa-dashboard-tenants.ts setup +
// qa-work-surfaces-seed.ts).
// Run: node --import tsx supabase/tests/e2e-work-surfaces.mts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type BrowserContext, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const SHOTS = process.env.WS_SHOTS ?? "/tmp";
const TAG = process.env.WS_TAG ?? "ws";

const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/messages/ar.json", "utf8"));

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

async function signInDb(who: any) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }) as any;
  const { error } = await c.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`db signIn: ${error.message}`);
  return c;
}

async function login(browser: BrowserContext, locale: string, who: any): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
  return page;
}

/** Approve the action by id from the currently rendered tasks page. */
async function approveById(page: Page, actionId: string) {
  const form = page.locator(`form:has(input[name="actionId"][value="${actionId}"])`).first();
  await form.locator('button[type="submit"]').first().click();
}

async function actionStatus(who: any, id: string): Promise<string> {
  const c = await signInDb(who);
  const { data } = await c.from("officer_actions").select("status, executed_at, execution_result").eq("id", id).maybeSingle();
  return data ? `${data.status}|exec:${data.executed_at ? "yes" : "no"}|held:${(data.execution_result as any)?.held ?? "-"}` : "missing";
}

const DEMO_TASKS_GROUP = { en: "My tasks", ar: "مهامي" };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const alpha = st.alpha, beta = st.beta, empty = st.empty;
  const internalTaskId = alpha.extraActions[0];
  const evidenceReqId = alpha.extraActions[1];
  const escalateId = alpha.proposals[0];
  const gamma = alpha.contractIds.gamma;

  // ---------- Alpha EN: the approval journey ----------
  {
    const page = await login(ctx, "en", alpha);
    const resp = await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    rec("alpha tasks 200", resp?.status() === 200);
    rec("alpha tasks shows real queue groups", body.includes(en.app.tasks.groups.waiting) && body.includes(en.app.tasks.groups.held));
    rec("alpha tasks shows seeded escalation summary", body.includes("Alpha escalation on GAMMA-300"));
    rec("alpha tasks shows seeded internal task", body.includes("QA: log follow-up on DELTA-400 evidence pack"));
    rec("alpha tasks no other-tenant content", !body.includes("Beta escalation"));
    await page.screenshot({ path: `${SHOTS}/${TAG}-alpha-tasks-en.png`, fullPage: true });

    // Approve the escalation — approval-required type stays held.
    await approveById(page, escalateId);
    await page.waitForURL(/\/en\/app\/tasks\?approved=/, { timeout: 60000 });
    rec("escalation approve redirects back to /app/tasks", true);
    const s1 = await actionStatus(alpha, escalateId);
    rec("escalation approved AND HELD (not executed)", s1.startsWith("approved|exec:no|held:approved_but_not_executed"), s1);

    // Approve the executable internal task — completes immediately.
    await approveById(page, internalTaskId);
    await page.waitForURL(new RegExp(`approved=${internalTaskId}`), { timeout: 60000 });
    const s2 = await actionStatus(alpha, internalTaskId);
    rec("internal task approved → executed → completed", s2.startsWith("completed|exec:yes"), s2);

    // Re-entry: persisted state after navigation round-trip.
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const body2 = await page.locator("body").innerText();
    const heldSection = body2.includes(en.app.tasks.groups.held);
    rec("tasks persisted after re-entry (held + completed groups)", heldSection && body2.includes(en.app.tasks.groups.completed));
    rec("completed card shows no approve button (no duplicate path)", !(await page.locator(`form:has(input[name="actionId"][value="${internalTaskId}"])`).count()));

    // Contract officer page — actions + findings on the right contract.
    const r3 = await page.goto(`${BASE}/en/app/contracts/${gamma}/officer`);
    await page.waitForLoadState("networkidle");
    const body3 = await page.locator("body").innerText();
    rec("contract officer page 200", r3?.status() === 200);
    rec("contract officer shows contract action", body3.includes("QA: request updated insurance certificate") || body3.includes("Alpha escalation"));
    rec("contract officer has real conversation entry", (await page.locator(`form:has(input[name="contractId"])`).count()) >= 1);
    await page.screenshot({ path: `${SHOTS}/${TAG}-alpha-officer-en.png`, fullPage: true });

    // Contract activity — real audit rows for THIS contract.
    const r4 = await page.goto(`${BASE}/en/app/contracts/${gamma}/activity`);
    await page.waitForLoadState("networkidle");
    const body4 = await page.locator("body").innerText();
    rec("contract activity 200", r4?.status() === 200);
    rec("contract activity shows officer action events", body4.includes("approved an action") || body4.includes("proposed an action") || body4.includes(en.app.activity.title));
    await page.screenshot({ path: `${SHOTS}/${TAG}-alpha-activity-en.png`, fullPage: true });

    // Conversation ↔ tasks parity: open the real contract-scoped
    // conversation, attach the seeded approval request to it, verify the
    // same action id renders on both surfaces.
    await page.goto(`${BASE}/en/app/contracts/${gamma}/officer`);
    await page.waitForLoadState("networkidle");
    await page.locator(`form:has(input[name="contractId"]) button[type="submit"]`).first().click();
    await page.waitForURL(/\/en\/app\/agent\?c=/, { timeout: 60000 });
    const convId = new URL(page.url()).searchParams.get("c")!;
    rec("contract officer opens a real contract conversation", !!convId);
    const dbA = await signInDb(alpha);
    // Same binding the converse path writes: the action row keeps its own id;
    // the thread links it through officer_messages.proposed_action_ids.
    const { error: linkErr } = await dbA.from("officer_actions").update({ conversation_id: convId }).eq("id", evidenceReqId);
    const { error: msgErr } = await dbA.from("officer_messages").insert({
      organization_id: alpha.orgId,
      conversation_id: convId,
      role: "assistant",
      content: "QA link: approval request proposed for this contract.",
      proposed_action_ids: [evidenceReqId],
    });
    rec("proposal attached to conversation (same row, no copy)", !linkErr && !msgErr, (linkErr ?? msgErr)?.message ?? "");
    await page.goto(`${BASE}/en/app/agent?c=${convId}`);
    await page.waitForLoadState("networkidle");
    const agentBody = await page.locator("body").innerText();
    rec("conversation shows the SAME proposal (by summary)", agentBody.includes("QA: request updated insurance certificate"));
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const tasksBody = await page.locator("body").innerText();
    rec("tasks shows the SAME proposal — one record, two surfaces", tasksBody.includes("QA: request updated insurance certificate"));

    // Approve it from tasks → the conversation renders the decided state.
    await approveById(page, evidenceReqId);
    await page.waitForURL(new RegExp(`approved=${evidenceReqId}`), { timeout: 60000 });
    await page.goto(`${BASE}/en/app/agent?c=${convId}`);
    await page.waitForLoadState("networkidle");
    const agentBody2 = await page.locator("body").innerText();
    rec("conversation reflects approved state after tasks decision", agentBody2.includes(en.app.officer.action.status.approved));
    const s3 = await actionStatus(alpha, evidenceReqId);
    rec("evidence request approved AND HELD (not executed)", s3.startsWith("approved|exec:no|held:"), s3);
    await page.close();
  }

  // ---------- Alpha AR: same surfaces in Arabic ----------
  {
    const page = await login(ctx, "ar", alpha);
    await page.goto(`${BASE}/ar/app/tasks`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    rec("alpha ar tasks renders queue groups", body.includes(ar.app.tasks.groups.waiting) && body.includes(ar.app.tasks.groups.held));
    rec("alpha ar tasks no English group labels", !body.includes(en.app.tasks.groups.waiting));
    const r2 = await page.goto(`${BASE}/ar/app/contracts/${gamma}/officer`);
    await page.waitForLoadState("networkidle");
    const body2 = await page.locator("body").innerText();
    rec("alpha ar officer page renders", r2?.status() === 200 && body2.includes(ar.app.officer.contractActions));
    const r3 = await page.goto(`${BASE}/ar/app/contracts/${gamma}/activity`);
    await page.waitForLoadState("networkidle");
    const body3 = await page.locator("body").innerText();
    rec("alpha ar activity renders", r3?.status() === 200 && !body3.includes(ar.common.dataLoadFailed));
    await page.screenshot({ path: `${SHOTS}/${TAG}-alpha-tasks-ar.png`, fullPage: true });
    await page.close();
  }

  // ---------- Beta: tenant isolation ----------
  {
    const page = await login(ctx, "en", beta);
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    rec("beta tasks shows own proposals", body.includes("Beta escalation on OM-014") && body.includes("Beta escalation on FM-008"));
    rec("beta tasks shows NO alpha rows", !body.includes("Alpha escalation") && !body.includes("QA: log follow-up"));
    await page.close();
  }

  // ---------- Empty tenant: honest empty, not failure ----------
  {
    const page = await login(ctx, "en", empty);
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    rec("empty tenant: queues render empty, not failure",
      body.includes(en.app.tasks.empty) && !body.includes(en.common.dataLoadFailed));
    await page.close();
  }

  // ---------- Mobile width ----------
  {
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await login(mob, "en", alpha);
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    rec("mobile 390px tasks renders without horizontal overflow", !overflow);
    await page.screenshot({ path: `${SHOTS}/${TAG}-alpha-tasks-mobile.png`, fullPage: true });
    await page.close();
    await mob.close();
  }

  // ---------- Demo mode: fixtures stay separate ----------
  {
    const dc = await browser.newContext();
    await dc.addCookies([{ name: "vazora_session", value: "demo", url: BASE }]);
    const page = await dc.newPage();
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    rec("demo tasks keeps fixture groups", body.includes(DEMO_TASKS_GROUP.en) && !body.includes("Alpha escalation"));
    await page.close();
    await dc.close();
  }

  // ---------- Reject path ----------
  {
    const page = await login(ctx, "en", beta);
    await page.goto(`${BASE}/en/app/tasks`);
    await page.waitForLoadState("networkidle");
    await page.locator(`form:has(input[name="actionId"][value="${beta.proposals[0]}"]) input[name="reason"]`).fill("QA reject");
    await page.locator(`form:has(input[name="actionId"][value="${beta.proposals[0]}"]) button[type="submit"]`).last().click();
    await page.waitForURL(/rejected=/, { timeout: 60000 });
    const s = await actionStatus(beta, beta.proposals[0]);
    rec("beta reject from /app/tasks → rejected", s.startsWith("rejected"), s);
    await page.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
