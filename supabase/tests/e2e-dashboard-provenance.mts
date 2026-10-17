/* eslint-disable @typescript-eslint/no-explicit-any */
// Dashboard data provenance — two distinct tenants + an empty tenant, EN + AR,
// real Chrome, no model calls (server run with VAZORA_OFFICER_PROVIDER=none).
// Checks the SERVER HTML RESPONSE (incl. serialized component props) as well
// as the rendered page: hiding data visually is not enough.
// State: /tmp/qa-dashboard-tenants.json (qa-dashboard-tenants.ts setup).
// Run: node --import tsx supabase/tests/e2e-dashboard-provenance.mts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const SHOTS = process.env.DP_SHOTS ?? "/tmp";
const TAG = process.env.DP_TAG ?? "run";

// Strings that exist ONLY in the demo fixtures (src/data/mock/queues.ts, pipeline.ts).
const DEMO_MARKERS = ["640,000", "Faisal Harbi", "ctr_rta_om_2026", "ap_corrective_213", "ap_owner_142"];
// Also present in the public-site translation bundle (src/messages/*.json),
// which next-intl serializes into every page. In the RESPONSE they are only
// acceptable when that attribution is proven; they must never be RENDERED.
const BUNDLE_MARKERS = ["420,000", "فيصل الحربي"];
const MESSAGES = readFileSync("src/messages/en.json", "utf8") + readFileSync("src/messages/ar.json", "utf8");
const APPROVALS_LABEL = { en: "Awaiting approval", ar: "بانتظار الموافقة" };

const results: { t: string; ok: boolean; d?: string }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok, d }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

async function login(page: Page, locale: string, who: any) {
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
}

async function openApprovals(who: any): Promise<number> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as any;
  await c.auth.signInWithPassword({ email: who.email, password: who.password });
  const { count } = await c.from("officer_actions").select("id", { count: "exact", head: true })
    .eq("organization_id", who.orgId).in("status", ["suggested", "waiting_for_approval"]);
  return count ?? -1;
}

async function inspect(page: Page, locale: "en" | "ar", name: string, who: any, others: any[]) {
  const resp = await page.goto(`${BASE}/${locale}/app/dashboard`);
  await page.waitForLoadState("networkidle");
  const html = (await resp?.text()) ?? "";
  const body = await page.locator("body").innerText();
  await page.screenshot({ path: `${SHOTS}/dp-${TAG}-${name}-${locale}.png`, fullPage: true });
  const tag = `${TAG} ${name} ${locale}`;
  const demoInHtml = DEMO_MARKERS.filter((m) => html.includes(m));
  const demoInPage = DEMO_MARKERS.filter((m) => body.includes(m));
  rec(`${tag}: server response contains no demo fixture content`, demoInHtml.length === 0, demoInHtml.join(", "));
  rec(`${tag}: rendered page contains no demo fixture content`, demoInPage.length === 0, demoInPage.join(", "));
  const bundleInPage = BUNDLE_MARKERS.filter((m) => body.includes(m));
  rec(`${tag}: translation-bundle demo strings are not rendered`, bundleInPage.length === 0, bundleInPage.join(", "));
  const unexplained = BUNDLE_MARKERS.filter((m) => html.includes(m) && !MESSAGES.includes(m));
  rec(`${tag}: any such string in the response is attributable to the translation bundle`, unexplained.length === 0, unexplained.join(", "));
  const foreign = others.flatMap((o) => o.numbers).filter((n: string) => html.includes(n) || body.includes(n));
  rec(`${tag}: no other tenant's contract numbers (response or page)`, foreign.length === 0, foreign.join(", "));
  const moneyInPage = body.match(/(?:SAR|ر\.س)\s?[\d٠-٩][\d٠-٩,.٬]*|[\d٠-٩][\d٠-٩,.٬]*\s?(?:SAR|ر\.س)/g) ?? [];
  rec(`${tag}: no financial totals shown (not implemented for live tenants)`, moneyInPage.length === 0, moneyInPage.join(", "));
  if (who.numbers.length) {
    rec(`${tag}: own monitored contracts visible`, who.numbers.some((n: string) => body.includes(n)));
    const shown = await page.locator(`dt:has-text("${APPROVALS_LABEL[locale]}") + dd`).first().innerText().catch(() => "?");
    const actual = await openApprovals(who);
    rec(`${tag}: approvals count = this tenant's real open proposals`, shown.trim() === String(actual), `shown ${shown} · db ${actual}`);
  } else {
    rec(`${tag}: empty tenant — no false reassurance`, !/Nothing currently requires your attention|لا شيء يحتاج انتباهك حاليًا/.test(body));
  }
  return { html, body };
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome" });
  const all = [st.alpha, st.beta, st.empty];
  for (const locale of ["en", "ar"] as const) {
    for (const [name, who] of [["alpha", st.alpha], ["beta", st.beta], ["empty", st.empty]] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: locale === "ar" ? "ar-SA" : "en-US" });
      const page = await ctx.newPage();
      await login(page, locale, who);
      await inspect(page, locale, name, who, all.filter((o) => o !== who));
      await ctx.close();
    }
  }
  // Account switch in ONE browser context: Alpha → sign out → Beta.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
  const page = await ctx.newPage();
  await login(page, "en", st.alpha);
  await inspect(page, "en", "switch-alpha", st.alpha, [st.beta]);
  await page.getByRole("button", { name: /sign out/i }).first().click();
  // signOut redirects to the public home page; wait until we have left /app
  await page.waitForURL((u) => !u.pathname.includes("/app"), { timeout: 60000 });
  const stillIn = await page.goto(`${BASE}/en/app/dashboard`).then((r) => r?.url() ?? "");
  rec(`${TAG} switch: after sign-out the dashboard is no longer reachable`, !stillIn.includes("/app/dashboard") || page.url().includes("/login"), page.url());
  await login(page, "en", st.beta);
  await inspect(page, "en", "switch-beta", st.beta, [st.alpha]);
  await ctx.close();
  // Explicit demo mode keeps its illustrative fixtures (regression guard).
  for (const locale of ["en", "ar"] as const) {
    const dctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await dctx.addCookies([{ name: "vazora_session", value: "demo", url: BASE }]);
    const dpage = await dctx.newPage();
    const r = await dpage.goto(`${BASE}/${locale}/app/dashboard`);
    const html = (await r?.text()) ?? "";
    const body = await dpage.locator("body").innerText();
    const name = locale === "en" ? "Faisal Harbi" : "فيصل الحربي";
    rec(`${TAG} demo ${locale}: demo fixtures shown only in explicit demo mode`, html.includes("640,000") && body.includes(name));
    await dpage.screenshot({ path: `${SHOTS}/dp-${TAG}-demo-${locale}.png` });
    await dctx.close();
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nDASHBOARD PROVENANCE (${TAG}): ${results.length - failed.length}/${results.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
