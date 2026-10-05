/* eslint-disable @typescript-eslint/no-explicit-any */
// Post-analysis navigation — does the browser receive the "analysis=ok"
// redirect after a long extraction? Replays the recorded extraction response
// through qa-replay-stub.mts (no model call) on a fresh QA contract.
// Observes the URL every second (no reliance on the "load" event).
// Run: AN_LABEL=delay84 AN_WAIT_S=200 QA_BASE=http://localhost:3008 node --import tsx supabase/tests/e2e-analysis-navigation.mts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const who = st.empty;
const BASE = process.env.QA_BASE ?? "http://localhost:3008";
const LABEL = process.env.AN_LABEL ?? "run";
const WAIT_S = Number(process.env.AN_WAIT_S ?? 200);
const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));

async function main() {
  const c: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: who.email, password: who.password });
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  const events: string[] = [];
  page.on("requestfailed", (r) => events.push(`requestfailed ${r.method()} ${r.url().slice(0, 80)} ${r.failure()?.errorText}`));
  page.on("console", (m) => { if (m.type() === "error") events.push(`console.error ${m.text().slice(0, 160)}`); });
  await page.goto(`${BASE}/en/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/en\/app/, { timeout: 60000 });

  const number = `QA-NAV-${LABEL}`.toUpperCase();
  await page.goto(`${BASE}/en/app/contracts/new`);
  await page.locator('input[name="title"]').fill(`QA navigation ${LABEL} (bench-en-svc)`);
  await page.locator('input[name="contractNumber"]').fill(number);
  await page.locator('input[name="startDate"]').fill("2026-09-01");
  await page.locator('input[name="endDate"]').fill("2027-08-31");
  await page.locator('form button[type="submit"]').last().click();
  await page.waitForURL(/\/en\/app\/contracts(\?|$)/, { timeout: 60000 });
  await page.locator(`tbody a:has-text("${number}")`).first().click();
  await page.waitForURL(/\/en\/app\/contracts\/[0-9a-f-]{36}/, { timeout: 60000 });
  const contractId = page.url().match(/contracts\/([0-9a-f-]{36})/)![1];
  await page.locator('input[type="file"]').first().setInputFiles("supabase/tests/fixtures/bench-en-svc.docx");
  await page.getByRole("button", { name: en.app.documents.upload, exact: true }).click();
  await page.waitForURL(/uploaded=/, { timeout: 120000 });

  const t0 = Date.now();
  await page.getByRole("button", { name: en.app.ingestion.analyze, exact: true }).click();
  let seenAt: number | null = null;
  let runDoneAt: number | null = null;
  for (let s = 0; s < WAIT_S; s++) {
    await page.waitForTimeout(1000);
    if (!seenAt && /analysis=/.test(page.url())) seenAt = Date.now() - t0;
    if (!runDoneAt) {
      const { data } = await c.from("contract_ingestion_runs").select("status").eq("contract_id", contractId).order("created_at", { ascending: false }).limit(1);
      if (data?.[0] && ["ready_for_review", "failed"].includes(data[0].status)) runDoneAt = Date.now() - t0;
    }
    if (seenAt && runDoneAt) break;
  }
  const notice = await page.locator("main").innerText();
  const shown = notice.includes(en.app.ingestion.readyHint);
  console.log(JSON.stringify({ label: LABEL, contractId, runCompletedAfterMs: runDoneAt, redirectSeenAfterMs: seenAt, finalUrl: page.url().replace(BASE, ""), readyNoticeShown: shown, browserEvents: events }, null, 2));
  await page.screenshot({ path: `/tmp/an-${LABEL}.png`, fullPage: true });
  await browser.close();
  process.exit(seenAt && shown ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
