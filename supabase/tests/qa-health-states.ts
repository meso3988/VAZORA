/* eslint-disable @typescript-eslint/no-explicit-any */
// QA driver for the contract-health incomplete-state browser check.
// Isolated synthetic tenant (v3 benchmark fixture), normal authenticated
// client, no model. Test-only fault injection runs HERE, never in the server.
//
//   setup     seed tenant, no sweep                → never assessed
//   partial   clean sweep, then a sweep whose EPSILON-500 scan fails
//                                                   → known issues + incomplete coverage, history
//   readfail  fill the observation read past its limit
//                                                   → required read incomplete (truncated)
//   recover   retire the filler rows, clean sweep   → complete again
//   teardown  delete exactly this tenant
//
// State (login + ids) lives in /tmp/qa-health-states.json — never in the repo.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-health-states.ts <command>

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { createClient } from "@supabase/supabase-js";
import {
  seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { faulty, hasCall } from "./fault-injection";

const STATE = "/tmp/qa-health-states.json";
const cmd = process.argv[2];

async function signedIn(st: any) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const { error } = await client.auth.signInWithPassword({ email: st.email, password: st.password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  const ctx = (await buildOfficerContext({ supabase: client, organizationId: st.orgId, userId: st.userId, locale: "en" }))!;
  return { client, ctx };
}

async function main() {
  if (cmd === "setup") {
    const fx = await seedBenchmarkOrganization({ label: "uistate" });
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    writeFileSync(STATE, JSON.stringify({ email: fx.email, password: fx.password, orgId: fx.orgId, userId: fx.userId,
      eps: fx.contracts.e.contractId, contracts: Object.fromEntries(Object.values<any>(fx.contracts).map((c) => [c.number, c.contractId])) }, null, 2));
    console.log(`setup: tenant ${fx.orgId} seeded, no sweep (never assessed)`);
    return;
  }
  if (!existsSync(STATE)) throw new Error("run setup first");
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const { client, ctx } = await signedIn(st);

  if (cmd === "partial") {
    const ok = await runContractSweep({ ctx, trigger: "manual" });
    const { data: done } = await client.from("officer_sweep_runs").select("completed_at")
      .eq("organization_id", st.orgId).eq("status", "completed").order("started_at", { ascending: false }).limit(1).maybeSingle();
    const label = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh", numberingSystem: "latn" }).format(new Date(iso));
    // Let the clock reach the next minute so the partial run's time differs.
    const minute = label(new Date().toISOString());
    while (label(new Date().toISOString()) === minute) await new Promise((r) => setTimeout(r, 2000));
    const bad = await runContractSweep({ ctx: { ...ctx, supabase: faulty(client, (t, calls) =>
      t === "contract_obligations" && hasCall(calls, "eq", (a) => a[0] === "contract_id" && a[1] === st.eps) ? "throw" : null) }, trigger: "manual" });
    st.completedAtLabel = label(done.completed_at);
    st.partialAtLabel = label(new Date().toISOString());
    writeFileSync(STATE, JSON.stringify(st, null, 2));
    console.log(`partial: clean sweep ${ok.status} (completed ${st.completedAtLabel}), then ${bad.status} (${st.partialAtLabel}) with failures ${JSON.stringify(bad.failures)}`);
  } else if (cmd === "readfail") {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      organization_id: st.orgId, kind: "qa_filler", priority: 4, title: `QA filler ${i}`, status: "active",
      dedupe_key: `qa-filler-${i}`, severity: "informational", time_bucket: "monitoring",
    }));
    for (let i = 0; i < rows.length; i += 250) {
      const { error } = await client.from("officer_observations").insert(rows.slice(i, i + 250));
      if (error) throw new Error(`filler insert failed: ${error.message}`);
    }
    console.log("readfail: 1000 filler observations inserted — the observation read is now truncated");
  } else if (cmd === "recover") {
    const { data, error } = await client.from("officer_observations")
      .update({ status: "resolved", resolved_at: "2000-01-01T00:00:00Z", time_bucket: "resolved" })
      .eq("organization_id", st.orgId).eq("kind", "qa_filler").select("id");
    if (error) throw new Error(`filler retire failed: ${error.message}`);
    const s = await runContractSweep({ ctx, trigger: "manual" });
    console.log(`recover: ${data?.length ?? 0} filler rows retired; clean sweep ${s.status} ${JSON.stringify(s.failures)}`);
  } else if (cmd === "teardown") {
    const fx: any = { client, orgId: st.orgId };
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`teardown: ${td.ok && vf.clean ? "ok" : "FAIL"} org=${st.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
  } else {
    throw new Error(`unknown command ${cmd}`);
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
