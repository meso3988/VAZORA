/* eslint-disable @typescript-eslint/no-explicit-any */
// Hosted validation on the STAGING project (oivrwhvbvfhsslsqghuz) only:
// cycle recording + correction from the UI, unauthorized member refused by the
// server and the database, the sweep reflecting recorded cycles, and manual +
// scheduled sweeps of the same organization at the same time. No model calls.
//
// Synthetic data only: one benchmark tenant + one extra member account. Ids
// are written to QA_STATE before any test step; teardown runs in `finally`
// (organization cascade, then the exact auth users via the service role).
//
// Prerequisite: a production build made with the staging environment.
//   bash supabase/tests/with-staging.sh npm run build
//   bash supabase/tests/with-staging.sh node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/e2e-cycles-hosted.ts

import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";

const STAGING_REF = "oivrwhvbvfhsslsqghuz";
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${STAGING_REF}.supabase.co` || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("REFUSED: run through supabase/tests/with-staging.sh (staging URL and service key required)");
  process.exit(3);
}

import { seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup } from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { scheduleCycles } from "../../src/lib/officer/schedule";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";
import { addDays } from "../../src/lib/officer/time";

const PORT = Number(process.env.HOSTED_PORT ?? 3011);
const BASE = `http://localhost:${PORT}`;
const QA_DIR = join(homedir(), ".vazora-qa");
const QA_STATE = join(QA_DIR, "cycles-hosted-tenant.json");
const SHOTS = join(QA_DIR, "shots-hosted");
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;
const msgs: Record<"en" | "ar", any> = {
  en: JSON.parse(readFileSync("src/messages/en.json", "utf8")),
  ar: JSON.parse(readFileSync("src/messages/ar.json", "utf8")),
};
const results: { t: string; ok: boolean }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };
const MOBILE = { width: 390, height: 844 };
const anonClient = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

async function login(browser: Browser, email: string, password: string, locale: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
  const state = await page.context().storageState();
  await page.context().close();
  return state;
}

async function startServer(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "start", "--port", String(PORT)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", () => {});
  child.stderr!.on("data", (d) => { const s = String(d); if (/error/i.test(s)) process.stderr.write(`[server] ${s.slice(0, 300)}`); });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/en/login`)).ok) return child; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("server did not start");
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fx: any = await seedBenchmarkOrganization({ label: "hosted" });
  const state: any = { project: STAGING_REF, orgId: fx.orgId, authUserIds: [fx.userId, fx.secondUserId].filter(Boolean), createdAt: new Date().toISOString() };
  writeFileSync(QA_STATE, JSON.stringify(state));
  console.log(`QA tenant ${fx.orgId} on ${STAGING_REF} (state ${QA_STATE})`);
  let browser: Browser | null = null;
  let server: ChildProcess | null = null;
  try {
    // Extra member account (role member) for the authorization checks.
    const mc = anonClient();
    const memberEmail = `qa-hosted-member-${Date.now()}@vazora.test`;
    const memberPassword = `Qa!${randomBytes(12).toString("hex")}`;
    const { data: su, error: suErr } = await mc.auth.signUp({ email: memberEmail, password: memberPassword });
    if (suErr || !su.user || !su.session) throw new Error(`member signUp: ${suErr?.message ?? "no session (email confirmation on?)"}`);
    state.authUserIds.push(su.user.id); writeFileSync(QA_STATE, JSON.stringify(state));
    const mem = await fx.client.from("organization_members").insert({ organization_id: fx.orgId, user_id: su.user.id, role: "member" });
    if (mem.error) throw new Error(`member: ${mem.error.message}`);
    const memberId = su.user.id as string;

    const c = fx.client;
    await ensureOfficerProfile({ supabase: c, organizationId: fx.orgId });
    const ctx = (await buildOfficerContext({ supabase: c, organizationId: fx.orgId, userId: fx.userId, locale: "en" }))!;
    const today = ctx.clock.today;
    const A = fx.contracts.a;
    const { data: K } = await c.from("contracts").select("start_date, end_date").eq("id", A.contractId).single();
    await c.from("contract_obligations").update({ due_date_normalized: null, due_rule_normalized: "monthly_day_5", frequency: "monthly" }).eq("id", A.obligationId);
    const past = scheduleCycles({ dueRuleNormalized: "monthly_day_5", contractStart: K.start_date, contractEnd: K.end_date, until: today });
    if (past.length < 4) throw new Error(`need ≥4 past cycles, have ${past.length}`);
    const [first, target, raced, last] = [past[0], past[past.length - 2], past[past.length - 3], past[past.length - 1]];
    console.log(`today ${today} (${ctx.clock.timeZone}) · past cycles ${past.join(",")}`);
    const evBefore = (await c.from("evidence_items").select("id, status").eq("organization_id", fx.orgId).order("id")).data;
    const gapsBefore = (await c.from("evidence_gaps").select("id, status").eq("organization_id", fx.orgId).order("id")).data;

    const cronSecret = randomBytes(24).toString("hex");
    server = await startServer({
      CRON_SECRET: cronSecret, VAZORA_SWEEP_SECRET: "",
      VAZORA_SCHEDULED_SWEEPS: JSON.stringify([{ organizationId: fx.orgId, actorUserId: fx.userId }]),
    });
    browser = await chromium.launch();
    const ownerState = await login(browser, fx.email, fx.password, "en");
    const view = async (st: any, vp?: typeof MOBILE) => (await browser!.newContext({ storageState: st, ...(vp ? { viewport: vp } : {}) })).newPage();
    const obligationsUrl = (locale: string) => `${BASE}/${locale}/app/contracts/${A.contractId}/obligations`;
    const cycleLi = (p: Page, d: string) => p.locator(`li[data-cycle="${d}"]`);

    // ---- 1. Record one cycle from the UI (EN desktop, owner) ----
    let p = await view(ownerState);
    await p.goto(obligationsUrl("en"));
    const recordForm = cycleLi(p, target).locator("form");
    const recordFormHtml = await recordForm.evaluate((f) => f.outerHTML);
    await recordForm.locator('input[name="completedOn"]').fill(addDays(target, 1));
    await recordForm.locator('input[name="note"]').fill("Monthly summary delivered to the client PM.");
    await recordForm.locator('button[type="submit"]').click();
    await p.waitForURL(/cycleRecorded=/, { timeout: 60000 });
    rec("UI en: notice shown after recording", (await p.locator('[data-cycle-notice="recorded"]').count()) === 1);
    rec("UI en: the recorded cycle shows 'Completion recorded' and 'Recorded by you'", (await cycleLi(p, target).getAttribute("data-cycle-state")) === "recorded" && (await cycleLi(p, target).innerText()).includes(msgs.en.app.cycles.recordedBy.split(" {")[0]));
    const others = await Promise.all([first, raced, last].map((d) => cycleLi(p, d).getAttribute("data-cycle-state")));
    rec("UI en: the other cycles stay 'No completion documented'", others.every((s) => s === "none"), others.join(","));
    await p.screenshot({ path: join(SHOTS, "cycle-recorded-en.png"), fullPage: true });
    await p.context().close();
    const rows1 = (await c.from("obligation_cycle_settlements").select("id, cycle_due_date, recorded_by, completed_on, status, recorded_at").eq("obligation_id", A.obligationId)).data ?? [];
    rec("DB: exactly one record, for that cycle, actor = signed-in owner, completion date separate", rows1.length === 1 && rows1[0].cycle_due_date === target && rows1[0].recorded_by === fx.userId && rows1[0].completed_on === addDays(target, 1), JSON.stringify(rows1));
    const audit1 = (await c.from("activity_log").select("actor_user_id").eq("organization_id", fx.orgId).eq("event_type", "obligation.cycle_settled")).data ?? [];
    rec("DB: one audit row by the owner", audit1.length === 1 && audit1[0].actor_user_id === fx.userId);

    // ---- 2. Simultaneous requests for one cycle ----
    const racers = await Promise.all(Array.from({ length: 6 }, (_, i) => c.rpc("record_obligation_cycle_settlement", { p_obligation_id: A.obligationId, p_cycle_due_date: raced, p_completed_on: null, p_note: `race ${i}` })));
    const okN = racers.filter((r: any) => !r.error).length, dupN = racers.filter((r: any) => /cycle_already_settled/.test(r.error?.message ?? "")).length;
    rec("6 simultaneous requests for one cycle → 1 recorded, 5 'already recorded'", okN === 1 && dupN === 5, `${okN}/${dupN}`);

    // ---- 3. Unauthorized member: UI, server action, database ----
    const memberState = await login(browser, memberEmail, memberPassword, "en");
    p = await view(memberState, MOBILE);
    await p.goto(obligationsUrl("en"));
    const panel = p.locator('[data-section="cycle-records"]');
    rec("UI member (en mobile): told only owner/admin can record; no record/void forms", (await panel.innerText()).includes(msgs.en.app.cycles.notAuthorized) && (await panel.locator("form").count()) === 0);
    rec("UI member: sees the record attributed to 'a member'", (await cycleLi(p, target).innerText()).includes(msgs.en.app.cycles.byMember));
    // Replay the owner's record form (same server action) from the member session.
    await p.evaluate((html) => { const d = document.createElement("div"); d.innerHTML = html; document.body.appendChild(d); (d.querySelector("form") as HTMLFormElement).requestSubmit(); }, recordFormHtml.replace(/value="[^"]*" name="note"|name="note"[^>]*/, 'name="note" value="member attempt"'));
    await p.waitForURL(/cycleError=/, { timeout: 60000 }).catch(() => {});
    rec("server action refuses the member (cycleError=not_authorized)", p.url().includes("cycleError=not_authorized"), p.url().replace(BASE, ""));
    await p.screenshot({ path: join(SHOTS, "cycle-member-en-mobile.png"), fullPage: true });
    await p.context().close();
    const mcl = anonClient(); await mcl.auth.signInWithPassword({ email: memberEmail, password: memberPassword });
    const mRpc = await mcl.rpc("record_obligation_cycle_settlement", { p_obligation_id: A.obligationId, p_cycle_due_date: first, p_completed_on: null, p_note: "member" });
    const mIns = await mcl.from("obligation_cycle_settlements").insert({ organization_id: fx.orgId, obligation_id: A.obligationId, cycle_due_date: first, note: "x", recorded_by: memberId });
    const mVoid = await mcl.rpc("void_obligation_cycle_settlement", { p_settlement_id: rows1[0].id, p_reason: "member" });
    rec("database refuses the member: record, direct insert, void", /not_authorized/.test(mRpc.error?.message ?? "") && !!mIns.error && /not_authorized/.test(mVoid.error?.message ?? ""), `${mRpc.error?.message} | ${mIns.error?.code} | ${mVoid.error?.message}`);
    rec("member can read the organization's records", ((await mcl.from("obligation_cycle_settlements").select("id").eq("organization_id", fx.orgId)).data ?? []).length === 2);

    // ---- 4. Correction from the UI (AR desktop) ----
    p = await view(ownerState);
    await p.goto(obligationsUrl("ar"));
    const voidForm = cycleLi(p, target).locator("form");
    await voidForm.locator('input[name="reason"]').fill("سُجّلت على الدورة الخطأ");
    await voidForm.locator('button[type="submit"]').click();
    await p.waitForURL(/cycleVoided=/, { timeout: 60000 }).catch(() => {});
    rec("UI ar: void notice, cycle back to 'no completion', voided line kept", (await p.locator('[data-cycle-notice="voided"]').count()) === 1 && (await cycleLi(p, target).getAttribute("data-cycle-state")) === "none" && (await cycleLi(p, target).locator("[data-cycle-voided]").count()) === 1);
    const reForm = cycleLi(p, target).locator("form");
    await reForm.locator('input[name="note"]').fill("أُعيد التسجيل على الدورة الصحيحة");
    await reForm.locator('button[type="submit"]').click();
    await p.waitForURL(/cycleRecorded=/, { timeout: 60000 });
    rec("UI ar: re-recorded after the correction", (await cycleLi(p, target).getAttribute("data-cycle-state")) === "recorded");
    await p.screenshot({ path: join(SHOTS, "cycle-corrected-ar.png"), fullPage: true });
    await p.context().close();
    const hist = (await c.from("obligation_cycle_settlements").select("status, voided_by, void_reason").eq("obligation_id", A.obligationId).eq("cycle_due_date", target).order("recorded_at")).data ?? [];
    rec("DB: history kept — voided (by owner, with reason) then active", hist.length === 2 && hist[0].status === "voided" && hist[0].voided_by === fx.userId && !!hist[0].void_reason && hist[1].status === "active");
    rec("DB: void audited", ((await c.from("activity_log").select("id").eq("organization_id", fx.orgId).eq("event_type", "obligation.cycle_settlement_voided")).data ?? []).length === 1);

    // ---- 5. The sweep reflects the recorded cycles ----
    const overdueDue = async () => (await c.from("officer_observations").select("status, supporting_facts").eq("organization_id", fx.orgId).eq("dedupe_key", `overdue:${A.obligationId}`).maybeSingle()).data;
    const sA = await runContractSweep({ ctx, trigger: "manual" });
    rec("sweep (2 cycles recorded): overdue finding still on the oldest cycle without a record", sA.status === "completed" && (await overdueDue())?.supporting_facts?.due_date === first, `${sA.status} ${(await overdueDue())?.supporting_facts?.due_date}`);
    for (const d of past.slice(0, -1)) {
      if (d === target || d === raced) continue;
      const r = await c.rpc("record_obligation_cycle_settlement", { p_obligation_id: A.obligationId, p_cycle_due_date: d, p_completed_on: null, p_note: "QA backfill" });
      if (r.error) throw new Error(`settle ${d}: ${r.error.message}`);
    }
    const sB = await runContractSweep({ ctx, trigger: "manual" });
    const ob = await overdueDue();
    rec("sweep (all but the latest recorded): finding moves to the latest cycle only", sB.status === "completed" && ob?.status !== "resolved" && ob?.supporting_facts?.due_date === last, `${sB.status} ${ob?.status} ${ob?.supporting_facts?.due_date}`);
    const lo: any = await runOfficerTool(ctx, "listObligations", { contractId: A.contractId });
    rec("Officer agrees (operational date = latest unrecorded cycle)", lo.data?.[0]?.due_date_operational === last, lo.data?.[0]?.due_date_operational);
    rec("records changed no evidence status and no gap", JSON.stringify((await c.from("evidence_items").select("id, status").eq("organization_id", fx.orgId).order("id")).data) === JSON.stringify(evBefore) && JSON.stringify((await c.from("evidence_gaps").select("id, status").eq("organization_id", fx.orgId).order("id")).data) === JSON.stringify(gapsBefore));
    for (const [locale, vp] of [["ar", MOBILE], ["en", undefined]] as const) {
      p = await view(ownerState, vp);
      await p.goto(obligationsUrl(locale));
      const states = await Promise.all(past.map((d) => cycleLi(p, d).getAttribute("data-cycle-state")));
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      rec(`UI ${locale}${vp ? " mobile" : ""}: every earlier cycle recorded, latest not${vp ? ", no overflow" : ""}`, states.slice(0, -1).every((s) => s === "recorded") && states.at(-1) === "none" && (!vp || overflow <= 1), `${states.join(",")} overflow=${overflow}`);
      await p.screenshot({ path: join(SHOTS, `cycles-after-sweep-${locale}${vp ? "-mobile" : ""}.png`), fullPage: true });
      await p.context().close();
    }

    // ---- 6. Manual + scheduled sweeps of the same organization, simultaneously ----
    const cron = async (secret = cronSecret) => { const r = await fetch(`${BASE}/api/officer/sweep/scheduled`, { headers: { authorization: `Bearer ${secret}` } }); return { code: r.status, body: await r.json().catch(() => null) }; };
    rec("cron adapter: wrong secret → 401", (await cron("wrong")).code === 401);
    const statuses: string[] = [];
    for (let round = 1; round <= 4; round++) {
      const [m, s] = await Promise.all([runContractSweep({ ctx, trigger: "manual" }), cron()]);
      statuses.push(`${m.status}/${s.body?.results?.[0]?.status ?? s.code}`);
    }
    // One round through the real "Run sweep" button (EN) racing the cron call.
    p = await view(ownerState);
    await p.goto(`${BASE}/en/app/agent`);
    const [, sUi] = await Promise.all([
      (async () => { await p.getByRole("button", { name: msgs.en.app.officer?.brief?.runSweep ?? "Run sweep" }).first().click(); await p.waitForURL(/swept=/, { timeout: 120000 }); })(),
      cron(),
    ]);
    const uiStatus = new URL(p.url()).searchParams.get("swept");
    const uiText = await p.locator('[role="status"]').first().innerText().catch(() => "");
    statuses.push(`ui:${uiStatus}/${sUi.body?.results?.[0]?.status ?? sUi.code}`);
    rec("UI manual sweep shows a truthful notice (skipped is stated as such)", uiStatus === "skipped" ? uiText.includes(msgs.en.app.officer?.center?.sweptSkippedNotice?.slice(0, 30) ?? "Another sweep") : !!uiStatus);
    await p.screenshot({ path: join(SHOTS, "sweep-race-ui-en.png"), fullPage: true });
    await p.context().close();
    console.log(`rounds (manual/scheduled): ${statuses.join("  ")}`);
    const pairs = statuses.map((s) => s.replace(/^ui:/, "").split("/"));
    rec("each round: never both skipped, never an error", pairs.every(([a, b]) => !(a === "skipped" && b === "skipped") && [a, b].every((x) => ["completed", "skipped", "200"].includes(x))));
    rec("contention actually happened (at least one run was skipped by the lock)", pairs.some(([a, b]) => a === "skipped" || b === "skipped"));
    const runs = (await c.from("officer_sweep_runs").select("id, status, trigger, started_at, completed_at").eq("organization_id", fx.orgId).order("started_at")).data ?? [];
    let overlap = 0;
    for (let i = 1; i < runs.length; i++) if (!runs[i - 1].completed_at || runs[i - 1].completed_at > runs[i].started_at) overlap++;
    rec("sweep runs never overlapped in time; none left running", overlap === 0 && runs.every((r: any) => r.status !== "running"), `${runs.length} runs, overlaps ${overlap}`);
    const active = (await c.from("officer_observations").select("dedupe_key").eq("organization_id", fx.orgId).in("status", ["active", "acknowledged"])).data ?? [];
    rec("no duplicated findings after the races", new Set(active.map((o: any) => o.dedupe_key)).size === active.length, `${active.length} active`);
  } finally {
    if (browser) await browser.close();
    if (server) server.kill("SIGTERM");
    const td = await teardownBenchmarkOrganization(fx);
    const cl = await verifyBenchmarkCleanup(fx);
    const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const users: string[] = [];
    for (const id of state.authUserIds as string[]) {
      const { data } = await admin.auth.admin.getUserById(id);
      if (!data.user || !/@vazora\.test$/.test(data.user.email ?? "")) { users.push(`${id}:refused`); continue; }
      const { error } = await admin.auth.admin.deleteUser(id);
      users.push(`${id}:${error ? "FAIL " + error.message : "deleted"}`);
    }
    const leftOrg = (await admin.from("organizations").select("id").eq("id", fx.orgId)).data?.length ?? -1;
    const leftSet = (await admin.from("obligation_cycle_settlements").select("id").eq("organization_id", fx.orgId)).data?.length ?? -1;
    console.log(`CLEANUP org ${td.ok ? "deleted" : "FAIL " + td.error} ${fx.orgId} leftovers=${cl.leftovers.join(",") || "none"} (service check: org ${leftOrg}, settlements ${leftSet}) · auth users ${users.join(" ")}`);
    if (td.ok && cl.clean && leftOrg === 0 && users.every((u) => u.endsWith("deleted"))) rmSync(QA_STATE, { force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
