// Phase 4A.1 — focused browser regression against the production build.
// Proves the benchmark-hardening pass did not change what users see:
// conversation, citations, actions, Command Center, approval UI.
// Matrix: en/ar × desktop/mobile. Real Chrome via Playwright.
// Run: node --import tsx supabase/tests/e2e-4a1-regression.mts
/* eslint-disable */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, "qa-officer-scenarios.json"), "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3003";
const EMAIL = fx.login.email as string;
const PASS = fx.login.password as string;
const OM = fx.contracts.om.id as string;

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => {
  results.push({ t, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`);
};
const text = (p: Page) => p.locator("body").innerText();

async function login(page: Page, locale: "en" | "ar") {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASS);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 30000 });
}

async function suite(locale: "en" | "ar", viewport: { width: number; height: number }, tag: string) {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport, locale: locale === "ar" ? "ar-SA" : "en-US" });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 120)}`));
  const ar = locale === "ar";

  try {
    await login(page, locale);
    rec(`${tag}: login`, page.url().includes(`/${locale}/app`));

    const dir = await page.locator("html").getAttribute("dir");
    rec(`${tag}: dir=${dir}`, dir === (ar ? "rtl" : "ltr"));

    // ---- Command Center (dashboard): observations + approval card ----------
    await page.goto(`${BASE}/${locale}/app/dashboard`);
    await page.waitForLoadState("networkidle");
    const dash = await text(page);
    rec(`${tag}: command center renders`, dash.length > 200, `${dash.length} chars`);
    // Seeded sweep facts must surface (contract numbers are locale-neutral).
    rec(`${tag}: observations visible`, dash.includes("FM-008") || dash.includes("OM-014"),
      [...new Set(["FM-008", "OM-014", "OPS-021"].filter((n) => dash.includes(n)))].join(","));
    rec(`${tag}: approval card visible`,
      /approval|الموافقة|موافقة/i.test(dash), "waiting-for-approval section");
    // Approval UI lives on the Command Center — the seeded proposal must
    // expose human Approve/Reject controls (AI proposes, human approves).
    const approveBtns = await page.locator("button")
      .filter({ hasText: ar ? /^\s*(موافقة|رفض)\s*$/ : /^\s*(Approve|Reject)\s*$/i }).count();
    rec(`${tag}: approval controls present`, approveBtns >= 2, `${approveBtns} controls`);

    // ---- Contract-scoped Officer page -------------------------------------
    await page.goto(`${BASE}/${locale}/app/contracts/${OM}/officer`);
    await page.waitForLoadState("networkidle");
    const off = await text(page);
    rec(`${tag}: contract officer page renders`, off.length > 120, `${off.length} chars`);

    // ---- Conversation (agent thread) + citations --------------------------
    await page.goto(`${BASE}/${locale}/app/agent`);
    await page.waitForLoadState("networkidle");
    // A fresh tenant has no conversation — start one via the product control.
    if (await page.locator("textarea").count() === 0) {
      await page.locator("form button[type=submit]")
        .filter({ hasText: ar ? /محادثة جديدة|جديدة/ : /New conversation/i }).first().click();
      await page.waitForURL(/\/app\/agent\?c=/, { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("networkidle");
    }
    const composer = page.locator("textarea").first();
    rec(`${tag}: composer present`, await composer.count() > 0);

    // A real grounded turn through the PRODUCT path (not the benchmark path).
    let answered = false;
    let reply = "";
    const before = new Set((await text(page)).split("\n").map((l) => l.trim()).filter(Boolean));
    const linksBefore = await page.locator('a[href*="/app/"]').count();
    if (await composer.count() > 0) {
      await composer.fill(ar ? "ما هي الالتزامات المتأخرة؟" : "Which obligations are overdue?");
      await composer.locator("xpath=ancestor::form[1]").locator('button[type="submit"]').first().click();
      try {
        await page.waitForFunction(
          (n) => document.querySelectorAll('a[href*="/app/"]').length > n,
          linksBefore, { timeout: 150000 },
        );
        answered = true;
      } catch { /* recorded below */ }
      await page.waitForTimeout(2000);
      // Only NEW lines = the assistant turn; page chrome (contract values etc.) excluded.
      reply = (await text(page)).split("\n").map((l) => l.trim())
        .filter((l) => l && !before.has(l)).join("\n");
    }
    rec(`${tag}: conversation answered`, answered && reply.length > 20,
      answered ? `${reply.length} chars new` : "no reply within 150s");
    rec(`${tag}: reply grounded in seeded contracts`, /FM-008|OM-014|OPS-021/.test(reply));
    const citeCount = (await page.locator('a[href*="/app/"]').count()) - linksBefore;
    rec(`${tag}: citations rendered`, citeCount > 0, `${citeCount} new citation links`);
    rec(`${tag}: no invented money in reply`,
      !/(SAR|USD|ر\.س|ريال)\s?[\d٠-٩][\d٠-٩,.٬]*|[\d٠-٩][\d٠-٩,.٬]*\s?(SAR|USD|ر\.س|ريال)/i.test(reply));

    // ---- Tasks page -------------------------------------------------------
    await page.goto(`${BASE}/${locale}/app/tasks`);
    await page.waitForLoadState("networkidle");
    rec(`${tag}: tasks page renders`, (await text(page)).length > 120);

    rec(`${tag}: no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  } catch (e) {
    rec(`${tag}: suite threw`, false, String(e).slice(0, 200));
  } finally {
    await browser.close();
  }
}

async function main() {
  const DESKTOP = { width: 1440, height: 900 };
  const MOBILE = { width: 390, height: 844 };
  await suite("en", DESKTOP, "en-desktop");
  await suite("ar", DESKTOP, "ar-desktop");
  await suite("en", MOBILE, "en-mobile");
  await suite("ar", MOBILE, "ar-mobile");

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n4A.1 BROWSER REGRESSION: ${pass}/${results.length} PASS`);
  for (const r of results.filter((x) => !x.ok)) console.log(`  FAILED: ${r.t} ${r.d ?? ""}`);
  if (pass !== results.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
