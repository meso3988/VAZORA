/* eslint-disable @typescript-eslint/no-explicit-any */
// Cycle records (pre-migration, fail-closed) + review correction of the
// external dependency / payment link — browser and data path on ONE new QA
// tenant. No model calls. The tenant id is written to QA_STATE before any test
// step and the tenant is torn down in `finally`.
//
//   ALPHA-100  due rule → monthly_day_5 (recurring; reads completion records)
//   GAMMA-300  the clause-15 case: external dependency "Availability of the
//              Client portal" marked inferred, payment link not determined,
//              review_status back to "extracted"; reviewer corrects it in the UI
//
// Run: QA_BASE=http://localhost:3001 node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/e2e-cycles-review.ts

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup } from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { readCycleSettlements } from "../../src/data/supabase/cycle-settlements";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const BASE = process.env.QA_BASE ?? "http://localhost:3001";
const SHOTS = process.env.CR_SHOTS ?? join(homedir(), ".vazora-qa", "shots");
const QA_STATE = join(homedir(), ".vazora-qa", "cycles-review-tenant.json");
const msgs: Record<"en" | "ar", any> = {
  en: JSON.parse(readFileSync("src/messages/en.json", "utf8")),
  ar: JSON.parse(readFileSync("src/messages/ar.json", "utf8")),
};
const results: { t: string; ok: boolean }[] = [];
const rec = (t: string, ok: boolean, d = "") => { results.push({ t, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${t}${d ? " — " + d : ""}`); };
const PORTAL = "Availability of the Client portal";

async function login(browser: Browser, fx: any, locale: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${BASE}/${locale}/login`);
    await page.locator('input[name="email"]').fill(fx.email);
    await page.locator('input[name="password"]').fill(fx.password);
    await page.locator('form button[type="submit"]').first().click();
    try {
      await page.waitForURL(/\/(en|ar)\/app/, { timeout: 45000 });
      return page;
    } catch (e) {
      await page.screenshot({ path: join(SHOTS, `login-timeout-${locale}-${attempt}.png`) });
      console.log(`login ${locale} attempt ${attempt} timed out: ${(await page.locator("main").innerText().catch(() => "")).slice(0, 200).replace(/\s+/g, " ")}`);
      if (attempt >= 2) throw e;
      await page.waitForTimeout(10000);
    }
  }
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const fx: any = await seedBenchmarkOrganization({ label: "cyrev" });
  writeFileSync(QA_STATE, JSON.stringify({ orgId: fx.orgId, email: fx.email, password: fx.password, createdAt: new Date().toISOString() }));
  console.log(`QA tenant ${fx.orgId} (state ${QA_STATE})`);
  let browser: Browser | null = null;
  try {
    const c = fx.client;
    await ensureOfficerProfile({ supabase: c, organizationId: fx.orgId });
    const ctx = (await buildOfficerContext({ supabase: c, organizationId: fx.orgId, userId: fx.userId, locale: "en" }))!;
    const A = fx.contracts.a, C = fx.contracts.c;

    // ===== Part 1: completion records before migration 0015 is applied =====
    const probe = await c.from("obligation_cycle_settlements").select("id").limit(1);
    rec("environment: obligation_cycle_settlements is not present (0015 not applied here)", !!probe.error, probe.error?.code ?? "table present");
    await c.from("contract_obligations").update({ due_date_normalized: null, due_rule_normalized: "monthly_day_5", frequency: "monthly" }).eq("id", A.obligationId);
    const sr = await readCycleSettlements(c, fx.orgId, [A.obligationId]);
    rec("reader: missing table → { ok: false }, never 'no completions'", sr.ok === false);
    const lo: any = await runOfficerTool(ctx, "listObligations", { contractId: A.contractId });
    const row = lo.data?.[0];
    rec("Officer: completion records unknown is stated, not 'not completed'", lo.ok && row?.schedule?.settled_cycles === null && /could not be read/.test(row?.schedule?.note ?? ""), JSON.stringify(row?.schedule ?? lo.error).slice(0, 220));
    const s1 = await runContractSweep({ ctx, trigger: "manual" });
    rec("sweep: the recurring contract's scan fails, run is partial (not completed)", s1.status === "partial" && s1.failures.some((f: any) => f.contract_id === A.contractId), `${s1.status} ${JSON.stringify(s1.failures)}`);

    browser = await chromium.launch();
    // Two real sign-ins in total (auth rate limits): one here, one after the
    // correction; the other views reuse that signed-in session.
    const first = await login(browser, fx, "en");
    const session1 = await first.context().storageState();
    await first.context().close();
    const view = async (state: any, vp?: { width: number; height: number }) => (await browser!.newContext({ storageState: state, ...(vp ? { viewport: vp } : {}) })).newPage();
    for (const [locale, vp] of [["en", undefined], ["ar", undefined], ["en", { width: 390, height: 844 }], ["ar", { width: 390, height: 844 }]] as const) {
      const tag = `${locale}${vp ? "-mobile" : ""}`;
      const page = await view(session1, vp);
      await page.goto(`${BASE}/${locale}/app/contracts/${A.contractId}/obligations`);
      await page.waitForLoadState("networkidle");
      const unavailable = await page.locator("[data-cycles-unavailable]").count();
      const anyState = await page.locator("[data-cycle-state]").count();
      const text = await page.locator("main").innerText();
      rec(`UI ${tag}: cycles panel says records could not be loaded; no cycle shown completed or not`, unavailable === 1 && anyState === 0 && text.includes(msgs[locale].app.cycles.unavailable));
      rec(`UI ${tag}: no 'no completion documented' claim while records are unknown`, !text.includes(msgs[locale].app.cycles.noRecord));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (vp) rec(`UI ${tag}: no horizontal overflow`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: join(SHOTS, `cycles-unavailable-${tag}.png`), fullPage: true });
      await page.context().close();
    }

    // ===== Part 2: the clause-15 case — inferred external dependency =====
    const { data: before } = await c.from("contract_obligations").select("ai_payload, field_provenance").eq("id", C.obligationId).single();
    const prov0 = { ...(before.field_provenance ?? {}), external_dependency: "inferred" };
    await c.from("contract_obligations").update({
      requires_external_acknowledgement: false, external_dependency: PORTAL, payment_linked: null, field_provenance: prov0,
    }).eq("id", C.obligationId);
    const s2 = await runContractSweep({ ctx, trigger: "manual" });
    const ext0 = (await c.from("officer_observations").select("status, supporting_facts").eq("organization_id", fx.orgId).eq("dedupe_key", `external_pending:${C.req.reqId}`).maybeSingle()).data;
    rec("before correction: sweep reports 'waiting on external party' marked inferred_unconfirmed", ext0?.status === "active" && ext0?.supporting_facts?.external_dependency === PORTAL && ext0?.supporting_facts?.external_dependency_provenance === "inferred_unconfirmed", `${s2.status} ${JSON.stringify(ext0?.supporting_facts ?? null).slice(0, 200)}`);
    await c.from("contract_obligations").update({ review_status: "extracted", reviewed_by: null, reviewed_at: null }).eq("id", C.obligationId);

    // Reviewer corrects it in the UI (EN desktop), then the persisted value is
    // checked after a fresh login in AR and on mobile.
    const page = await view(session1);
    await page.goto(`${BASE}/en/app/contracts/${C.contractId}/review`);
    await page.waitForLoadState("networkidle");
    { const b = page.getByRole("button", { name: /Client-acknowledged performance report/ }).first(); if (await b.isVisible().catch(() => false)) await b.click(); }
    const shownBefore = await page.locator("main").innerText();
    rec("review: inferred dependency visible with its 'Inferred' state before approval", shownBefore.includes(PORTAL) && shownBefore.includes(msgs.en.app.review.states?.inferred ?? "Inferred"));
    await page.getByRole("button", { name: msgs.en.app.review.actions.edit }).first().click();
    await page.locator('select[name="external_dependency_decision"]').selectOption("none");
    await page.locator('select[name="payment_link_decision"]').selectOption("unknown");
    await page.locator('form input[name="note"]').fill("Clause 15 names a submission channel only; no external party dependency.");
    await page.locator('select[name="external_dependency_decision"]').locator("xpath=ancestor::form").locator('button[type="submit"]').click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(SHOTS, "review-corrected-en.png"), fullPage: true });
    await page.context().close();

    const { data: after } = await c.from("contract_obligations").select("review_status, external_dependency, payment_linked, field_provenance, ai_payload, reviewed_values, reviewed_by").eq("id", C.obligationId).single();
    rec("review: corrected value persisted (external dependency none, approved by the session user)", after.review_status === "approved" && after.external_dependency === null && after.reviewed_by === fx.userId, JSON.stringify({ s: after.review_status, e: after.external_dependency }));
    rec("review: payment link 'not determined' stays null, never false", after.payment_linked === null);
    rec("review: provenance records the human correction (not 'model was right')", after.field_provenance?.external_dependency === "human_corrected" && after.field_provenance?.payment_linked === "human_confirmed", JSON.stringify(after.field_provenance));
    rec("review: original model output (ai_payload) not overwritten", JSON.stringify(after.ai_payload) === JSON.stringify(before.ai_payload));
    const { data: logs } = await c.from("activity_log").select("actor_user_id, metadata, created_at").eq("organization_id", fx.orgId).eq("event_type", "obligation.edited").eq("entity_id", C.obligationId);
    const lg = logs?.[0];
    rec("audit: before/after, decisions, note and actor recorded", logs?.length === 1 && lg.actor_user_id === fx.userId && lg.metadata?.before?.external_dependency === PORTAL && lg.metadata?.after?.external_dependency === null && lg.metadata?.decisions?.external_dependency === "none" && !!lg.metadata?.note);

    await new Promise((r) => setTimeout(r, 20000));
    const relogin = await login(browser, fx, "ar");
    const session2 = await relogin.context().storageState();
    await relogin.context().close();
    for (const [locale, vp] of [["ar", undefined], ["en", { width: 390, height: 844 }]] as const) {
      const tag = `${locale}${vp ? "-mobile" : ""}`;
      const p = await view(session2, vp);
      await p.goto(`${BASE}/${locale}/app/contracts/${C.contractId}/review`);
      await p.waitForLoadState("networkidle");
      { const b = p.getByRole("button", { name: /Client-acknowledged performance report/ }).first(); if (await b.isVisible().catch(() => false)) await b.click(); }
      const txt = await p.locator("main").innerText();
      const corrected = msgs[locale].app.review.states?.human_corrected;
      rec(`after re-login ${tag}: corrected state shown, wrong dependency gone`, !txt.includes(PORTAL) && (!corrected || txt.includes(corrected)), corrected ?? "(no label)");
      await p.screenshot({ path: join(SHOTS, `review-after-relogin-${tag}.png`), fullPage: true });
      await p.context().close();
    }

    const lo2: any = await runOfficerTool(ctx, "listObligations", { contractId: C.contractId });
    rec("Officer reads the reviewed value (no external dependency)", lo2.ok && lo2.data?.[0]?.external_dependency == null && lo2.data?.[0]?.external_dependency_provenance === "human_corrected", JSON.stringify({ e: lo2.data?.[0]?.external_dependency, p: lo2.data?.[0]?.external_dependency_provenance }));
    const s3 = await runContractSweep({ ctx, trigger: "manual" });
    const obs = (await c.from("officer_observations").select("dedupe_key, status, title").eq("organization_id", fx.orgId).in("dedupe_key", [`external_pending:${C.req.reqId}`, `missing_evidence:${C.req.reqId}`])).data ?? [];
    const ext1 = obs.find((o: any) => o.dedupe_key.startsWith("external_pending"));
    const miss1 = obs.find((o: any) => o.dedupe_key.startsWith("missing_evidence"));
    rec("sweep after correction: 'waiting on external party' resolved (history kept), missing evidence reported instead", ext1?.status === "resolved" && miss1?.status === "active", `${s3.status} ext=${ext1?.status} miss=${miss1?.status}`);
    rec("sweep after correction: the gap stays open (correction closes nothing)", ((await c.from("evidence_gaps").select("id").eq("organization_id", fx.orgId).eq("obligation_id", C.obligationId).eq("status", "open")).data ?? []).length > 0);
  } finally {
    if (browser) await browser.close();
    const td = await teardownBenchmarkOrganization(fx);
    const cl = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok ? "ok" : "FAIL " + td.error} org=${fx.orgId} leftovers=${cl.leftovers.join(",") || "none"}`);
    if (td.ok && cl.clean) rmSync(QA_STATE, { force: true });
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
