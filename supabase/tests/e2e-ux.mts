// Phase 3 UX consistency patch — real-browser QA over persisted scenarios.
// Asserts that EFFECTIVE OPERATIONAL STATE and LATEST VERIFICATION RESULT are
// presented as two distinct things across inspector, matrix and inbox, in
// en/ar × desktop/mobile against the production build (:3001).
// Seed first:  node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-scenarios-ux.ts
// Run:         node --import tsx supabase/tests/e2e-ux.mts
/* eslint-disable */

import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "http://localhost:3001";
const fixture = JSON.parse(readFileSync(join(here, "qa-ux-scenarios.json"), "utf8"));
const { email, password } = fixture.login;
const S = fixture.scenarios;

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => {
  results.push({ t, ok, d });
  console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`);
};

/** Wording per locale — Arabic must distinguish the two concepts clearly. */
const W = {
  en: {
    operational: "Operational status",
    latest: "Latest re-verification",
    heading: "Operational state vs latest verification",
    verified: "Verified",
    needsReview: "Needs human review",
    discrepancyPanel: "Verification discrepancies",
    pending: "Human review required",
    kept: "Prior state retained",
    confirmed: "Regression confirmed",
    priorInEffect: "previous verified state remains in effect",
    matrixDiscrepancy: "Verification discrepancy",
    matrixLatest: "Latest model result",
    inboxCat: "Verification discrepancies",
    humanRegressionGap: "Opened by human-confirmed regression",
  },
  ar: {
    operational: "الحالة التشغيلية",
    latest: "آخر نتيجة تحقق",
    heading: "الحالة التشغيلية مقابل آخر نتيجة تحقق",
    verified: "مُتحقَّق",
    needsReview: "يحتاج مراجعة",
    discrepancyPanel: "تناقضات التحقق",
    pending: "مراجعة بشرية مطلوبة",
    kept: "أُبقي على الحالة السابقة",
    confirmed: "تأكَّد التراجع",
    priorInEffect: "تبقى سارية",
    matrixDiscrepancy: "تناقض في التحقق",
    matrixLatest: "آخر نتيجة تحقق",
    inboxCat: "تناقضات التحقق",
    humanRegressionGap: "فُتحت بتأكيد تراجع بشري",
  },
} as const;

async function login(page: Page, locale: string) {
  await page.goto(`${BASE}/${locale}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 45000 });
}

async function run(locale: "en" | "ar", viewport: { width: number; height: number }, tag: string) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport, locale });
  const page = await ctx.newPage();
  const w = W[locale];
  try {
    await login(page, locale);

    // ---------- direction + no horizontal overflow ----------
    const dir = await page.getAttribute("html", "dir");
    rec(`${tag} dir`, dir === (locale === "ar" ? "rtl" : "ltr"), `dir=${dir}`);

    // ============ A. pending discrepancy ============
    await page.goto(`${BASE}/${locale}/app/evidence/${S.a.itemId}`, { waitUntil: "domcontentloaded" });
    const aBody = await page.locator("body").innerText();
    rec(`${tag} A-heading-separates-concepts`, aBody.includes(w.heading), "");
    rec(`${tag} A-operational-label`, aBody.includes(w.operational), "");
    rec(`${tag} A-latest-label`, aBody.includes(w.latest), "");
    // The operational badge must read Verified even though the run said needs review.
    const aOperational = await page
      .locator(`section[aria-labelledby="effective-state-heading"]`)
      .innerText();
    rec(`${tag} A-primary-verified`, aOperational.includes(w.verified),
      aOperational.replace(/\s+/g, " ").slice(0, 90));
    rec(`${tag} A-latest-shown-honestly`, aOperational.includes(w.needsReview),
      aOperational.replace(/\s+/g, " ").slice(0, 90));
    rec(`${tag} A-discrepancy-panel`, aBody.includes(w.discrepancyPanel), "");
    rec(`${tag} A-pending-flag`, aBody.includes(w.pending), "");
    rec(`${tag} A-prior-in-effect-msg`, aBody.includes(w.priorInEffect), "");
    const aDecision = await page.locator('button[value="keep_prior"]').count();
    rec(`${tag} A-human-decision-offered`, aDecision === 1, `buttons=${aDecision}`);

    // ============ B. keep_prior ============
    await page.goto(`${BASE}/${locale}/app/evidence/${S.b.itemId}`, { waitUntil: "domcontentloaded" });
    const bBody = await page.locator("body").innerText();
    const bOperational = await page.locator(`section[aria-labelledby="effective-state-heading"]`).innerText();
    rec(`${tag} B-primary-still-verified`, bOperational.includes(w.verified),
      bOperational.replace(/\s+/g, " ").slice(0, 90));
    rec(`${tag} B-retention-shown`, bBody.includes(w.kept), "");
    rec(`${tag} B-no-pending-form`, (await page.locator('button[value="keep_prior"]').count()) === 0, "");

    // ============ C. confirm_regression ============
    await page.goto(`${BASE}/${locale}/app/evidence/${S.c.itemId}`, { waitUntil: "domcontentloaded" });
    const cBody = await page.locator("body").innerText();
    rec(`${tag} C-regression-confirmed`, cBody.includes(w.confirmed), "");
    rec(`${tag} C-human-attributed-gap`, cBody.includes(w.humanRegressionGap), "");
    const cOperational = await page.locator(`section[aria-labelledby="effective-state-heading"]`).innerText();
    rec(`${tag} C-operational-not-verified`, !cOperational.includes(`${w.operational}\n${w.verified}`),
      cOperational.replace(/\s+/g, " ").slice(0, 90));

    // ============ D. new version genuinely fails ============
    await page.goto(`${BASE}/${locale}/app/evidence/${S.d.itemId}`, { waitUntil: "domcontentloaded" });
    const dBody = await page.locator("body").innerText();
    rec(`${tag} D-no-discrepancy-panel`, !dBody.includes(w.discrepancyPanel), "");
    rec(`${tag} D-no-effective-split`, !dBody.includes(w.heading), "");
    rec(`${tag} D-ordinary-gap`, !dBody.includes(w.humanRegressionGap), "");

    // ============ MATRIX ============
    await page.goto(`${BASE}/${locale}/app/contracts/${fixture.contractId}/evidence`, { waitUntil: "domcontentloaded" });
    const mBody = await page.locator("body").innerText();
    // table headers are uppercased by CSS — innerText reflects that
    rec(`${tag} M-operational-column`, mBody.toLowerCase().includes(w.operational.toLowerCase()), "");
    rec(`${tag} M-discrepancy-secondary`, mBody.includes(w.matrixDiscrepancy), "");
    rec(`${tag} M-latest-model-result`, mBody.includes(w.matrixLatest), "");
    // Scenario A's row must read Verified as its primary status.
    const aRow = page.locator("tr", { hasText: "scenario a" }).first();
    const aRowText = (await aRow.count()) ? await aRow.innerText() : "";
    rec(`${tag} M-row-primary-verified`, aRowText.includes(w.verified),
      aRowText.replace(/\s+/g, " ").slice(0, 110));
    rec(`${tag} M-row-flags-discrepancy`, aRowText.includes(w.matrixDiscrepancy),
      aRowText.replace(/\s+/g, " ").slice(0, 110));

    // ============ INBOX — distinct category ============
    await page.goto(`${BASE}/${locale}/app/evidence`, { waitUntil: "domcontentloaded" });
    const iBody = await page.locator("body").innerText();
    rec(`${tag} I-distinct-category`, iBody.includes(w.inboxCat), "");
    await page.goto(`${BASE}/${locale}/app/evidence?c=verification_discrepancy`, { waitUntil: "domcontentloaded" });
    const filtered = await page.locator("main ul > li").count();
    const filteredText = await page.locator("body").innerText();
    rec(`${tag} I-filter-lists-discrepancies`, filtered >= 1, `rows=${filtered}`);
    rec(`${tag} I-gap-items-excluded`, !filteredText.includes("scenario d") && !filteredText.includes("Scenario d"),
      "gap-only items must not appear in the discrepancy queue");
    rec(`${tag} I-operational-badge`, filteredText.includes(w.verified),
      "inbox row shows operational verified, not the raw run verdict");

    // ---------- no horizontal overflow ----------
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    rec(`${tag} no-horizontal-overflow`, !overflow, "");
  } catch (e: any) {
    rec(`${tag} FATAL`, false, e?.message ?? String(e));
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
  console.log(`\nUX CONSISTENCY QA: ${pass}/${results.length} PASS`);
  if (pass !== results.length) {
    console.log("\nfailures:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  ${r.t} — ${r.d}`);
    process.exit(1);
  }
}

main();
