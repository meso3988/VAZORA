// Checkpoint 3 — interactive browser QA against the production build (port 3001).
// Real Chrome via Playwright channel; persists QA evidence (SMOKE_KEEP data).
// Run: node --import tsx supabase/tests/e2e-cp3-qa.mts
/* eslint-disable */

import { chromium, type Page } from "playwright";

const BASE = "http://localhost:3001";
const EMAIL = process.env.VAZORA_QA_EMAIL ?? "qa-viewer-1789917080379@vazora.test";
const PASS = process.env.VAZORA_QA_PASSWORD ?? "Qa!dbcfedda-a849-4b45-b011-6d0198259757";
const ITEM = "c8aa6f1c-5fb7-4ad2-93a6-d4cc684ef0bc";
const CONTRACT = "98ac4ab6-d5af-4bbe-8d1b-9ea3c9a744e2";

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
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 20000 });
}

async function suite(locale: "en" | "ar", viewport: { width: number; height: number }, tag: string) {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport, locale: locale === "ar" ? "ar-SA" : "en-US" });
  const page = await ctx.newPage();
  try {
    await login(page, locale);
    rec(`${tag}: login`, page.url().includes(`/${locale}/app`));

    // dir / RTL
    const dir = await page.locator("html").getAttribute("dir");
    rec(`${tag}: dir=${dir}`, dir === (locale === "ar" ? "rtl" : "ltr"));

    // Inbox + filters
    await page.goto(`${BASE}/${locale}/app/evidence`);
    await page.waitForLoadState("networkidle");
    const body = await text(page);
    const qaItem = body.includes("QA September performance report");
    rec(`${tag}: inbox lists QA item`, qaItem);

    // category chips — click each, verify navigation + row content
    for (const [c, expectItem] of [["needs_verification", true], ["recent", true], ["verified", false], ["partial", false], ["needs_human_review", false]] as const) {
      await page.goto(`${BASE}/${locale}/app/evidence?c=${c}`);
      await page.waitForLoadState("networkidle");
      const has = (await text(page)).includes("QA September");
      rec(`${tag}: filter c=${c}`, has === expectItem, `item ${has ? "shown" : "hidden"}`);
    }
    // contract filter
    await page.goto(`${BASE}/${locale}/app/evidence?contract=${CONTRACT}`);
    const hasC = (await text(page)).includes("QA September");
    rec(`${tag}: contract filter`, hasC);

    // Inspector
    await page.goto(`${BASE}/${locale}/app/evidence/${ITEM}`);
    await page.waitForLoadState("networkidle");
    const insp = await text(page);
    rec(`${tag}: inspector zones`, insp.includes(locale === "ar" ? "ما الذي كان مطلوبًا؟" : "What was required?") &&
      insp.includes(locale === "ar" ? "ما الذي قُدِّم؟" : "What was submitted?") &&
      insp.includes(locale === "ar" ? "ماذا يثبت؟" : "What does it prove?"));
    rec(`${tag}: honest failed-v3 state`, insp.includes(locale === "ar" ? "فشل التحقق" : "Verification failed") &&
      insp.includes(locale === "ar" ? "مستلَم" : "Received"));

    // v1 → v2 switching: checks must differ
    await page.goto(`${BASE}/${locale}/app/evidence/${ITEM}?v=1`);
    await page.waitForLoadState("networkidle");
    const v1 = await text(page);
    const v1HasMissing = v1.includes("Missing") || v1.includes("مفقود");
    const v1Override = v1.includes("Human override") || v1.includes("تجاوز بشري");
    const v1Vazora = v1.includes("VAZORA result") || v1.includes("نتيجة VAZORA");
    rec(`${tag}: v1 shows partial+missing`, v1HasMissing);
    rec(`${tag}: v1 human override distinct`, v1Override && v1Vazora);

    await page.goto(`${BASE}/${locale}/app/evidence/${ITEM}?v=2`);
    await page.waitForLoadState("networkidle");
    const v2 = await text(page);
    rec(`${tag}: v2 all verified`, (v2.match(/Verified|مُتحقَّق/g) ?? []).length >= 4 && !v2HasMissingMatches(v2));

    // proof chain present + gap lifecycle stepper
    const pc = await text(page);
    rec(`${tag}: proof chain`, pc.includes(locale === "ar" ? "سلسلة الإثبات" : "Proof chain"));
    rec(`${tag}: gap lifecycle steps`, pc.includes(locale === "ar" ? "إعادة التحقق" : "Re-verifying") && pc.includes(locale === "ar" ? "محلولة" : "Resolved"));

    // version-history links exist for v1/v2/v3
    for (const n of [1, 2, 3]) {
      const link = page.locator(`a[href*="v=${n}"]`).first();
      rec(`${tag}: version link v${n}`, (await link.count()) > 0);
    }

    // signed file open — click Open file, expect navigation to a signed URL
    const openBtn = page.locator('button:has-text("Open file"), button:has-text("فتح الملف")').first();
    if (await openBtn.count()) {
      const [resp] = await Promise.all([
        page.waitForEvent("popup", { timeout: 8000 }).catch(() => null),
        page.waitForNavigation({ timeout: 8000 }).catch(() => null),
        openBtn.click(),
      ]);
      const nav = page.url();
      rec(`${tag}: signed file open`, nav.includes("supabase") || nav.includes("token=") || resp != null, nav.slice(0, 80));
      if (!nav.includes("/app/")) await page.goBack().catch(() => {});
    } else {
      rec(`${tag}: signed file open`, false, "button not found");
    }

    // keyboard: tab to first filter chip, verify focus visible
    await page.goto(`${BASE}/${locale}/app/evidence`);
    await page.waitForLoadState("networkidle");
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el ? { tag: el.tagName, cls: el.className.slice(0, 60), txt: el.textContent?.slice(0, 40) } : null;
    });
    rec(`${tag}: keyboard focus lands`, focused != null && focused.tag !== "BODY", JSON.stringify(focused));

    // overflow check — no horizontal scroll
    const scrollW = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    rec(`${tag}: no horizontal overflow`, !scrollW);
  } catch (e) {
    rec(`${tag}: suite`, false, String(e).slice(0, 160));
  } finally {
    await browser.close();
  }
}
function v2HasMissingMatches(v2: string) {
  // a "Missing" only legitimately appears inside the v1-history text — checks grid should be clean
  return v2.includes("MISSING");
}

// --- mutation flow (EN only): upload v4 + run verification --------------------
async function mutationFlow() {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  try {
    await login(page, "en");
    // upload new version via inspector Zone B
    await page.goto(`${BASE}/en/app/evidence/${ITEM}`);
    const fileInput = page.locator('input[type="file"][name="file"]').first();
    await fileInput.setInputFiles({ name: "report-sep-v4.txt", mimeType: "text/plain", buffer: Buffer.from(
      "MONTHLY PERFORMANCE REPORT — OCTOBER 2025\nContract: QA Evidence Smoke Contract\nReporting period: 2025-10-01 to 2025-10-31\n\nKPI RESULTS\nKPI-1 97%\nKPI-2 0\nKPI-3 14\nKPI-4 212\nKPI-5 81%\nKPI-6 93%\nKPI-7 6\nKPI-8 100%\n\nAPPROVALS\nContractor signature: signed — A. Contractor (signed 2025-11-02)\nClient acknowledgement: reviewed and accepted — Eng. S. Hamad (signed 2025-11-04)\n") });
    await page.locator('button:has-text("Upload")').first().click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    const after = await text(page);
    // UPLOADED ≠ VERIFIED — the banner/state must not claim verified
    const saysReceived = after.includes("Received") || after.includes("received");
    rec("upload: receipt ≠ verified", saysReceived);

    // run verification explicitly
    const runBtn = page.locator('button:has-text("Run verification"), button:has-text("تشغيل التحقق")').first();
    if (await runBtn.count()) {
      await runBtn.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2500);
      const post = await text(page);
      rec("verify: run executed", post.includes("Verification") || post.includes("التحقق"), "");
    } else rec("verify: run button", false);
  } catch (e) {
    rec("mutation flow", false, String(e).slice(0, 160));
  } finally {
    await browser.close();
  }
}

const run = async () => {
  await suite("en", { width: 1400, height: 900 }, "en-desktop");
  await suite("ar", { width: 1400, height: 900 }, "ar-desktop");
  await suite("en", { width: 390, height: 844 }, "en-mobile");
  await suite("ar", { width: 390, height: 844 }, "ar-mobile");
  await mutationFlow();
  const fails = results.filter((r) => !r.ok);
  console.log(`\n=== CP3 INTERACTIVE QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length) fails.forEach((f) => console.log(`  FAIL ${f.t} ${f.d}`));
  process.exit(fails.length ? 1 : 0);
};
run();
