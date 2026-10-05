/* eslint-disable @typescript-eslint/no-explicit-any */
// Obligation state — browser acceptance on real tenants (EN/AR).
// An active obligation must read ACTIVE, its deadline window separately,
// and its evidence state from requirements + effective verification —
// never "Verified" because activation_status = active.
// Observed status cells are printed with every check, so a run against the
// unfixed build is the "before" evidence. No model calls.
//
// Cases (qa-dashboard-tenants.ts setup; EPSILON-500 due date moved to the
// past by the QA seed step to give an overdue obligation with verified evidence):
//   BETA-200    active · overdue · evidence missing (open gap)
//   GAMMA-300   active · due in 3 days · evidence missing
//   ALPHA-100   active · scheduled · evidence verified
//   EPSILON-500 active · overdue · evidence verified
//   DELTA-400   active · scheduled · verified, prior state in force (pending discrepancy)
//   beta OPS-021 / FM-008  no evidence requirements recorded (FM-008 overdue)
// Run: node --import tsx supabase/tests/e2e-obligation-state.mts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const SHOTS = process.env.OS_SHOTS ?? "/tmp";
const TAG = process.env.OS_TAG ?? "os";
const msgs: Record<"en" | "ar", any> = {
  en: JSON.parse(readFileSync("src/messages/en.json", "utf8")),
  ar: JSON.parse(readFileSync("src/messages/ar.json", "utf8")),
};

const results: { t: string; ok: boolean }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };
const squash = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

type Expect = { no: string; deadline: string; evidence: string; prior?: boolean };
const ALPHA: Expect[] = [
  { no: "BETA-200", deadline: "overdue", evidence: "missing" },
  { no: "GAMMA-300", deadline: "next_3_days", evidence: "missing" },
  { no: "ALPHA-100", deadline: "monitoring", evidence: "verified" },
  { no: "EPSILON-500", deadline: "overdue", evidence: "verified" },
  { no: "DELTA-400", deadline: "monitoring", evidence: "verified", prior: true },
];
const BETA: Expect[] = [
  { no: "OPS-021", deadline: "monitoring", evidence: "no_requirements" },
  { no: "FM-008", deadline: "overdue", evidence: "no_requirements" },
];

async function ids(who: any): Promise<Record<string, string>> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as any;
  await c.auth.signInWithPassword({ email: who.email, password: who.password });
  const { data } = await c.from("contracts").select("id, contract_number").eq("organization_id", who.orgId);
  return Object.fromEntries((data ?? []).map((r: any) => [r.contract_number, r.id]));
}

async function login(browser: Browser, locale: string, who: any): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
  return page;
}

async function checkTenant(browser: Browser, locale: "en" | "ar", name: string, who: any, cases: Expect[]) {
  const m = msgs[locale];
  const verifiedWord = m.status.verified;
  const page = await login(browser, locale, who);
  const map = await ids(who);
  for (const c of cases) {
    const tag = `${TAG} ${name} ${locale} ${c.no}`;
    await page.goto(`${BASE}/${locale}/app/contracts/${map[c.no]}/obligations`);
    await page.waitForLoadState("networkidle");
    const row = page.locator("tbody tr").first();
    const cell = row.locator("td").last();
    const cellText = squash(await cell.innerText());
    const attr = async (a: string) => (await cell.locator(`[${a}]`).count()) ? cell.locator(`[${a}]`).first().getAttribute(a) : null;
    rec(`${tag}: lifecycle reads Active (not Verified)`, (await attr("data-ob-lifecycle")) === "active" && cellText.includes(m.app.obligationState?.lifecycle?.active ?? "\u0000"), `observed status cell: "${cellText}"`);
    rec(`${tag}: deadline window = ${c.deadline}`, (await attr("data-ob-deadline")) === c.deadline);
    rec(`${tag}: evidence state = ${c.evidence}`, (await attr("data-ob-evidence")) === c.evidence);
    if (c.evidence !== "verified") rec(`${tag}: no "${verifiedWord}" anywhere in the status cell`, !cellText.includes(verifiedWord));
    if (c.prior) rec(`${tag}: prior verified state in force is stated`, (await cell.locator("[data-ob-prior-in-force]").count()) === 1);
    await page.screenshot({ path: `${SHOTS}/${tag.replace(/ /g, "-")}-obligations.png`, fullPage: true });
  }
  // Overview of the first case: chart + clause trace verification slot.
  const first = cases[0];
  await page.goto(`${BASE}/${locale}/app/contracts/${map[first.no]}`);
  await page.waitForLoadState("networkidle");
  const chart = squash(await page.locator('[data-section="obligation-evidence-chart"]').innerText().catch(() => page.locator(".app-panel").filter({ hasText: m.app.contract.obligationsByStatus }).first().innerText()));
  rec(`${TAG} ${name} ${locale} overview ${first.no}: chart shows evidence state, not activation`,
    chart.includes(m.app.obligationState?.evidence?.[first.evidence] ?? "\u0000") && !chart.includes(verifiedWord), `observed chart: "${chart}"`);
  const traceEvidence = await page.locator("main [data-ob-evidence]").count();
  rec(`${TAG} ${name} ${locale} overview ${first.no}: clause-trace verification slot shows evidence state`,
    first.evidence === "no_requirements" || traceEvidence >= 1, `data-ob-evidence nodes=${traceEvidence}`);
  await page.screenshot({ path: `${SHOTS}/${TAG}-${name}-${locale}-${first.no}-overview.png`, fullPage: true });
  await page.context().close();
}

async function main() {
  const browser = await chromium.launch();
  for (const locale of ["en", "ar"] as const) await checkTenant(browser, locale, "alpha", st.alpha, ALPHA);
  await checkTenant(browser, "en", "beta", st.beta, BETA);
  // Demo keeps its illustrative status pills.
  const dc = await browser.newContext();
  await dc.addCookies([{ name: "vazora_session", value: "demo", url: BASE }]);
  const page = await dc.newPage();
  await page.goto(`${BASE}/en/app/contracts`);
  await page.locator('tbody a[href*="/app/contracts/"]').first().click();
  await page.waitForURL(/\/app\/contracts\/[^/]+$/, { timeout: 30000 });
  await page.goto(`${page.url()}/obligations`);
  await page.waitForLoadState("networkidle");
  rec(`${TAG} demo: obligations keep fixture status pills, no live state badges`, (await page.locator("[data-ob-lifecycle]").count()) === 0 && (await page.locator("tbody tr").count()) > 0);
  await dc.close();
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
