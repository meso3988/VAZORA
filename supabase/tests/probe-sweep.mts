/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local","utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2].replace(/^"|"$/g,"");
}
async function main() {
  const { seedBenchmarkOrganization, teardownBenchmarkOrganization } = await import("../benchmarks/contract-officer-benchmark-v2/fixture");
  const { buildOfficerContext, ensureOfficerProfile } = await import("../../src/lib/officer/context");
  const { runContractSweep } = await import("../../src/lib/officer/sweep");
  const { listObservations } = await import("../../src/lib/officer/observations");
  const fx = await seedBenchmarkOrganization({ label: "probe" });
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
  const ctx = await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" });
  if (!ctx) throw new Error("no ctx");
  await runContractSweep({ ctx, trigger: "manual" });
  const obs = await listObservations(ctx);
  const num = (id:string)=>Object.values(fx.contracts).find((c:any)=>c.contractId===id)?.number ?? id;
  for (const o of obs) console.log(num(o.contractId!), "|", o.kind, "|", o.severity, "|", o.timeBucket, "|", o.status);
  console.log("teardown:", JSON.stringify(await teardownBenchmarkOrganization(fx)));
}
main().catch((e)=>{console.error(e);process.exit(1)});
