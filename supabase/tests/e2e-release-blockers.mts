/* eslint-disable @typescript-eslint/no-explicit-any */
// RELEASE BLOCKERS B1/B2 — browser acceptance on real tenants.
//   B1: live contract indicators come from the operational obligations read
//       (approved + active, organization clock) — never placeholder zeros;
//       uncomputed metrics are labelled, not shown as 0 / 0% / SAR 0.
//   B2: deferred capabilities (risks, claims) are declared unavailable in
//       live mode — nav, tabs, overview panels and direct links — while
//       demo mode keeps its labelled fixtures.
// Observed values are printed with every check so a run on unfixed code is
// itself the "before" evidence. No model calls (server: VAZORA_OFFICER_PROVIDER=none).
//
// State: /tmp/qa-dashboard-tenants.json (qa-dashboard-tenants.ts setup).
// Run: node --import tsx supabase/tests/e2e-release-blockers.mts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const SHOTS = process.env.RB_SHOTS ?? "/tmp";
const TAG = process.env.RB_TAG ?? "rb";
const msgs: Record<"en" | "ar", any> = {
  en: JSON.parse(readFileSync("src/messages/en.json", "utf8")),
  ar: JSON.parse(readFileSync("src/messages/ar.json", "utf8")),
};

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };
const squash = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 220);

async function contractIds(who: any): Promise<Record<string, string>> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as any;
  const { error } = await c.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`db signIn: ${error.message}`);
  const { data } = await c.from("contracts").select("id, contract_number").eq("organization_id", who.orgId);
  return Object.fromEntries((data ?? []).map((r: any) => [r.contract_number, r.id]));
}

async function login(browser: Browser, locale: string, who: any, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
  return page;
}

async function go(page: Page, path: string) {
  const r = await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  return r?.status() ?? 0;
}

/** state + text of one indicator inside `scope` (null when absent). */
async function indicator(page: Page, scope: string, name: string) {
  const el = page.locator(`${scope} [data-indicator="${name}"]`).first();
  if (!(await el.count())) return null;
  return { state: await el.getAttribute("data-state"), text: squash(await el.innerText()) };
}

const ZERO_MONEY = /\b(SAR|ر\.س)\s?0\b|\b0\s?(SAR|ر\.س)/;

async function liveTenantChecks(browser: Browser, locale: "en" | "ar", name: string, who: any, ids: Record<string, string>, overdueNo: string, cleanNo: string, foreign: string[]) {
  const m = msgs[locale];
  const tag = `${TAG} ${name} ${locale}`;
  const page = await login(browser, locale, who);

  // ---- /app/contracts ----
  rec(`${tag} /contracts 200`, (await go(page, `/${locale}/app/contracts`)) === 200);
  await page.screenshot({ path: `${SHOTS}/${tag.replace(/ /g, "-")}-contracts.png`, fullPage: true });
  const rowOf = (no: string) => `tr:has(:text("${no}"))`;
  const overdueRow = squash(await page.locator(rowOf(overdueNo)).first().innerText());
  const cleanRow = squash(await page.locator(rowOf(cleanNo)).first().innerText());
  const od = await indicator(page, rowOf(overdueNo), "obligationsOverdue");
  const tot = await indicator(page, rowOf(overdueNo), "obligationsTotal");
  const odClean = await indicator(page, rowOf(cleanNo), "obligationsOverdue");
  rec(`${tag} /contracts ${overdueNo}: overdue computed = 1`, od?.state === "value" && od.text === "1", `observed row: ${overdueRow}`);
  rec(`${tag} /contracts ${overdueNo}: active obligations computed = 1`, tot?.state === "value" && tot.text === "1");
  rec(`${tag} /contracts ${cleanNo}: overdue computed = 0 (real zero)`, odClean?.state === "value" && odClean.text === "0", `observed row: ${cleanRow}`);
  for (const k of ["evidenceCoverage"]) {
    const i = await indicator(page, rowOf(overdueNo), k);
    rec(`${tag} /contracts ${overdueNo}: ${k} labelled not calculated`, i?.state === "not_calculated", JSON.stringify(i));
  }
  for (const k of ["riskExposure", "claimReadiness"]) {
    const i = await indicator(page, rowOf(overdueNo), k);
    rec(`${tag} /contracts ${overdueNo}: ${k} labelled not in this release`, i?.state === "deferred", JSON.stringify(i));
  }
  rec(`${tag} /contracts: no placeholder 0% or zero money in rows`, !/\b0\s?%|%\s?0\b|٠٪/.test(overdueRow) && !ZERO_MONEY.test(overdueRow));
  const body = await page.locator("body").innerText();
  rec(`${tag} /contracts: no other-tenant contract`, foreign.every((f) => !body.includes(f)), foreign.filter((f) => body.includes(f)).join(","));

  // ---- shell nav: claims declared unavailable, not an active link ----
  const claimsLinks = await page.locator(`aside a[href$="/app/claims"]`).count();
  const navDeferred = await page.locator(`aside [data-deferred="claims"]`).count();
  rec(`${tag} nav: claims is not an active link and is marked unavailable`, claimsLinks === 0 && navDeferred === 1, `links=${claimsLinks} marked=${navDeferred}`);

  // ---- contract overview ----
  const cid = ids[overdueNo];
  rec(`${tag} overview ${overdueNo} 200`, (await go(page, `/${locale}/app/contracts/${cid}`)) === 200);
  await page.screenshot({ path: `${SHOTS}/${tag.replace(/ /g, "-")}-overview.png`, fullPage: true });
  const kpis = squash(await page.locator(".app-kpi").allInnerTexts().then((a) => a.join(" | ")));
  const kOd = await indicator(page, "main", "obligationsOverdue");
  const kTot = await indicator(page, "main", "obligationsTotal");
  rec(`${tag} overview KPI overdue = 1`, kOd?.state === "value" && kOd.text === "1", `observed KPIs: ${kpis}`);
  rec(`${tag} overview KPI active obligations = 1`, kTot?.state === "value" && kTot.text === "1");
  const kCov = await indicator(page, "main", "evidenceCoverage");
  rec(`${tag} overview coverage labelled not calculated`, kCov?.state === "not_calculated", JSON.stringify(kCov));
  for (const k of ["risksOpen", "riskExposure", "claimReadiness"]) {
    const i = await indicator(page, "main", k);
    rec(`${tag} overview ${k} labelled not in this release`, i?.state === "deferred", JSON.stringify(i));
  }
  rec(`${tag} overview KPIs: no placeholder zero money / 0%`, !ZERO_MONEY.test(kpis) && !/\b0\s?%/.test(kpis));
  // `[data-section]` exists only after the fix; before it, fall back to the panel by title.
  const lifecycle = squash(await page.locator(`[data-section="lifecycle"], .app-panel:has(h2:text-is("${m.app.lifecycle.title}"))`).first().innerText().catch(() => ""));
  rec(`${tag} lifecycle: no placeholder 0% / zero money`, lifecycle.length > 0 && !ZERO_MONEY.test(lifecycle) && !/\b0\s?%/.test(lifecycle), `observed: ${lifecycle}`);
  const overviewLinks = await page.locator(`main a[href$="/risks"], main a[href$="/claims"]`).count();
  rec(`${tag} overview + tabs: no active risks/claims links`, overviewLinks === 0, `links=${overviewLinks}`);
  const tabsNav = `nav[aria-label="${m.app.contract.sections}"]`;
  rec(`${tag} tabs: risks/claims marked unavailable`, (await page.locator(`${tabsNav} [data-deferred="risks"], ${tabsNav} [data-deferred="claims"]`).count()) === 2);

  // ---- obligations tab: n / total from one scope ----
  rec(`${tag} obligations tab 200`, (await go(page, `/${locale}/app/contracts/${cid}/obligations`)) === 200);
  const oblHint = squash(await page.locator("main").innerText());
  rec(`${tag} obligations hint has no unknown denominator (n / 0)`, !/\d+\s*\/\s*0\b/.test(oblHint), `observed: ${oblHint.slice(0, 120)}`);

  // ---- direct links to deferred pages ----
  for (const [path, feature] of [[`/app/contracts/${cid}/risks`, "risks"], [`/app/contracts/${cid}/claims`, "claims"], ["/app/claims", "claims"]] as const) {
    const s = await go(page, `/${locale}${path}`);
    const b = squash(await page.locator("main").innerText());
    const notice = await page.locator(`main [data-deferred-notice="${feature}"]`).count();
    rec(`${tag} direct ${path.replace(cid, "[id]")}: explicit unavailable notice, not an empty list`,
      s === 200 && notice === 1 && !b.includes(m.app.claims.empty) && !ZERO_MONEY.test(b), `status=${s} observed: ${b.slice(0, 160)}`);
    await page.screenshot({ path: `${SHOTS}/${tag.replace(/ /g, "-")}-direct-${path.split("/").pop()}.png`, fullPage: true });
  }
  rec(`${tag} html dir`, (await page.locator("html").getAttribute("dir")) === (locale === "ar" ? "rtl" : "ltr"));
  await page.context().close();
}

async function main() {
  const browser = await chromium.launch();
  const alphaIds = await contractIds(st.alpha);
  const betaIds = await contractIds(st.beta);

  for (const locale of ["en", "ar"] as const) {
    await liveTenantChecks(browser, locale, "alpha", st.alpha, alphaIds, "BETA-200", "ALPHA-100", st.beta.numbers);
  }
  await liveTenantChecks(browser, "en", "beta", st.beta, betaIds, "FM-008", "OM-014", st.alpha.numbers);

  // ---- empty organization ----
  {
    const page = await login(browser, "en", st.empty);
    await go(page, "/en/app/contracts");
    const b = await page.locator("main").innerText();
    rec(`${TAG} empty: honest empty state, no failure text`, b.includes(msgs.en.app.contracts.empty.title) && !b.includes(msgs.en.common.contractsLoadFailed));
    await go(page, "/en/app/claims");
    rec(`${TAG} empty: /app/claims is the unavailable notice`, (await page.locator(`main [data-deferred-notice="claims"]`).count()) === 1);
    await page.context().close();
  }

  // ---- mobile 390px EN + AR ----
  for (const locale of ["en", "ar"] as const) {
    const page = await login(browser, locale, st.alpha, { width: 390, height: 844 });
    for (const path of [`/app/contracts`, `/app/contracts/${alphaIds["BETA-200"]}`, `/app/contracts/${alphaIds["BETA-200"]}/risks`]) {
      await go(page, `/${locale}${path}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      rec(`${TAG} mobile ${locale} ${path.replace(alphaIds["BETA-200"], "[id]")}: no horizontal overflow`, !overflow);
      await page.screenshot({ path: `${SHOTS}/${TAG}-mobile-${locale}-${path.split("/").pop()}.png`, fullPage: true });
    }
    await page.context().close();
  }

  // ---- demo: labelled fixtures stay, links stay ----
  {
    const dc = await browser.newContext();
    await dc.addCookies([{ name: "vazora_session", value: "demo", url: BASE }]);
    const page = await dc.newPage();
    await go(page, "/en/app/contracts");
    const b = await page.locator("main").innerText();
    rec(`${TAG} demo /contracts keeps illustrative fixture figures`, b.includes("126"));
    rec(`${TAG} demo nav keeps claims link`, (await page.locator(`aside a[href$="/app/claims"]`).count()) === 1);
    rec(`${TAG} demo badge visible`, (await page.locator(`aside`).innerText()).includes(msgs.en.app.nav.demoBadge));
    await go(page, "/en/app/claims");
    rec(`${TAG} demo /app/claims keeps fixture claims (no unavailable notice)`, (await page.locator(`main [data-deferred-notice]`).count()) === 0 && (await page.locator("main").innerText()).length > 200);
    await page.screenshot({ path: `${SHOTS}/${TAG}-demo-claims.png`, fullPage: true });
    await dc.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
