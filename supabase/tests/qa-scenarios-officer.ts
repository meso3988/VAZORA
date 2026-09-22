/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A CP3 — persisted QA tenant for interactive browser testing of the
// Command Center and the grounded conversation. Reuses the CP2 fixture (which
// already contains an overdue obligation, a missing acknowledgement, a pending
// discrepancy, a human override and a contract with a financial condition),
// then runs one real sweep so observations exist to click on.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-scenarios-officer.ts

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOfficerFixture } from "./officer-fixture";

import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { listObservations } from "../../src/lib/officer/observations";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  const fx = await buildOfficerFixture({ label: "qa", timezone: "Asia/Riyadh" });
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });

  const ctx = await buildOfficerContext({
    supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en",
  });
  if (!ctx) throw new Error("context build failed");

  // An approval card must exist in the Command Center's first section.
  const proposal = await runOfficerTool(ctx, "requestHumanApproval", {
    actionType: "officer.request_evidence_internal",
    summary: "Request the missing client acknowledgement",
    reason: "Clause 14.2 requires a countersigned report; no verified acknowledgement is recorded.",
    contractId: fx.om.contractId,
    obligationId: fx.om.obligationId,
  });
  if (!proposal.ok) throw new Error(`proposal failed: ${proposal.error}`);

  const sweep = await runContractSweep({ ctx, trigger: "manual" });
  const observations = await listObservations(ctx);

  const fixture = {
    createdAt: new Date().toISOString(),
    login: { email: fx.email, password: fx.password },
    orgId: fx.orgId,
    timezone: fx.timezone,
    today: fx.today,
    contracts: {
      om: { id: fx.om.contractId, number: "OM-014", obligationId: fx.om.obligationId, clauseId: fx.om.clauseId },
      fm: { id: fx.fm.contractId, number: "FM-008" },
      ops: { id: fx.ops.contractId, number: "OPS-021" },
    },
    sweep: {
      status: sweep.status, created: sweep.created,
      resolved: sweep.resolved, contracts: sweep.contractsTotal,
    },
    observations: observations.map((o) => ({
      id: o.id, kind: o.kind, severity: o.severity, bucket: o.timeBucket,
      title: o.title, citations: o.citations.length,
      recommendedActionType: o.recommendedActionType,
    })),
  };

  const out = join(here, "qa-officer-scenarios.json");
  writeFileSync(out, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`seeded officer QA tenant → ${out}`);
  console.log(`  org ${fx.orgId} · tz ${fx.timezone} · today ${fx.today}`);
  console.log(`  sweep ${sweep.status}: ${sweep.created} observations across ${sweep.contractsTotal} contracts`);
  for (const o of fixture.observations) {
    console.log(`  · [${o.severity}/${o.bucket}] ${o.kind} — ${o.title}`);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
