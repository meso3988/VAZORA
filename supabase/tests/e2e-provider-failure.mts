/* eslint-disable @typescript-eslint/no-explicit-any */
// U5 — what the customer sees when the Officer's model provider is absent or
// unreachable. Isolated QA servers only; no production setting is touched and
// no product fault route exists:
//   A (QA_BASE,      default :3005): VAZORA_OFFICER_PROVIDER=none
//   B (QA_BASE_FAIL, default :3006): SIMULATED CONNECTION FAILURE —
//       VAZORA_OFFICER_PROVIDER=openai-compat-officer,
//       VAZORA_AI_BASE_URL=http://127.0.0.1:9 (closed local port),
//       VAZORA_AI_API_KEY=<dummy>, VAZORA_OFFICER_MAX_RETRIES=0
// Neither server can reach a real model API. Checks: an explicit failure
// state, no answer text, no proposal/action rows created, no demo data.
//
// State: /tmp/qa-dashboard-tenants.json. Run: node --import tsx supabase/tests/e2e-provider-failure.mts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const A = process.env.QA_BASE ?? "http://localhost:3005";
const B = process.env.QA_BASE_FAIL ?? "http://localhost:3006";
const SHOTS = process.env.PF_SHOTS ?? "/tmp";
const en = JSON.parse(readFileSync("src/messages/en.json", "utf8"));
const ar = JSON.parse(readFileSync("src/messages/ar.json", "utf8"));

const results: { t: string; ok: boolean }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

async function db() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as any;
  await c.auth.signInWithPassword({ email: st.alpha.email, password: st.alpha.password });
  return c;
}
const actionCount = async (c: any) => (await c.from("officer_actions").select("id", { count: "exact", head: true }).eq("organization_id", st.alpha.orgId)).count ?? -1;
const assistantMessages = async (c: any, conv: string) =>
  (await c.from("officer_messages").select("id", { count: "exact", head: true }).eq("conversation_id", conv).eq("role", "assistant")).count ?? -1;

async function login(base: string, locale: string): Promise<Page> {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${base}/${locale}/login`);
  await page.locator('input[name="email"]').fill(st.alpha.email);
  await page.locator('input[name="password"]').fill(st.alpha.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
  return page;
}

async function openConversation(page: Page, base: string, locale: string): Promise<string> {
  await page.goto(`${base}/${locale}/app/agent`);
  await page.waitForLoadState("networkidle");
  const label = (locale === "ar" ? ar : en).app.officer.newConversation;
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForURL(/\?c=/, { timeout: 60000 });
  await page.waitForLoadState("networkidle");
  return new URL(page.url()).searchParams.get("c")!;
}

async function main() {
  const c = await db();
  const before = await actionCount(c);

  // ---- A: no provider configured ----
  for (const locale of ["en", "ar"] as const) {
    const m = locale === "ar" ? ar : en;
    const page = await login(A, locale);
    const conv = await openConversation(page, A, locale);
    const body = await page.locator("main").innerText();
    rec(`A ${locale}: explicit "no model configured" notice`, body.includes(m.app.officer.providerMissingNotice));
    rec(`A ${locale}: question box and send disabled (no silent submit)`,
      (await page.locator('textarea[name="question"]').isDisabled()) && (await page.locator('form:has(textarea[name="question"]) button[type="submit"]').isDisabled()));
    rec(`A ${locale}: no assistant answer stored`, (await assistantMessages(c, conv)) === 0);
    await page.screenshot({ path: `${SHOTS}/u5-A-${locale}.png`, fullPage: true });
    await page.context().browser()?.close();
  }

  // ---- B: SIMULATED connection failure (closed local port) ----
  for (const locale of ["en", "ar"] as const) {
    const m = locale === "ar" ? ar : en;
    const page = await login(B, locale);
    const conv = await openConversation(page, B, locale);
    const box = page.locator('textarea[name="question"]');
    rec(`B ${locale}: provider configured → question box enabled`, !(await box.isDisabled()));
    await box.fill(locale === "ar" ? "ما الالتزامات المتأخرة؟" : "What is overdue right now?");
    await page.locator('form:has(textarea[name="question"]) button[type="submit"]').click();
    await page.waitForURL(/error=/, { timeout: 120000 });
    await page.waitForLoadState("networkidle");
    const body = await page.locator("main").innerText();
    const prefix = m.app.officer.errorNotice.split("{code}")[0].trim();
    const code = new URL(page.url()).searchParams.get("error");
    rec(`B ${locale}: explicit failure notice with error code`, body.includes(prefix) && !!code, `code=${code}`);
    // The page's deterministic brief/command center legitimately names records;
    // a model answer would be an assistant message in this conversation.
    rec(`B ${locale}: no assistant answer stored for the failed turn`, (await assistantMessages(c, conv)) === 0);
    rec(`B ${locale}: no demo data`, !/Riyadh Metro|NEOM|ctr_/.test(body));
    await page.screenshot({ path: `${SHOTS}/u5-B-${locale}.png`, fullPage: true });
    await page.context().browser()?.close();
  }

  rec("A+B: no proposal/action rows created by a failed or absent provider", (await actionCount(c)) === before, `before=${before} after=${await actionCount(c)}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
