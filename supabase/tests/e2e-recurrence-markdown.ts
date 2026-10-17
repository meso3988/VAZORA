/* eslint-disable @typescript-eslint/no-explicit-any */
// Recurring due dates + safe Markdown — browser and data-path check on a QA
// tenant. No model calls: Officer tools and the sweep run through their code
// paths (runOfficerTool / runContractSweep); Officer answers are stored rows.
//
// QA data changes (alpha tenant only):
//   GAMMA-300  due_date_normalized → null, due_rule_normalized "monthly_day_5"
//   ZETA-600   due_date_normalized → null, rule "Submit with each monthly invoice." (event-based)
// Expected dates come from the contract start in the DB and the org clock.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/e2e-recurrence-markdown.ts

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { chromium, type Browser, type Page } from "playwright";

import { buildOfficerContext } from "../../src/lib/officer/context";
import { obligationSchedule } from "../../src/lib/officer/schedule";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const st = JSON.parse(readFileSync("/tmp/qa-dashboard-tenants.json", "utf8"));
const BASE = process.env.QA_BASE ?? "http://localhost:3005";
const SHOTS = process.env.RM_SHOTS ?? "/tmp";
const msgs: Record<"en" | "ar", any> = {
  en: JSON.parse(readFileSync("src/messages/en.json", "utf8")),
  ar: JSON.parse(readFileSync("src/messages/ar.json", "utf8")),
};
const results: { t: string; ok: boolean }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };

async function login(browser: Browser, locale: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await page.goto(`${BASE}/${locale}/login`);
  await page.locator('input[name="email"]').fill(st.alpha.email);
  await page.locator('input[name="password"]').fill(st.alpha.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/\/(en|ar)\/app/, { timeout: 60000 });
  return page;
}

async function main() {
  const c: any = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email: st.alpha.email, password: st.alpha.password });
  const { data: me } = await c.auth.getUser();
  const org = st.alpha.orgId;
  const ctx = (await buildOfficerContext({ supabase: c, organizationId: org, userId: me.user.id, locale: "en" }))!;
  const today = ctx.clock.today;
  const { data: ks } = await c.from("contracts").select("id, contract_number, start_date, end_date").eq("organization_id", org);
  const K = Object.fromEntries((ks ?? []).map((k: any) => [k.contract_number, k]));
  const ob = async (no: string) => (await c.from("contract_obligations").select("id").eq("organization_id", org).eq("contract_id", K[no].id).single()).data.id as string;
  const gammaOb = await ob("GAMMA-300"), zetaOb = await ob("ZETA-600");
  await c.from("contract_obligations").update({ due_date_normalized: null, due_rule_normalized: "monthly_day_5", frequency: "monthly" }).eq("id", gammaOb);
  await c.from("contract_obligations").update({ due_date_normalized: null, due_rule_normalized: "Submit with each monthly invoice.", frequency: "monthly" }).eq("id", zetaOb);
  const expected: any = obligationSchedule({ dueDateNormalized: null, dueRuleNormalized: "monthly_day_5", frequency: "monthly", contractStart: K["GAMMA-300"].start_date, contractEnd: K["GAMMA-300"].end_date, today });
  console.log(`today ${today} (${ctx.clock.timeZone}) · GAMMA-300 start ${K["GAMMA-300"].start_date} · expected ${JSON.stringify(expected)}`);

  // ---- Officer tools (no model) ----
  const lo: any = await runOfficerTool(ctx, "listObligations", { contractId: K["GAMMA-300"].id });
  const row = (lo.data ?? [])[0];
  rec("Officer listObligations: operational date = oldest unsettled cycle", row?.due_date_operational === expected.firstUnsettled && row?.window === "overdue", `${row?.due_date_operational} ${row?.window} ${row?.daysOverdue}d`);
  rec("Officer listObligations: unsettled cycles and next cycle reported", row?.schedule?.unsettled_past_cycles === expected.unsettledPastCount && row?.schedule?.next_cycle_due === expected.nextDue);
  const od: any = await runOfficerTool(ctx, "getOverdueObligations", {});
  rec("Officer getOverdueObligations includes the unsettled recurring obligation", (od.data?.obligations ?? []).some((o: any) => o.id === gammaOb));
  const lz: any = await runOfficerTool(ctx, "listObligations", { contractId: K["ZETA-600"].id });
  rec("Officer: event-based rule → needs_schedule", lz.data?.[0]?.window === "needs_schedule" && lz.data?.[0]?.schedule?.reason === "unsupported_rule");

  // ---- Sweep (no model), twice: the overdue finding is stable ----
  for (const run of [1, 2]) {
    const s = await runContractSweep({ ctx, trigger: "manual" });
    const { data: obs } = await c.from("officer_observations").select("dedupe_key, status, supporting_facts").eq("organization_id", org).eq("dedupe_key", `overdue:${gammaOb}`);
    const o = obs?.[0];
    rec(`sweep run ${run}: overdue finding on the same cycle date`, s.status === "completed" && o?.status !== "resolved" && o?.supporting_facts?.due_date === expected.firstUnsettled, `${s.status} · ${o?.status} · due ${o?.supporting_facts?.due_date}`);
  }

  // ---- UI: list, overview, obligations tab (EN/AR) ----
  for (const locale of ["en", "ar"] as const) {
    const page = await login(browser, locale);
    await page.goto(`${BASE}/${locale}/app/contracts`);
    await page.waitForLoadState("networkidle");
    const od2 = page.locator(`tr:has(:text("GAMMA-300")) [data-indicator="obligationsOverdue"]`).first();
    rec(`${locale} contracts list: GAMMA-300 overdue = 1`, (await od2.getAttribute("data-state")) === "value" && (await od2.innerText()).trim() === "1");
    await page.goto(`${BASE}/${locale}/app/contracts/${K["GAMMA-300"].id}`);
    await page.waitForLoadState("networkidle");
    const kpi = page.locator(`main [data-indicator="obligationsOverdue"]`).first();
    rec(`${locale} overview KPI: overdue = 1`, (await kpi.innerText()).trim() === "1");
    await page.goto(`${BASE}/${locale}/app/contracts/${K["GAMMA-300"].id}/obligations`);
    await page.waitForLoadState("networkidle");
    const cell = page.locator("tbody tr").first();
    rec(`${locale} obligations tab: due column = oldest unsettled cycle`, (await cell.locator("[data-ob-due]").getAttribute("data-ob-due")) === expected.firstUnsettled);
    rec(`${locale} obligations tab: overdue + unsettled cycles + next cycle shown`,
      (await cell.locator("[data-ob-deadline]").getAttribute("data-ob-deadline")) === "overdue" &&
      (await cell.locator("[data-ob-unsettled]").getAttribute("data-ob-unsettled")) === String(expected.unsettledPastCount) &&
      (await cell.locator("[data-ob-next-cycle]").getAttribute("data-ob-next-cycle")) === expected.nextDue);
    await page.screenshot({ path: `${SHOTS}/rm-${locale}-gamma-obligations.png`, fullPage: true });
    await page.goto(`${BASE}/${locale}/app/contracts/${K["ZETA-600"].id}/obligations`);
    await page.waitForLoadState("networkidle");
    const z = page.locator("tbody tr").first();
    rec(`${locale} event-based rule: "schedule needs definition" with reason, not "no due date"`,
      (await z.locator("[data-ob-deadline]").getAttribute("data-ob-deadline")) === "needs_schedule" &&
      (await z.locator("[data-ob-schedule-reason]").getAttribute("data-ob-schedule-reason")) === "unsupported_rule" &&
      (await z.innerText()).includes(msgs[locale].app.obligationState.deadline.needs_schedule));
    await page.screenshot({ path: `${SHOTS}/rm-${locale}-zeta-obligations.png`, fullPage: true });
    await page.context().close();
  }

  // ---- Markdown: stored answers rendered safely (EN/AR, desktop/mobile) ----
  const stored = JSON.parse(readFileSync("supabase/tests/evidence/2026-10-05-release-completion/live-journey/officer-conversation.json", "utf8")).find((m: any) => m.role === "assistant").content;
  const evil = "Check [portal](javascript:alert(1)) and https://evil.example/x\n\n<script>alert(1)</script><img src=x onerror=alert(1)>\n\n![pixel](https://evil.example/p.png)";
  const arabic = "## ملخص الالتزامات\n\n- **تقرير الأداء الشهري** متأخر\n- شهادة الجاهزية\n\n| البند | الحالة |\n|---|---|\n| 5.1 | ناقص |";
  const { data: conv } = await c.from("officer_conversations").insert({ organization_id: org, created_by: me.user.id, scope: "contract", contract_id: K["GAMMA-300"].id, title: "QA markdown display" }).select("id").single();
  for (const content of [stored, evil, arabic]) {
    const { error } = await c.from("officer_messages").insert({ organization_id: org, conversation_id: conv.id, role: "assistant", content });
    if (error) throw new Error(`insert message: ${error.message}`);
  }
  for (const [locale, vp] of [["en", undefined], ["ar", undefined], ["en", { width: 390, height: 844 }], ["ar", { width: 390, height: 844 }]] as const) {
    const tag = `${locale}${vp ? " mobile" : ""}`;
    const page = await login(browser, locale, vp as any);
    await page.goto(`${BASE}/${locale}/app/agent?c=${conv.id}`);
    await page.waitForLoadState("networkidle");
    const md = page.locator("[data-md]");
    rec(`${tag} markdown: tables rendered (stored answer + Arabic), no raw pipes or **`, (await md.locator("table").count()) === 2 && !(await md.allInnerTexts()).join(" ").match(/\|---\||\*\*/));
    rec(`${tag} markdown: no anchors, scripts, images or javascript: in answers`,
      (await md.locator("a, script, img, iframe").count()) === 0 && !(await page.content()).includes("javascript:alert"));
    rec(`${tag} markdown: model link text kept as plain text`, (await md.locator("[data-md-link-text]").count()) >= 1);
    if (vp) rec(`${tag}: no page-level horizontal overflow`, !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)));
    await page.screenshot({ path: `${SHOTS}/rm-markdown-${locale}${vp ? "-mobile" : ""}.png`, fullPage: true });
    await page.context().close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

let browser: Browser;
chromium.launch().then((b) => { browser = b; return main(); }).then(() => browser.close()).catch((e) => { console.error(e); process.exit(1); });
