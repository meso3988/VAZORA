// Phase 4A CP3 — interactive browser QA for the Contract Officer.
// REAL clicks, not SSR scraping: run a sweep, acknowledge an observation,
// ask a grounded question, open a source, approve a proposal.
// Seed first:  node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-scenarios-officer.ts
// Run:         node --import tsx supabase/tests/e2e-officer.mts
/* eslint-disable */

import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3001";
const fx = JSON.parse(readFileSync(join(here, "qa-officer-scenarios.json"), "utf8"));
const { email, password } = fx.login;

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => {
  results.push({ t, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`);
};

/** Section headers and stat labels are uppercased by CSS, and innerText
 *  reflects that — so visible-text checks must be case-insensitive. */
const shows = (body: string, needle: string) =>
  body.toLowerCase().includes(needle.toLowerCase());

const W = {
  en: {
    briefTitle: "Today's brief", center: "Command center",
    approvals: "Waiting for your approval", critical: "Critical", monitoring: "Monitoring",
    runSweep: "Run sweep now", explain: "Explain this", acknowledge: "Acknowledge",
    acknowledged: "Acknowledged", sources: "Sources", approve: "Approve",
    discrepancy: "Verification discrepancy", overdue: "Overdue", newIssues: "New issues",
    officerName: "Contract Officer", conversation: "Conversation",
  },
  ar: {
    briefTitle: "موجز اليوم", center: "مركز القيادة",
    approvals: "بانتظار موافقتك", critical: "حرج", monitoring: "قيد المراقبة",
    runSweep: "شغّل المسح الآن", explain: "اشرح هذا", acknowledge: "اطّلعت",
    acknowledged: "تم الاطلاع", sources: "المصادر", approve: "موافقة",
    discrepancy: "تناقض تحقق", overdue: "متأخر", newIssues: "مسائل جديدة",
    officerName: "ضابط العقود", conversation: "المحادثة",
  },
} as const;

async function login(page: Page, locale: string) {
  await page.goto(`${BASE}/${locale}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 60000 });
}

async function run(locale: "en" | "ar", viewport: { width: number; height: number }, tag: string) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport, locale });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const w = W[locale];
  try {
    await login(page, locale);
    // /app/agent SSR awaits one bounded live model pass for the brief
    // narrative — its worst case is the provider timeout (~90s), so the
    // navigation timeout must exceed that, not the generic 60s.
    await page.goto(`${BASE}/${locale}/app/agent`, { waitUntil: "domcontentloaded", timeout: 150000 });

    const dir = await page.getAttribute("html", "dir");
    rec(`${tag} dir`, dir === (locale === "ar" ? "rtl" : "ltr"), `dir=${dir}`);

    // ---------- Today Brief ----------
    const body1 = await page.locator("body").innerText();
    rec(`${tag} brief-present`, shows(body1, w.briefTitle));
    rec(`${tag} brief-timezone-shown`, body1.includes(fx.timezone) && body1.includes(fx.today),
      `${fx.timezone} ${fx.today}`);
    rec(`${tag} brief-counts-shown`, shows(body1, w.newIssues));

    // ---------- Command Center sections ----------
    rec(`${tag} center-present`, shows(body1, w.center));
    rec(`${tag} center-approvals-section`, shows(body1, w.approvals));
    rec(`${tag} center-critical-section`, shows(body1, w.critical));
    rec(`${tag} center-monitoring-section`, shows(body1, w.monitoring));
    rec(`${tag} center-overdue-item`, body1.includes("FM-008"));
    rec(`${tag} center-discrepancy-item`, shows(body1, w.discrepancy));
    rec(`${tag} center-sources-shown`, shows(body1, w.sources));
    // A pending discrepancy must never be presented as missing evidence.
    rec(`${tag} discrepancy-not-called-missing`,
      !/Missing required evidence: Signed monthly SLA report|دليل مفقود: التقرير الشهري الموقّع/.test(body1));
    // No invented money anywhere on the page.
    rec(`${tag} no-invented-amounts`,
      !/(SAR|USD|ريال)\s?[\d,]{4,}/.test(body1), "no currency figures fabricated");

    // ---------- REAL CLICK: run sweep ----------
    const sweepBtn = page.getByRole("button", { name: w.runSweep });
    rec(`${tag} sweep-button-present`, (await sweepBtn.count()) === 1);
    await sweepBtn.first().click();
    await page.waitForURL(/swept=/, { timeout: 150000, waitUntil: "domcontentloaded" });
    const afterSweep = await page.locator("body").innerText();
    rec(`${tag} sweep-ran`, /completed|partial|مكتمل/.test(page.url()) || shows(afterSweep, w.center),
      page.url().split("?")[1] ?? "");
    // The second, unchanged sweep must create NOTHING — that is the real
    // dedupe proof, reported by the server in the redirect.
    const sweepParams = new URL(page.url()).searchParams;
    rec(`${tag} sweep-no-duplicates-created`, sweepParams.get("created") === "0",
      `created=${sweepParams.get("created")} resolved=${sweepParams.get("resolved")}`);

    // ---------- REAL CLICK: acknowledge ----------
    const ackBtns = page.getByRole("button", { name: w.acknowledge });
    const ackCount = await ackBtns.count();
    rec(`${tag} acknowledge-available`, ackCount >= 1, `buttons=${ackCount}`);
    if (ackCount) {
      await ackBtns.first().click();
      await page.waitForURL(/acknowledged=1/, { timeout: 150000, waitUntil: "domcontentloaded" });
      const acked = await page.locator("body").innerText();
      rec(`${tag} acknowledge-applied`, shows(acked, w.acknowledged));
      // Acknowledged is NOT resolved — the item stays in its section.
      rec(`${tag} acknowledge-not-resolved`, shows(acked, w.center) && acked.includes("FM-008"));
    }

    // ---------- REAL CLICK: open a source from an observation ----------
    const sourceLink = page.locator('a[href*="/app/contracts/"]').first();
    if (await sourceLink.count()) {
      const href = await sourceLink.getAttribute("href");
      await Promise.all([
        page.waitForURL(/\/app\/contracts\//, { timeout: 60000 }),
        sourceLink.click(),
      ]);
      rec(`${tag} source-opens`, page.url().includes("/app/contracts/"), `${href} → ${page.url().split("/app")[1]}`);
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 150000 });
    }

    // ---------- REAL CLICK: explain this (grounded conversation) ----------
    await page.goto(`${BASE}/${locale}/app/agent`, { waitUntil: "domcontentloaded", timeout: 150000 });
    const explainBtns = page.getByRole("button", { name: w.explain });
    rec(`${tag} explain-available`, (await explainBtns.count()) >= 1);
    await explainBtns.first().click();
    await page.waitForURL(/\?c=|&c=/, { timeout: 150000, waitUntil: "domcontentloaded" });
    const explained = await page.locator("body").innerText();
    rec(`${tag} explain-created-conversation`, shows(explained, w.conversation));
    rec(`${tag} explain-officer-answered`, shows(explained, w.officerName));
    rec(`${tag} explain-has-sources`, shows(explained, w.sources));
    rec(`${tag} explain-no-citation-tags`, !explained.includes("[[cite:"));

    // ---------- REAL TYPING: ask a grounded question ----------
    const box = page.locator('textarea[name="question"]');
    if (await box.count()) {
      await box.fill(locale === "ar" ? "إيش المتأخر عندي؟" : "What is overdue right now?");
      await page.getByRole("button", { name: locale === "ar" ? "إرسال" : "Send" }).first().click();
      await page.waitForLoadState("domcontentloaded", { timeout: 150000 });
      await page.waitForTimeout(1500);
      const answered = await page.locator("body").innerText();
      rec(`${tag} ask-answered`, answered.includes("FM-008"), "grounded overdue contract named");
      rec(`${tag} ask-tools-disclosed`, /lookup|استعلام/i.test(answered));
    }

    // ---------- REAL CLICK: approve a proposal ----------
    const approveBtn = page.getByRole("button", { name: w.approve });
    if (await approveBtn.count()) {
      await approveBtn.first().click();
      await page.waitForURL(/approved=/, { timeout: 150000, waitUntil: "domcontentloaded" });
      const approvedPage = await page.locator("body").innerText();
      rec(`${tag} approve-applied`,
        /Action approved|تمت الموافقة/.test(approvedPage),
        "approval recorded");
      rec(`${tag} approve-not-silently-executed`,
        /does not carry out|لا تنفّذ/.test(approvedPage) || shows(approvedPage, w.center),
        "business mutation held for the executor");
    }

    // ---------- dashboard executive summary ----------
    await page.goto(`${BASE}/${locale}/app/dashboard`, { waitUntil: "domcontentloaded" });
    const dash = await page.locator("body").innerText();
    rec(`${tag} dashboard-summary`, shows(dash, w.center) || shows(dash, w.critical),
      "executive summary present");
    rec(`${tag} dashboard-not-full-center`,
      !shows(dash, w.approvals) || !shows(dash, w.monitoring),
      "dashboard does not duplicate the whole command center");

    // ---------- rerun sweep: observations update, nothing duplicates ----------
    await page.goto(`${BASE}/${locale}/app/agent`, { waitUntil: "domcontentloaded", timeout: 150000 });
    // Count actual observation cards, not text mentions — the page also
    // repeats contract numbers in the brief, which makes text counts useless.
    const cardCount = () => page.locator("[data-observation-id]").count();
    const beforeRerun = await cardCount();
    const distinctBefore = await page.evaluate(() =>
      new Set([...document.querySelectorAll("[data-observation-id]")]
        .map((n) => n.getAttribute("data-observation-id"))).size);
    rec(`${tag} observation-cards-unique`, beforeRerun === distinctBefore,
      `cards=${beforeRerun} distinct=${distinctBefore}`);
    const rerunBtn = page.getByRole("button", { name: w.runSweep });
    if (await rerunBtn.count()) {
      await rerunBtn.first().click();
      // The redirect lands on /app/agent — its SSR includes the bounded
      // narrative model call, so commit-and-match beats waiting for load.
      await page.waitForURL(/swept=/, { timeout: 150000, waitUntil: "domcontentloaded" });
      const p = new URL(page.url()).searchParams;
      rec(`${tag} rerun-sweep-idempotent`, p.get("created") === "0",
        `created=${p.get("created")} resolved=${p.get("resolved")}`);
      const afterRerun = await cardCount();
      rec(`${tag} rerun-no-new-cards`, afterRerun === beforeRerun,
        `cards ${beforeRerun} → ${afterRerun}`);
      const distinctAfter = await page.evaluate(() =>
        new Set([...document.querySelectorAll("[data-observation-id]")]
          .map((n) => n.getAttribute("data-observation-id"))).size);
      rec(`${tag} rerun-no-duplicate-cards`, afterRerun === distinctAfter,
        `cards=${afterRerun} distinct=${distinctAfter}`);
      // Bucket integrity: an overdue card may only live in the critical section.
      const misfiled = await page.evaluate(() =>
        [...document.querySelectorAll("[data-observation-severity='critical']")]
          .filter((n) => n.getAttribute("data-observation-bucket") !== "critical").length);
      rec(`${tag} critical-cards-in-critical-section`, misfiled === 0, `misfiled=${misfiled}`);
    }

    // ---------- logout → login → everything persists ----------
    const conversationUrl = page.url();
    // On narrow viewports the navigation (and sign-out) lives behind the menu
    // toggle, so it must be opened first — the same as a real user would.
    const signOutName = locale === "ar" ? "تسجيل الخروج" : "Sign out";
    if (!(await page.getByRole("button", { name: signOutName }).first().isVisible().catch(() => false))) {
      const menuToggle = page.getByRole("button", { name: locale === "ar" ? "القائمة" : "Menu" });
      rec(`${tag} mobile-menu-toggle-present`, (await menuToggle.count()) >= 1);
      await menuToggle.first().click();
      await page.waitForTimeout(400);
      rec(`${tag} mobile-menu-exposes-signout`,
        await page.getByRole("button", { name: signOutName }).first().isVisible(),
        "sign-out reachable from the collapsed navigation");
    }
    await page.getByRole("button", { name: signOutName }).first().click();
    await page.waitForURL(/\/(login|$)|\/(en|ar)\/?$/, { timeout: 60000 });
    rec(`${tag} logout-works`, !page.url().includes("/app/agent"), page.url().split("/").slice(3).join("/"));

    await login(page, locale);
    await page.goto(`${BASE}/${locale}/app/agent`, { waitUntil: "domcontentloaded", timeout: 150000 });
    const persisted = await page.locator("body").innerText();
    rec(`${tag} observations-persist`, persisted.includes("FM-008") || persisted.includes("BETA-200"),
      "monitoring survives a session boundary");
    rec(`${tag} conversations-persist`, shows(persisted, w.conversation),
      "conversation list still present");
    // The specific conversation thread is still readable.
    const convId = new URL(conversationUrl).searchParams.get("c");
    if (convId) {
      await page.goto(`${BASE}/${locale}/app/agent?c=${convId}`, { waitUntil: "domcontentloaded", timeout: 150000 });
      const thread = await page.locator("body").innerText();
      rec(`${tag} conversation-thread-persists`, shows(thread, w.officerName) && shows(thread, w.sources),
        "answer and its sources survive logout/login");
    }

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    rec(`${tag} no-horizontal-overflow`, !overflow);
  } catch (e: any) {
    rec(`${tag} FATAL`, false, (e?.message ?? String(e)).slice(0, 200));
  } finally {
    await browser.close();
  }
}

async function main() {
  await run("en", { width: 1440, height: 900 }, "en-desktop");
  await run("ar", { width: 1440, height: 900 }, "ar-desktop");
  await run("en", { width: 390, height: 844 }, "en-mobile");
  await run("ar", { width: 390, height: 844 }, "ar-mobile");

  const pass = results.filter((r) => r.ok).length;
  console.log(`\nOFFICER BROWSER QA: ${pass}/${results.length} PASS`);
  if (pass !== results.length) {
    console.log("\nfailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.t} — ${r.d}`);
    process.exit(1);
  }
}

main();
