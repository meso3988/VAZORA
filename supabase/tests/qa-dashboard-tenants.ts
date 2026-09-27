/* eslint-disable @typescript-eslint/no-explicit-any */
// QA driver for the dashboard data-provenance check. No model calls.
//
//   setup     Alpha  = v3 benchmark fixture (ALPHA-100 … ZETA-600) + 1 real proposal + sweep
//             Beta   = officer fixture (OM-014, FM-008, OPS-021)   + 2 real proposals + sweep
//             Empty  = organization with no contracts, never swept
//   teardown  delete exactly these three organizations (by id)
//
// Logins/ids live in /tmp/qa-dashboard-tenants.json — never in the repo.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-dashboard-tenants.ts <setup|teardown>

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { createClient } from "@supabase/supabase-js";
import { seedBenchmarkOrganization } from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerFixture } from "./officer-fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const STATE = "/tmp/qa-dashboard-tenants.json";
const anon = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as any;

async function prepare(fx: { client: any; orgId: string; userId: string }, proposals: { contractId: string; summary: string }[]) {
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
  const ctx = (await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" }))!;
  const ids: string[] = [];
  for (const p of proposals) {
    const r = await runOfficerTool(ctx, "requestHumanApproval", {
      actionType: "officer.escalate", summary: p.summary, reason: "QA provenance check — real proposal", contractId: p.contractId,
    });
    if (!r.ok) throw new Error(`proposal failed: ${r.error}`);
    ids.push((r.data as any).id);
  }
  const s = await runContractSweep({ ctx, trigger: "manual" });
  if (s.status !== "completed") throw new Error(`sweep ${s.status}`);
  return ids;
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "setup") {
    const a = await seedBenchmarkOrganization({ label: "dashA" });
    const aProps = await prepare(a, [{ contractId: a.contracts.c.contractId, summary: "Alpha escalation on GAMMA-300" }]);
    const b = await buildOfficerFixture({ label: "dashB" });
    const bProps = await prepare(b as any, [
      { contractId: b.om.contractId, summary: "Beta escalation on OM-014" },
      { contractId: b.fm.contractId, summary: "Beta escalation on FM-008" },
    ]);
    // Empty: a real organization with no contracts, never swept.
    const e = anon();
    const email = `qa-dash-empty-${Date.now()}@vazora.test`;
    const password = `Qa!${crypto.randomUUID()}`;
    const { data: auth, error } = await e.auth.signUp({ email, password });
    if (error || !auth.user) throw new Error(`signUp: ${error?.message}`);
    const orgId = crypto.randomUUID();
    const o = await e.from("organizations").insert({ id: orgId, name: "QA Dashboard Empty", slug: `qa-dash-empty-${Date.now()}`, created_by: auth.user.id });
    if (o.error) throw new Error(`org: ${o.error.message}`);
    const mbr = await e.from("organization_members").insert({ organization_id: orgId, user_id: auth.user.id, role: "owner" });
    if (mbr.error) throw new Error(`member: ${mbr.error.message}`);
    const state = {
      alpha: { email: a.email, password: a.password, orgId: a.orgId, numbers: ["ALPHA-100", "BETA-200", "GAMMA-300", "DELTA-400", "EPSILON-500", "ZETA-600"], proposals: aProps },
      beta: { email: b.email, password: b.password, orgId: b.orgId, numbers: ["OM-014", "FM-008", "OPS-021"], proposals: bProps },
      empty: { email, password, orgId, numbers: [], proposals: [] },
    };
    writeFileSync(STATE, JSON.stringify(state, null, 2));
    console.log(`setup: alpha ${a.orgId} (${aProps.length} proposal) · beta ${b.orgId} (${bProps.length} proposals) · empty ${orgId}`);
    return;
  }
  if (cmd === "teardown") {
    if (!existsSync(STATE)) throw new Error("no state file");
    const st = JSON.parse(readFileSync(STATE, "utf8"));
    for (const [name, t] of Object.entries<any>(st)) {
      const c = anon();
      const { error: se } = await c.auth.signInWithPassword({ email: t.email, password: t.password });
      if (se) { console.log(`teardown ${name}: sign-in failed ${se.message}`); continue; }
      const { data: org } = await c.from("organizations").select("id, slug").eq("id", t.orgId).maybeSingle();
      if (!org || !/^qa-(bench-dashA|off-fx-dashB|dash-empty)-/.test(org.slug)) { console.log(`teardown ${name}: REFUSED (${org?.slug ?? "not found"})`); continue; }
      const { error } = await c.from("organizations").delete().eq("id", t.orgId);
      const left: string[] = [];
      for (const tbl of ["organizations", "organization_members", "contracts", "contract_obligations", "officer_observations", "officer_actions", "officer_sweep_runs", "activity_log"]) {
        const { count } = await c.from(tbl).select("id", { count: "exact", head: true }).eq(tbl === "organizations" ? "id" : "organization_id", t.orgId);
        if ((count ?? 0) > 0) left.push(`${tbl}:${count}`);
      }
      console.log(`teardown ${name}: ${error ? `FAIL ${error.message}` : "deleted"} ${t.orgId} (${org.slug}) leftovers=${left.join(",") || "0"}`);
    }
    rmSync(STATE);
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
