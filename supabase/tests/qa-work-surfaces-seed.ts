/* eslint-disable @typescript-eslint/no-explicit-any */
// QA seed for the real-work-surfaces delivery. Adds to the dashboard-QA
// tenants (qa-dashboard-tenants.ts setup):
//   - an executable internal action (officer.internal_task) on a SECOND alpha
//     contract — exercises supported-type completion + two-contract scoping
//   - a beta action on OM-014 already exists from the base seed
// Creates records ONLY through the real tool path (runOfficerTool) — the same
// rows a conversation proposal would write. No model calls.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-work-surfaces-seed.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { createClient } from "@supabase/supabase-js";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runOfficerTool } from "../../src/lib/officer/tools";

const STATE = "/tmp/qa-dashboard-tenants.json";
const st = JSON.parse(readFileSync(STATE, "utf8"));

async function signIn(who: { email: string; password: string }) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const { error } = await c.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`signIn: ${error.message}`);
  return c;
}

async function contractId(client: any, orgId: string, number: string): Promise<string> {
  const { data, error } = await client.from("contracts").select("id")
    .eq("organization_id", orgId).eq("contract_number", number).maybeSingle();
  if (error || !data) throw new Error(`contract ${number}: ${error?.message ?? "not found"}`);
  return data.id as string;
}

async function resetActions(client: any, orgId: string, ids: string[]) {
  // Re-runnable QA: return seeded actions to their pre-decision state so the
  // browser journey can run again. Status-conditional updates mirror the app.
  const { error } = await client.from("officer_actions")
    .update({
      status: "waiting_for_approval",
      approved_by: null, approved_at: null, rejected_by: null,
      rejected_at: null, rejection_reason: null,
      executed_at: null, execution_result: null, error_message: null,
    })
    .eq("organization_id", orgId).in("id", ids);
  if (error) throw new Error(`reset: ${error.message}`);
}

async function main() {
  const alpha = st.alpha;
  const a = await signIn(alpha);
  await ensureOfficerProfile({ supabase: a, organizationId: alpha.orgId });
  const { data: me } = await a.auth.getUser();
  const ctx = (await buildOfficerContext({ supabase: a, organizationId: alpha.orgId, userId: me.user!.id, locale: "en" }))!;

  const gamma = await contractId(a, alpha.orgId, "GAMMA-300");
  const delta = await contractId(a, alpha.orgId, "DELTA-400");

  // Executable internal action on a second contract (suggested → completed).
  const t1 = await runOfficerTool(ctx, "createInternalAction", {
    actionType: "officer.internal_task",
    title: "QA: log follow-up on DELTA-400 evidence pack",
    reason: "QA acceptance — executable internal action",
    contractId: delta,
  });
  if (!t1.ok) throw new Error(`internal task failed: ${t1.error}`);

  // A second waiting-for-approval action on the same contract as the base
  // seed's escalation — two proposals, two contracts inside one tenant.
  const t2 = await runOfficerTool(ctx, "requestHumanApproval", {
    actionType: "officer.request_evidence_internal",
    summary: "QA: request updated insurance certificate",
    reason: "QA acceptance — approval-required action that stays held",
    contractId: gamma,
  });
  if (!t2.ok) throw new Error(`evidence request failed: ${t2.error}`);

  st.alpha.extraActions = [(t1.data as any).id, (t2.data as any).id];
  st.alpha.contractIds = { gamma, delta };

  // Reset any already-decided QA actions so a re-run starts clean:
  // escalations/requests → waiting_for_approval, internal task → suggested.
  await resetActions(a, alpha.orgId, [alpha.proposals[0], (t1.data as any).id, (t2.data as any).id]);
  await a.from("officer_actions").update({ status: "suggested" })
    .eq("organization_id", alpha.orgId).eq("id", (t1.data as any).id);

  const b = await signIn(st.beta);
  await resetActions(b, st.beta.orgId, st.beta.proposals);

  writeFileSync(STATE, JSON.stringify(st, null, 2));
  console.log(`seeded: internal_task ${(t1.data as any).id} on DELTA-400 · evidence_request ${(t2.data as any).id} on GAMMA-300`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
