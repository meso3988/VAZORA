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

// Paid-call control: only combos in LIVE_TURNS send a model request, and each
// only if its worst case (OFFICER_MAX_ROUNDS requests, TURN_TOKENS) still fits
// the remaining shared budget. Usage is read back from officer_messages.
const LIVE = (process.env.LIVE_TURNS ?? "en-desktop,ar-desktop,en-mobile,ar-mobile").split(",");
// Which combos run at all (default: all four). E2E_COMBOS=en-mobile restricts
// the run to a single combination without touching the others.
const COMBOS = (process.env.E2E_COMBOS ?? "en-desktop,ar-desktop,en-mobile,ar-mobile").split(",");
// Optional Playwright trace (screenshots+snapshots) saved per combo.
const TRACE_DIR = process.env.E2E_TRACE_DIR ?? "";
const MAX_CALLS = Number(process.env.BROWSER_MAX_CALLS ?? 0);
const MAX_TOKENS = Number(process.env.BROWSER_MAX_TOKENS ?? 0);
const TURN_CALLS = 5, TURN_TOKENS = Number(process.env.BROWSER_TURN_TOKENS ?? 21_000);
/** The production build the browser must be talking to (.next/BUILD_ID). */
const EXPECT_BUILD_ID = process.env.EXPECT_BUILD_ID ?? "";
const START_ISO = new Date().toISOString();

const results: { t: string; ok: boolean | null; d?: string }[] = [];
const rec = (t: string, ok: boolean | null, d = "") => {
  results.push({ t, ok, d });
  console.log(`${ok === null ? "NOT ASSESSED" : ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`);
};

import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
/** Actual usage of assistant turns created by this run (API-reported, all rounds). */
async function usageSoFar() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as any;
  await c.auth.signInWithPassword({ email: EMAIL, password: PASS });
  const { data } = await c.from("officer_messages").select("usage_tokens_input, usage_tokens_output, tool_invocations")
    .eq("organization_id", fx.orgId).eq("role", "assistant").gte("created_at", START_ISO);
  const rows = data ?? [];
  return {
    turns: rows.length,
    tokens: rows.reduce((n: number, r: any) => n + (r.usage_tokens_input ?? 0) + (r.usage_tokens_output ?? 0), 0),
    // rounds are not persisted: upper bound = min(max rounds, tool calls + 1)
    callsUpperBound: rows.reduce((n: number, r: any) => n + Math.min(TURN_CALLS, (r.tool_invocations?.length ?? 0) + 1), 0),
  };
}
const text = (p: Page) => p.locator("body").innerText();

// Navigation timing evidence: every goto is logged with status and duration.
async function nav(page: Page, url: string) {
  const t0 = Date.now();
  try {
    const res = await page.goto(url);
    console.log(`NAV ${url} -> ${res?.status() ?? "?"} in ${Date.now() - t0}ms`);
    return res;
  } catch (e) {
    console.log(`NAV ${url} FAILED after ${Date.now() - t0}ms: ${String(e).split("\n")[0].slice(0, 160)}`);
    throw e;
  }
}

async function login(page: Page, locale: "en" | "ar") {
  await nav(page, `${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASS);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 30000 });
}

async function suite(locale: "en" | "ar", viewport: { width: number; height: number }, tag: string) {
  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({ viewport, locale: locale === "ar" ? "ar-SA" : "en-US" });
  if (TRACE_DIR) await ctx.tracing.start({ screenshots: true, snapshots: true });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 120)}`));
  const ar = locale === "ar";

  try {
    await login(page, locale);
    rec(`${tag}: login`, page.url().includes(`/${locale}/app`));
    if (EXPECT_BUILD_ID) rec(`${tag}: served by build ${EXPECT_BUILD_ID}`, (await page.content()).includes(EXPECT_BUILD_ID));

    const dir = await page.locator("html").getAttribute("dir");
    rec(`${tag}: dir=${dir}`, dir === (ar ? "rtl" : "ltr"));

    // ---- Command Center (dashboard): observations + approval card ----------
    await nav(page, `${BASE}/${locale}/app/dashboard`);
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
    await nav(page, `${BASE}/${locale}/app/contracts/${OM}/officer`);
    await page.waitForLoadState("networkidle");
    const off = await text(page);
    rec(`${tag}: contract officer page renders`, off.length > 120, `${off.length} chars`);

    // ---- Conversation (agent thread) + citations --------------------------
    await nav(page, `${BASE}/${locale}/app/agent`);
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
    const used = await usageSoFar();
    const fits = MAX_CALLS - used.callsUpperBound >= TURN_CALLS && MAX_TOKENS - used.tokens >= TURN_TOKENS;
    if (!LIVE.includes(tag) || !fits) {
      const why = !LIVE.includes(tag) ? "no live model turn allotted (shared budget)" : `budget: ${used.callsUpperBound}/${MAX_CALLS} calls, ${used.tokens}/${MAX_TOKENS} tokens`;
      for (const n of ["conversation answered", "reply grounded in seeded contracts", "citations rendered", "no invented money in reply"]) rec(`${tag}: ${n}`, null, why);
    } else if (await composer.count() > 0) {
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
    if (LIVE.includes(tag) && fits) {
      rec(`${tag}: conversation answered`, answered && reply.length > 20,
        answered ? `${reply.length} chars new` : "no reply within 150s");
      rec(`${tag}: reply grounded in seeded contracts`, /FM-008|OM-014|OPS-021/.test(reply));
      const citeCount = (await page.locator('a[href*="/app/"]').count()) - linksBefore;
      rec(`${tag}: citations rendered`, citeCount > 0, `${citeCount} new citation links`);
      rec(`${tag}: no invented money in reply`,
        !/(SAR|USD|ر\.س|ريال)\s?[\d٠-٩][\d٠-٩,.٬]*|[\d٠-٩][\d٠-٩,.٬]*\s?(SAR|USD|ر\.س|ريال)/i.test(reply));
    }

    // ---- Tasks page -------------------------------------------------------
    await nav(page, `${BASE}/${locale}/app/tasks`);
    await page.waitForLoadState("networkidle");
    rec(`${tag}: tasks page renders`, (await text(page)).length > 120);

    rec(`${tag}: no console errors`, consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));
  } catch (e) {
    rec(`${tag}: suite threw`, false, String(e).slice(0, 200));
  } finally {
    if (TRACE_DIR) await ctx.tracing.stop({ path: join(TRACE_DIR, `e2e-trace-${tag}.zip`) }).catch(() => {});
    await browser.close();
  }
}

async function main() {
  const DESKTOP = { width: 1440, height: 900 };
  const MOBILE = { width: 390, height: 844 };
  const specs = [
    { tag: "en-desktop", locale: "en" as const, vp: DESKTOP },
    { tag: "ar-desktop", locale: "ar" as const, vp: DESKTOP },
    { tag: "en-mobile", locale: "en" as const, vp: MOBILE },
    { tag: "ar-mobile", locale: "ar" as const, vp: MOBILE },
  ];
  for (const s of specs) if (COMBOS.includes(s.tag)) await suite(s.locale, s.vp, s.tag);

  const pass = results.filter((r) => r.ok === true).length;
  const failed = results.filter((r) => r.ok === false);
  const notAssessed = results.filter((r) => r.ok === null).length;
  const used = await usageSoFar();
  console.log(`\n4A.1 BROWSER REGRESSION: ${pass} PASS · ${failed.length} FAIL · ${notAssessed} NOT ASSESSED`);
  for (const r of failed) console.log(`  FAILED: ${r.t} ${r.d ?? ""}`);
  console.log(`BROWSER MODEL USAGE: ${used.turns} turns · ${used.tokens} tokens (API-reported) · ≤${used.callsUpperBound} requests (upper bound)`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
