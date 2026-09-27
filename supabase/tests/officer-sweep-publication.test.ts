/* eslint-disable @typescript-eslint/no-explicit-any */
// Sweep publication edge cases — real DB, normal authenticated client,
// test-only fault injection (supabase/tests/fault-injection.ts). No model.
//
//   Z  an UPDATE that returns no error but affects ZERO rows must not count
//      as a successful write / resolution / publication.
//   P  a failure AFTER an earlier resolution in the same contract must not
//      leave that contract partially resolved.
//
// Assertions are on persisted database state, not on internal call shapes.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-sweep-publication.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { assessContractHealth } from "../../src/lib/officer/health";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { faulty, hasCall, type Rule } from "./fault-injection";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const fx = await seedBenchmarkOrganization({ label: "pub" });
  try {
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const ctx = (await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" }))!;
    const withRule = (rule: Rule) => ({ ...ctx, supabase: faulty(fx.client, rule) });
    const beta = fx.contracts.b.contractId, eps = fx.contracts.e.contractId, gamma = fx.contracts.c.contractId;
    const rows = async () => ((await fx.client.from("officer_observations")
      .select("id, dedupe_key, status, contract_id, kind, resolved_at, last_seen_at")
      .eq("organization_id", fx.orgId)).data ?? []) as any[];
    const activeFor = async (cid: string) => (await rows()).filter((r) => r.contract_id === cid && (r.status === "active" || r.status === "acknowledged"));
    const lastRun = async () => (await fx.client.from("officer_sweep_runs").select("id, status, observations_updated, observations_resolved")
      .eq("organization_id", fx.orgId).order("started_at", { ascending: false }).limit(1).maybeSingle()).data as any;
    const byNo = (hs: any[], n: string) => hs.find((h) => h.contractNumber === n);
    const snapshot = async (label: string) => {
      const r = await rows();
      console.log(`  [db] ${label}: ${["BETA-200", "EPSILON-500", "GAMMA-300"].map((n) => {
        const cid = n === "BETA-200" ? beta : n === "EPSILON-500" ? eps : gamma;
        const mine = r.filter((x) => x.contract_id === cid);
        return `${n} active=${mine.filter((x) => x.status === "active").length} resolved=${mine.filter((x) => x.status === "resolved").length}`;
      }).join(" · ")}`);
    };

    const s0 = await runContractSweep({ ctx, trigger: "manual" });
    check("baseline sweep completed", s0.status === "completed", s0.status);
    const betaObs = await activeFor(beta);
    check("BETA-200 has two active observations to replace", betaObs.length === 2, betaObs.map((o) => o.kind).join(","));
    await snapshot("baseline");

    // ---- Z1: touch UPDATE for EPSILON-500 affects zero rows ---------------------------
    const epsIds = new Set((await activeFor(eps)).map((o) => o.id));
    const z1b = await runContractSweep({ ctx: withRule((t, calls) => {
      if (t !== "officer_observations" || !hasCall(calls, "update", (a) => !a[0]?.status && !!a[0]?.last_seen_at)) return null;
      const id = calls.find((c) => c.m === "eq" && c.args[0] === "id")?.args[1];
      return epsIds.has(id) ? "zero" : null;
    }), trigger: "manual" });
    check("Z1 zero-row observation UPDATE → EPSILON-500 recorded as a failed write", z1b.failures.some((f) => f.contract_id === eps), JSON.stringify(z1b.failures));
    check("Z1 zero-row UPDATE not counted as an update", z1b.updated < s0.created, `updated=${z1b.updated} vs observations=${s0.created}`);
    const hz1 = await assessContractHealth(ctx);
    check("Z1 EPSILON-500 coverage incomplete (no false successful assessment)", byNo(hz1, "EPSILON-500").coverage.complete === false, byNo(hz1, "EPSILON-500").coverage.gaps.join("|"));
    await runContractSweep({ ctx, trigger: "manual" });

    // ---- Z2: resolution affects zero rows -----------------------------------------------
    // Replacement scan for GAMMA-300 sees no obligations (conditions gone) → its
    // observations are due for resolution; the resolution affects zero rows.
    const gammaBefore = await activeFor(gamma);
    const z2 = await runContractSweep({ ctx: withRule((t, calls) => {
      if (t === "contract_obligations" && hasCall(calls, "eq", (a) => a[0] === "contract_id" && a[1] === gamma)) return "empty";
      if (t === "officer_observations" && hasCall(calls, "update", (a) => a[0]?.status === "resolved")) return "zero";
      if (t === "rpc:officer_resolve_observations") return "zero";
      return null;
    }), trigger: "manual" });
    const gammaAfter = await activeFor(gamma);
    check("Z2 zero-row resolution → GAMMA-300 recorded as failed, resolved count not incremented",
      z2.failures.some((f) => f.contract_id === gamma) && z2.resolved === 0, `failures=${JSON.stringify(z2.failures)} resolved=${z2.resolved}`);
    check("Z2 GAMMA-300 observations still active in the database", gammaBefore.length > 0 && gammaAfter.length === gammaBefore.length, `${gammaBefore.length} → ${gammaAfter.length}`);
    const hz2 = await assessContractHealth(ctx);
    check("Z2 GAMMA-300 not presented as assessed/clean", byNo(hz2, "GAMMA-300").coverage.complete === false && byNo(hz2, "GAMMA-300").verdict !== "no_actionable_issues_recorded");

    // ---- Z3: final publication UPDATE affects zero rows ---------------------------------
    const z3 = await runContractSweep({ ctx: withRule((t, calls) =>
      t === "officer_sweep_runs" && hasCall(calls, "update", (a) => typeof a[0]?.status === "string") ? "zero" : null), trigger: "manual" });
    const lr = await lastRun();
    check("Z3 zero-row publication → outcome not reported as published", z3.status === "failed" && !z3.ok, z3.status);
    check("Z3 persisted run not published (still running)", lr?.status === "running", lr?.status);
    await runContractSweep({ ctx, trigger: "manual" });

    // ---- P: failure AFTER an earlier resolution in the same contract ---------------------
    // BETA-200 and EPSILON-500 both lose their findings (empty obligation read);
    // EPSILON-500 must resolve cleanly; BETA-200's SECOND resolution fails.
    const betaIds = new Set((await activeFor(beta)).map((o) => o.id));
    const epsBefore = await activeFor(eps);
    await snapshot("before P");
    let betaResolveCalls = 0;
    const p = await runContractSweep({ ctx: withRule((t, calls) => {
      if (t === "contract_obligations" && hasCall(calls, "eq", (a) => a[0] === "contract_id" && (a[1] === beta || a[1] === eps))) return "empty";
      if (t === "officer_observations" && hasCall(calls, "update", (a) => a[0]?.status === "resolved")) {
        const id = calls.find((c) => c.m === "eq" && c.args[0] === "id")?.args[1];
        if (betaIds.has(id)) { betaResolveCalls++; return betaResolveCalls === 2 ? "error" : null; }
      }
      if (t === "rpc:officer_resolve_observations") {
        const ids: string[] = calls[0]?.args[0]?.p_ids ?? [];
        if (ids.some((id) => betaIds.has(id))) return "error";
      }
      return null;
    }), trigger: "manual" });
    await snapshot("after P");
    const betaAfter = await activeFor(beta);
    check("P sweep reports BETA-200 failed (partial)", p.status === "partial" && p.failures.some((f) => f.contract_id === beta), JSON.stringify(p.failures));
    check("P BETA-200: NO observation resolved (no partial resolution exposed)", betaAfter.length === betaIds.size, `${betaIds.size} → ${betaAfter.length} active`);
    check("P EPSILON-500 (independent) resolved successfully", epsBefore.length > 0 && (await activeFor(eps)).length === 0, `${epsBefore.length} → ${(await activeFor(eps)).length}`);
    const hp = await assessContractHealth(ctx);
    check("P BETA-200 health: known issues + incomplete coverage", byNo(hp, "BETA-200").verdict === "actionable_issues" && !byNo(hp, "BETA-200").coverage.complete);

    // ---- P2: DB-level atomicity of the per-contract resolution ---------------------------
    const one = [...betaIds][0];
    const { error: rpcErr } = await fx.client.rpc("officer_resolve_observations", {
      p_organization_id: fx.orgId, p_ids: [one, crypto.randomUUID()], p_resolved_at: new Date().toISOString(),
    });
    const stillActive = (await activeFor(beta)).some((o) => o.id === one);
    // A missing function is NOT an atomicity proof.
    check("P2 resolving [valid, missing] in one call fails as a whole",
      !!rpcErr && !/Could not find the function/i.test(rpcErr.message), rpcErr?.message ?? "no error");
    check("P2 …and the valid observation is still active (rolled back)", stillActive);

    // ---- recovery ----------------------------------------------------------------------------
    const r = await runContractSweep({ ctx, trigger: "manual" });
    const all = await rows();
    const act = all.filter((x) => x.status === "active" || x.status === "acknowledged").map((x) => x.dedupe_key);
    check("recovery sweep completed, no duplicate active observations", r.status === "completed" && act.length === new Set(act).size, JSON.stringify(r.failures));
    check("recovery: BETA-200 findings active again (conditions still true)", (await activeFor(beta)).length === 2);
  } finally {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} org=${fx.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nSWEEP PUBLICATION: ${checks.length - failed.length}/${checks.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
