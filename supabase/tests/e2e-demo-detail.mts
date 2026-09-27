/* eslint-disable @typescript-eslint/no-explicit-any */
// Demo detail click-through — EN + AR.
//
// Scope: verifies the non-UUID demo contract path after the readContract
// demo regression fix (demo fixture ids like `ctr_nds_dc_2025` are not
// UUIDs — the live-only format guard must not 404 them). Normal
// navigation only: enter demo mode via the session cookie, open the
// contracts list, click through to a detail page, then the obligations
// subpage. No fault injection, no tenant state needed.
//
// Run: node --import tsx supabase/tests/e2e-demo-detail.mts

import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/messages/ar.json", "utf8"));
const NOT_FOUND = { en: en.app.notFound, ar: ar.app.notFound };
const LOAD_FAILED = { en: en.common.contractLoadFailed, ar: ar.common.contractLoadFailed };
const DATA_FAILED = { en: en.common.dataLoadFailed, ar: ar.common.dataLoadFailed };

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
// Demo session cookie — same as signInDemo() sets (vazora_session=demo).
await ctx.addCookies([{ name: "vazora_session", value: "demo", url: BASE }]);
const page = await ctx.newPage();

for (const locale of ["en", "ar"] as const) {
  const tag = `demo ${locale}`;

  const r = await page.goto(`${BASE}/${locale}/app/contracts`, { timeout: 120000 });
  await page.waitForLoadState("networkidle");
  rec(`${tag} contracts list 200`, r?.status() === 200, `status=${r?.status()}`);

  // A demo contract row link carries a non-UUID fixture id (ctr_*).
  const row = page.locator("table tbody a[href*='/app/contracts/']").first();
  const href = await row.getAttribute("href");
  rec(`${tag} list has a non-UUID contract link`, /ctr_/.test(href ?? ""), href ?? "no href");

  const before = page.url();
  await row.click();
  await page.waitForURL((u) => u.toString() !== before && /\/app\/contracts\//.test(u.toString()), { timeout: 120000 });
  await page.waitForLoadState("networkidle");
  const detail = page.url();
  rec(`${tag} navigated to non-UUID detail`, /ctr_/.test(detail), detail);

  const body = await page.locator("body").innerText();
  rec(`${tag} detail renders (no not-found)`, !body.includes(NOT_FOUND[locale]));
  rec(`${tag} detail renders (no load-failure)`,
    !body.includes(LOAD_FAILED[locale]) && !body.includes(DATA_FAILED[locale]));

  // Obligations subpage — exercises readObligationList on the demo path.
  const r2 = await page.goto(`${detail}/obligations`, { timeout: 120000 });
  await page.waitForLoadState("networkidle");
  const body2 = await page.locator("body").innerText();
  rec(`${tag} obligations subpage 200`, r2?.status() === 200, `status=${r2?.status()}`);
  rec(`${tag} obligations subpage no not-found/failure`,
    !body2.includes(NOT_FOUND[locale]) && !body2.includes(DATA_FAILED[locale]));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
