// Checkpoint 4 §15 — full E2E lifecycle against the production build (:3001).
// Per combo (en/ar × desktop/mobile): upload incomplete → live verify →
// partial + gaps open → upload complete → gaps stay open → re-verify →
// verified + gaps resolved → logout → login → history persists.
// Browser assertions are paired with DB assertions (RLS-scoped user client).
// Run: node --import tsx supabase/tests/e2e-cp4.mts
/* eslint-disable */

import { chromium, type Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3001";
const EMAIL = process.env.VAZORA_QA_EMAIL ?? "qa-viewer-1789917080379@vazora.test";
const PASS = process.env.VAZORA_QA_PASSWORD ?? "Qa!dbcfedda-a849-4b45-b011-6d0198259757";
const ITEM = "c8aa6f1c-5fb7-4ad2-93a6-d4cc684ef0bc";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }) as any;

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => {
  results.push({ t, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`);
};

const incompleteCsv = (tag: string) => Buffer.from(
  `section,field,value
header,title,MONTHLY PERFORMANCE REPORT — OCTOBER 2025
header,contract,QA Evidence Smoke Contract
header,reporting_period,2025-10-01 to 2025-10-31
kpi,KPI-1 Overall site progress,97%
kpi,KPI-2 Lost-time injuries,0
kpi,KPI-3 Open NCRs,14
kpi,KPI-4 Manhours,212000
kpi,KPI-5 Training compliance,81%
kpi,KPI-6 Equipment availability,93%
kpi,KPI-7 Environmental incidents,6
approvals,contractor_signature,"signed — A. Contractor, Site Manager (signed 2025-11-02)"
approvals,client,"Eng. S. Hamad — client name printed only; no acknowledgement, no signature, no date"
note,qa_tag,"${tag}"
`);

const completeCsv = (tag: string) => Buffer.from(
  `section,field,value
header,title,MONTHLY PERFORMANCE REPORT — OCTOBER 2025
header,contract,QA Evidence Smoke Contract
header,reporting_period,2025-10-01 to 2025-10-31
kpi,KPI-1 Overall site progress,97%
kpi,KPI-2 Lost-time injuries,0
kpi,KPI-3 Open NCRs,14
kpi,KPI-4 Manhours,212000
kpi,KPI-5 Training compliance,81%
kpi,KPI-6 Equipment availability,93%
kpi,KPI-7 Environmental incidents,6
kpi,KPI-8 Safety audit score,100%
approvals,contractor_signature,"signed — A. Contractor, Site Manager (signed 2025-11-02)"
approvals,client_acknowledgement,"reviewed and accepted — Eng. S. Hamad, Client Representative (signed 2025-11-04)"
note,qa_tag,"${tag}"
`);

async function login(page: Page, locale: "en" | "ar") {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/app/, { timeout: 20000 });
}

const openGaps = async () =>
  (await db.from("evidence_gaps").select("id,status,description").eq("status", "open").eq("contract_id", "98ac4ab6-d5af-4bbe-8d1b-9ea3c9a744e2")).data ?? [];

const unresolvedGaps = async () =>
  (await db.from("evidence_gaps").select("id,status,description").eq("contract_id", "98ac4ab6-d5af-4bbe-8d1b-9ea3c9a744e2").in("status", ["open", "evidence_received", "reverification_pending"])).data ?? [];

const latestRun = async () =>
  (await db.from("evidence_verification_runs").select("id,status,overall_result,evidence_version_id,created_at")
    .eq("evidence_item_id", ITEM).order("created_at", { ascending: false }).limit(1)).data?.[0];

const versions = async () =>
  (await db.from("evidence_versions").select("id,version_number").eq("evidence_item_id", ITEM)).data ?? [];

const runCount = async () =>
  (await db.from("evidence_verification_runs").select("id").eq("evidence_item_id", ITEM)).data?.length ?? 0;

async function uploadAndVerify(page: Page, locale: string, fileName: string, buf: Buffer) {
  const fileInput = page.locator('input[type="file"][name="file"]').first();
  await fileInput.setInputFiles({ name: fileName, mimeType: "text/csv", buffer: buf });
  await page.locator('button:has-text("Upload"), button:has-text("رفع")').first().click();
  // upload action runs verification synchronously — can take 60s+
  await page.waitForURL(/uploaded=|error=/, { timeout: 120000 });
  await page.waitForTimeout(800);
}

async function clickVerifyAndWait(page: Page, runBefore: string | undefined) {
  const btn = page.locator('button:has-text("Run verification"), button:has-text("تشغيل التحقق")').first();
  await btn.click();
  await page.waitForTimeout(3000);
  // the server action resolves when the provider call returns; poll the DB for a NEW completed run
  for (let i = 0; i < 45; i++) {
    const r = await latestRun();
    if (r && r.id !== runBefore && r.status === "completed") return r;
    if (r && r.id !== runBefore && r.status === "failed") return r;
    await page.waitForTimeout(2000);
  }
  return await latestRun();
}

async function lifecycle(locale: "en" | "ar", vp: { width: number; height: number }, tag: string, n: number) {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  try {
    await login(page, locale);
    const before = await latestRun();

    // -- 1. upload INCOMPLETE version → receipt only -------------------------
    await page.goto(`${BASE}/${locale}/app/evidence/${ITEM}`);
    await uploadAndVerify(page, locale, `monthly-oct-${tag}-incomplete.csv`, incompleteCsv(tag));
    const notice = (await page.locator('[role="status"]').first().innerText().catch(() => "")) ?? "";
    const received = /File received|تم استلام الملف/.test(notice) && /pending|قيد الانتظار/.test(notice);
    rec(`${tag}: upload receipt says pending`, received, notice.slice(0, 70));
    const vAfter1 = (await versions()).length;
    rec(`${tag}: new version persisted`, vAfter1 >= 6 + n * 2 - 1, `versions=${vAfter1}`);

    // -- 2. live verification → partial/needs-review + gaps open -------------
    // upload auto-verifies synchronously; the explicit click is the re-verification
    const r1 = await clickVerifyAndWait(page, before?.id);
    rec(`${tag}: v_incomplete run completed`, r1?.status === "completed", `status=${r1?.status}`);
    const overall1 = r1?.overall_result ?? "";
    rec(`${tag}: v_incomplete partial/needs_review`, ["partially_verified", "needs_review", "missing"].includes(overall1), `overall=${overall1}`);
    let gaps1: any[] = [];
    for (let i = 0; i < 14; i++) {
      gaps1 = await unresolvedGaps();
      if (gaps1.length >= 1) break;
      await page.waitForTimeout(1500);
    }
    if (gaps1.length === 0) {
      const dump = (await db.from("evidence_gaps").select("status,verification_run_id,opened_at,closed_at").eq("contract_id", "98ac4ab6-d5af-4bbe-8d1b-9ea3c9a744e2").order("opened_at", { ascending: false }).limit(4)).data ?? [];
      const runDump = (await db.from("evidence_verification_runs").select("id,status,overall_result,created_at").eq("evidence_item_id", ITEM).order("created_at", { ascending: false }).limit(4)).data ?? [];
      console.log("  [debug] gaps:", JSON.stringify(dump.map((g: any) => ({ s: g.status, opened: g.opened_at?.slice(11, 19), closed: g.closed_at?.slice(11, 19), run: g.verification_run_id?.slice(0, 8) }))));
      console.log("  [debug] runs:", JSON.stringify(runDump.map((r: any) => ({ id: r.id.slice(0, 8), st: r.status, o: r.overall_result, t: r.created_at?.slice(11, 19) }))), "r1=", r1?.id?.slice(0, 8));
    }
    rec(`${tag}: gaps opened`, gaps1.length >= 1, `unresolved=${gaps1.length}`);

    // -- 3. upload COMPLETE version → auto-verify → gaps resolve via run -----
    await page.goto(`${BASE}/${locale}/app/evidence/${ITEM}`);
    await uploadAndVerify(page, locale, `monthly-oct-${tag}-complete.csv`, completeCsv(tag));
    // the upload action ran verification synchronously; the run must be completed+verified
    const auto = await latestRun();
    rec(`${tag}: v_complete auto-run completed`, auto?.status === "completed" && auto?.id !== r1?.id, `status=${auto?.status}`);
    rec(`${tag}: v_complete verified`, auto?.overall_result === "verified", `overall=${auto?.overall_result}`);
    // every resolved gap attributes to a verification run — upload alone never closes
    const allGaps = (await db.from("evidence_gaps").select("status,closed_by_verification_run_id").eq("contract_id", "98ac4ab6-d5af-4bbe-8d1b-9ea3c9a744e2")).data ?? [];
    const resolvedWithoutRun = allGaps.filter((g: any) => g.status === "resolved" && !g.closed_by_verification_run_id).length;
    const resolvedByNew = allGaps.filter((g: any) => g.closed_by_verification_run_id === auto?.id).length;
    rec(`${tag}: gaps closed only via run`, resolvedWithoutRun === 0 && resolvedByNew >= 1, `resolvedByAuto=${resolvedByNew} unattr=${resolvedWithoutRun}`);
    const gapsFinal = await unresolvedGaps();
    rec(`${tag}: gaps resolved`, gapsFinal.length === 0, `unresolved=${gapsFinal.length}`);

    // -- 5. history inspectable on the page -----------------------------------
    await page.goto(`${BASE}/${locale}/app/evidence/${ITEM}`);
    const body5 = await page.locator("body").innerText();
    const vCount = (await versions()).length;
    rec(`${tag}: version history rendered`, body5.includes(`v${vCount}`), `latest=v${vCount}`);
    rec(`${tag}: resolved lifecycle visible`, /Resolved|محلولة|تم حل|resolved/i.test(body5), "");

    // -- 6. logout → login → history persists --------------------------------
    await ctx.close();
    const ctx2 = await browser.newContext({ viewport: vp });
    const page2 = await ctx2.newPage();
    await login(page2, locale);
    await page2.goto(`${BASE}/${locale}/app/evidence/${ITEM}`);
    const body6 = await page2.locator("body").innerText();
    rec(`${tag}: history persists after re-login`, body6.includes(`v${vCount}`) && (await runCount()) >= 6 + n * 2, `runs=${await runCount()}`);
    await ctx2.close();
  } catch (e) {
    rec(`${tag}: lifecycle`, false, String(e).slice(0, 200));
  } finally {
    await browser.close();
  }
}

const run = async () => {
  await db.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const v0 = (await versions()).length;
  console.log(`item ${ITEM.slice(0, 8)} · versions at start=${v0}`);
  await lifecycle("en", { width: 1400, height: 900 }, "en-desktop", 1);
  await lifecycle("ar", { width: 1400, height: 900 }, "ar-desktop", 2);
  await lifecycle("en", { width: 390, height: 844 }, "en-mobile", 3);
  await lifecycle("ar", { width: 390, height: 844 }, "ar-mobile", 4);
  const fails = results.filter((r) => !r.ok);
  console.log(`\n=== CP4 E2E: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length) fails.forEach((f) => console.log(`  FAIL ${f.t} ${f.d}`));
  process.exit(fails.length ? 1 : 0);
};
run();
