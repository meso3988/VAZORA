/* eslint-disable @typescript-eslint/no-explicit-any */
// Activity retrieval + assignment evidence — focused product regression.
//
// Proves against the real database (normal authenticated users, no service
// role, no model):
//   • the requested window and tenant scope are preserved
//   • sweep / observation bookkeeping cannot crowd out business changes
//     (summarized as counts, never listed)
//   • bounded keyset pagination with explicit hasMore / complete / nextBefore
//   • a page stays under the model's per-result context cap (no blind cut)
//   • readable references (contract numbers, titles) instead of raw ids
//   • contractId is honoured (it was previously accepted and ignored)
//   • assignment state is explicit and grounded (unassigned flag), not inferred
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-activity.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  seedBenchmarkOrganization, seedWindowedChanges, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MODEL_RESULT_CAP = 6000; // converse.ts MAX_RESULT_CHARS

async function main() {
  const alpha = await seedBenchmarkOrganization({ label: "actA" });
  const beta = await seedBenchmarkOrganization({ label: "actB" });
  try {
    for (const fx of [alpha, beta]) await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const ctxOf = async (fx: any, now?: Date) =>
      (await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en", ...(now ? { now } : {}) }))!;
    const A = await ctxOf(alpha);
    const B = await ctxOf(beta);
    await runContractSweep({ ctx: A, trigger: "manual" }); // writes many system rows
    await new Promise((r) => setTimeout(r, 1500));
    await seedWindowedChanges(alpha);
    const act = async (ctx: any, args: Record<string, unknown>) => runOfficerTool(ctx, "getRecentActivity", args);

    // ---- window + crowding ------------------------------------------------
    const y = await act(A, { window: "since_yesterday" });
    const d = y.ok ? (y.data as any) : null;
    const types = new Set((d?.changes ?? []).map((e: any) => e.event_type));
    check("window-since-yesterday-resolved", d?.sinceSource === "since_yesterday" && d?.since === A.clock.startOfYesterdayIso);
    check("business-changes-listed",
      ["obligation.assigned", "evidence.human_override", "evidence.version_uploaded", "obligation.due_date_confirmed"].every((t) => types.has(t)),
      [...types].join(","));
    check("system-bookkeeping-not-listed", ![...types].some((t: any) => /^officer\.(sweep|observation)_/.test(t)));
    const sys = d?.systemSummary?.counts ?? {};
    check("system-bookkeeping-summarized", (sys["officer.observation_created"] ?? 0) >= 1 && (sys["officer.sweep_completed"] ?? 0) >= 1 && d?.systemSummary?.complete === true,
      JSON.stringify(sys));
    check("completeness-explicit", d?.complete === true && d?.hasMore === false && d?.nextBefore === null);
    const size = JSON.stringify({ ok: true, data: y.ok ? y.data : null, citations: y.ok ? y.citations : [] }).length;
    check("page-under-model-cap (no blind truncation)", size < MODEL_RESULT_CAP, `${size} chars`);

    // ---- readable references ---------------------------------------------
    const assigned = (d?.changes ?? []).find((e: any) => e.event_type === "obligation.assigned");
    check("readable-obligation-reference", assigned?.label === "Monthly maintenance summary" && assigned?.contract_number === "ALPHA-100", JSON.stringify(assigned));
    const override = (d?.changes ?? []).find((e: any) => e.event_type === "evidence.human_override");
    check("readable-check-reference", override?.label === "KPI results table", JSON.stringify(override));
    // A change linked to an entity gets a readable reference; a change with no
    // entity (e.g. an untrusted note) gets none — nothing is invented.
    const linked = (d?.changes ?? []).filter((e: any) => e.entity_id);
    check("every-linked-change-has-a-readable-reference", linked.length > 0 && linked.every((e: any) => e.label || e.contract_number),
      JSON.stringify(linked.filter((e: any) => !e.label && !e.contract_number).map((e: any) => e.event_type)));
    const unlinked = (d?.changes ?? []).filter((e: any) => !e.entity_id);
    check("no-name-invented-for-unlinked-change", unlinked.every((e: any) => e.label === null), JSON.stringify(unlinked.map((e: any) => e.label)));
    check("labels-are-not-raw-ids", (d?.changes ?? []).every((e: any) => !UUID.test(String(e.label ?? ""))));

    // ---- bounded pagination ----------------------------------------------
    const seen: string[] = [];
    let before: string | undefined; let pages = 0; let lastComplete = false;
    while (pages < 10) {
      const p = await act(A, { window: "since_yesterday", limit: 2, ...(before ? { before } : {}) });
      const pd = p.ok ? (p.data as any) : null;
      if (!pd) break;
      seen.push(...pd.changes.map((e: any) => e.id));
      pages++;
      if (pages === 1) check("first-page-reports-more", pd.hasMore === true && pd.complete === false && typeof pd.nextBefore === "string");
      if (pd.complete) { lastComplete = true; break; }
      before = pd.nextBefore;
    }
    const all = (d?.changes ?? []).map((e: any) => e.id);
    check("pagination-covers-all-without-overlap", lastComplete && seen.length === all.length && new Set(seen).size === seen.length && all.every((id: string) => seen.includes(id)),
      `${seen.length}/${all.length} over ${pages} pages`);
    const bad = await act(A, { window: "since_yesterday", before: "not-a-cursor" });
    check("invalid-cursor-refused", !bad.ok && /invalid_cursor/.test(bad.error));

    // ---- contract scope ---------------------------------------------------
    const scoped = await act(A, { window: "since_yesterday", contractId: alpha.contracts.a.contractId });
    const sd = scoped.ok ? (scoped.data as any) : null;
    const scopedTypes = (sd?.changes ?? []).map((e: any) => e.event_type);
    check("contract-scope-honoured", sd?.contractScoped === true && scopedTypes.includes("obligation.assigned") && !scopedTypes.includes("evidence.human_override"),
      scopedTypes.join(","));
    const foreign = await act(A, { window: "since_yesterday", contractId: beta.contracts.a.contractId });
    check("foreign-contract-scope-refused", !foreign.ok && /contract_not_found_in_organization/.test(foreign.error));

    // ---- tenant scope -----------------------------------------------------
    const bRes = await act(B, { window: "since_yesterday", limit: 25 });
    const bIds = new Set(((bRes.ok ? (bRes.data as any).changes : []) as any[]).map((e) => e.id));
    check("tenant-scope-preserved", all.every((id: string) => !bIds.has(id)));
    const firstA = await act(A, { window: "since_yesterday", limit: 1 });
    const leakTry = await act(B, { window: "since_yesterday", before: ((firstA as any).data)?.nextBefore });
    check("cursor-cannot-cross-tenants", ((leakTry.ok ? (leakTry.data as any).changes : []) as any[]).every((e) => !all.includes(e.id)));

    // ---- window preserved under a controlled clock ------------------------
    const later = await act(await ctxOf(alpha, new Date(Date.now() + 2 * 86_400_000)), { window: "since_yesterday" });
    const ld = later.ok ? (later.data as any) : null;
    check("window-excludes-changes-recorded-before-it", ld?.changes?.length === 0 && ld?.complete === true);

    // ---- since last review keeps its own window ---------------------------
    const rev = await act(A, { sinceLastReview: true });
    const rd = rev.ok ? (rev.data as any) : null;
    const revTypes = new Set((rd?.changes ?? []).map((e: any) => e.event_type));
    check("since-last-review-window", rd?.sinceSource === "previous_sweep" && revTypes.has("obligation.due_date_confirmed") && !revTypes.has("obligation.assigned"),
      `${rd?.sinceSource} ${[...revTypes].join(",")}`);

    // ---- assignment evidence is explicit and grounded ---------------------
    const asg = await runOfficerTool(A, "getAssignments", {});
    const rows = (asg.ok ? asg.data : []) as any[];
    const eps = rows.find((r) => r.obligationId === alpha.contracts.e.obligationId);
    const alp = rows.find((r) => r.obligationId === alpha.contracts.a.obligationId);
    check("assignment-state-explicit-unassigned", eps?.unassigned === true && eps?.confirmedOwner === null, JSON.stringify(eps));
    check("assignment-state-explicit-assigned", alp?.unassigned === false && !!alp?.confirmedOwner);
  } finally {
    for (const fx of [alpha, beta]) {
      const td = await teardownBenchmarkOrganization(fx);
      const vf = await verifyBenchmarkCleanup(fx);
      check(`cleanup-${fx.orgId.slice(0, 8)}`, td.ok && vf.clean, td.error ?? vf.leftovers.join(","));
    }
  }
  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nOFFICER ACTIVITY: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
