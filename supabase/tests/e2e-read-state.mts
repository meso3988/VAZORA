/* eslint-disable @typescript-eslint/no-explicit-any */
// Contract read-state smoke test — normal navigation only.
// No fault injection (there is deliberately no production fault route):
// this checks that normal navigation renders correctly on the five
// consumers in EN and AR, for a populated tenant and an empty one —
// populated rows where they belong, the legitimate "No contracts yet"
// empty state where there are none, and the load-failure string NOWHERE.
// Simulated failure branches are covered by contract-read-state.test.ts.
// State: /tmp/qa-dashboard-tenants.json (qa-dashboard-tenants.ts setup).
// Run: node --import tsx supabase/tests/e2e-read-state.mts

import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const SHOTS = process.env.DP_SHOTS ?? "/tmp";
const TAG = process.env.DP_TAG ?? "rs";

const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/messages/ar.json", "utf8"));
const LOAD_FAILED = { en: en.common.contractsLoadFailed, ar: ar.common.contractsLoadFailed };
const DETAIL_FAILED = { en: en.common.contractLoadFailed, ar: ar.common.contractLoadFailed };
const NOT_FOUND_TEXT = { en: en.app.notFound, ar: ar.app.notFound };
const DASH_FAILED = { en: en.app.dashboard.contractsUnavailable, ar: ar.app.dashboard.contractsUnavailable };
const EMPTY_TITLE = { en: en.app.contracts.empty.title, ar: ar.app.contracts.empty.title };
const TITLE = {
  en: { contracts: en.app.contracts.title, tasks: en.app.tasks.title, claims: en.app.claims.title, evidence: en.app.evidence.title },
  ar: { contracts: ar.app.contracts.title, tasks: ar.app.tasks.title, claims: ar.app.claims.title, evidence: ar.app.evidence.title },
};

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

async function login(page: Page, locale: string, who: any) {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
}

async function visit(page: Page, locale: "en" | "ar", name: string, who: any) {
  const tag = `${TAG} ${name} ${locale}`;
  const failedStrings = [LOAD_FAILED[locale], DASH_FAILED[locale]];

  // /app/contracts — the page where success, empty and failure differ most.
  const r = await page.goto(`${BASE}/${locale}/app/contracts`);
  await page.waitForLoadState("networkidle");
  const body = await page.locator("body").innerText();
  await page.screenshot({ path: `${SHOTS}/${tag}-contracts.png`, fullPage: true });
  rec(`${tag} /contracts: loads (${r?.status()})`, r?.status() === 200);
  if (who.numbers.length) {
    rec(`${tag} /contracts: own contracts listed`, who.numbers.every((n: string) => body.includes(n)),
      who.numbers.filter((n: string) => !body.includes(n)).join(", "));
    rec(`${tag} /contracts: no false empty state with records`, !body.includes(EMPTY_TITLE[locale]));
  } else {
    rec(`${tag} /contracts: legitimate empty state shown`, body.includes(EMPTY_TITLE[locale]));
  }
  rec(`${tag} /contracts: no load-failure text`, !failedStrings.some((s) => body.includes(s)));

  // Contract detail — normal navigation via the list link, plus the
  // real not-found branch on a random UUID (same 404 as a foreign id).
  if (who.numbers.length) {
    await page.goto(`${BASE}/${locale}/app/contracts`);
    await page.locator(`tbody a[href*="/app/contracts/"]`).first().click();
    await page.waitForURL(/\/app\/contracts\/[0-9a-f-]{36}/, { timeout: 30000 });
    const detailUrl = page.url().split("?")[0];
    const dbody = await page.locator("body").innerText();
    rec(`${tag} /contracts/[id]: detail renders after click-through`, who.numbers.some((n: string) => dbody.includes(n)));
    rec(`${tag} /contracts/[id]: no load-failure text`, !dbody.includes(DETAIL_FAILED[locale]));
    for (const sub of ["obligations", "risks", "evidence", "activity", "claims", "officer"] as const) {
      const r2 = await page.goto(`${detailUrl}/${sub}`);
      const b2 = await page.locator("body").innerText();
      rec(`${tag} /contracts/[id]/${sub}: loads (${r2?.status()}), no failure text`,
        r2?.status() === 200 && !b2.includes(DETAIL_FAILED[locale]));
    }
    // notFound() thrown from a layout renders the root 404 (pre-existing
    // Next.js behavior — a segment not-found.tsx doesn't catch it). Either
    // the root 404 or the segment's not-found copy is correct here; the
    // load-failure notice must never appear for an absent contract.
    const rn = await page.goto(`${BASE}/${locale}/app/contracts/11111111-2222-3333-4444-555555555555`);
    const nbody = await page.locator("body").innerText();
    rec(`${tag} /contracts/[random-uuid]: legitimate not-found state`,
      rn?.status() === 404
      && (nbody.includes(NOT_FOUND_TEXT[locale]) || /could not be found|لم يتم العثور/.test(nbody))
      && !nbody.includes(DETAIL_FAILED[locale]));
    await page.screenshot({ path: `${SHOTS}/${tag}-contract-notfound.png` });
  }

  // The other consumers: normal navigation, failure text absent.
  for (const route of ["tasks", "claims", "evidence", "dashboard"] as const) {
    const resp = await page.goto(`${BASE}/${locale}/app/${route}`);
    await page.waitForLoadState("domcontentloaded");
    const b = await page.locator("body").innerText();
    rec(`${tag} /${route}: loads (${resp?.status()})`, resp?.status() === 200);
    rec(`${tag} /${route}: no load-failure text`, !failedStrings.some((s) => b.includes(s)));
    if (route !== "dashboard") {
      rec(`${tag} /${route}: page title rendered`, b.includes(TITLE[locale][route]));
    }
    if (route === "evidence" && who.numbers.length === 0) {
      rec(`${tag} /evidence: no upload contract picker for empty tenant`, !(await page.locator('select[name="contractId"]').count()));
    }
  }
  await page.screenshot({ path: `${SHOTS}/${tag}-dashboard.png`, fullPage: true });
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  for (const locale of ["en", "ar"] as const) {
    for (const [name, who] of [["alpha", st.alpha], ["empty", st.empty]] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: locale === "ar" ? "ar-SA" : "en-US" });
      // Loaded dev machines can exceed the 30s default navigation timeout.
      ctx.setDefaultNavigationTimeout(120000);
      const page = await ctx.newPage();
      await login(page, locale, who);
      await visit(page, locale, name, who);
      await ctx.close();
    }
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nREAD-STATE SMOKE (${TAG}): ${results.length - failed.length}/${results.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
