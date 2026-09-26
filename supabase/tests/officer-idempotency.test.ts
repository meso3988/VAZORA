/* eslint-disable @typescript-eslint/no-explicit-any */
// Proposal idempotency at the data boundary (migration 0013) — real DB,
// normal authenticated users, no service role, NO model calls.
//
// Reproduces the Phase 4A gate A05 run-3 failure (same follow-up, title
// paraphrased "… — BETA-200" → a second open proposal) and proves:
//   • same target, different wording → the existing proposal (reused=true)
//   • reordered JSON properties → same identity
//   • concurrent duplicates → exactly one row
//   • different gaps in the same contract → distinct proposals
//   • parent id omitted vs supplied → one identity; contradictory parent → refused
//   • different assignee → distinct proposals (explicit policy); same → reused
//   • different tenants → never merged or cross-reused
//   • completed / rejected earlier proposal → a legitimate new one
//   • historical (pre-0013, key NULL) open proposal → reused, not duplicated,
//     and left unmodified
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-idempotency.test.ts

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
import { actionIdentityKey } from "../../src/lib/officer/action-identity";
import { approveOfficerAction, rejectOfficerAction } from "../../src/lib/officer/actions";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runOfficerTool as rawRun } from "../../src/lib/officer/tools";

const runOfficerTool = (...a: Parameters<typeof rawRun>): Promise<any> => rawRun(...a);

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---- pure identity (no DB) ------------------------------------------------------
{
  const t = { contractId: "C", obligationId: "O", gapId: null };
  check("key ignores free text (title/summary/reason)",
    actionIdentityKey("officer.internal_task", t, { title: "Follow up" }) === actionIdentityKey("officer.internal_task", t, { title: "Chase — BETA-200" }));
  check("key: assignee is operational", actionIdentityKey("obligation.assign_owner", t, { assigneeUserId: "u1" }) !== actionIdentityKey("obligation.assign_owner", t, { assigneeUserId: "u2" }));
  check("key: argument order irrelevant",
    actionIdentityKey("obligation.assign_owner", t, { obligationId: "O", assigneeUserId: "u1" }) === actionIdentityKey("obligation.assign_owner", t, { assigneeUserId: "u1", obligationId: "O" }));
  check("key: action type distinguishes", actionIdentityKey("officer.escalate", t) !== actionIdentityKey("officer.request_evidence_internal", t));
  check("key: gap target distinguishes", actionIdentityKey("officer.internal_task", { ...t, gapId: "g1" }) !== actionIdentityKey("officer.internal_task", { ...t, gapId: "g2" }));
}

async function main() {
  const fx = await seedBenchmarkOrganization({ label: "idem" });
  const fy = await seedBenchmarkOrganization({ label: "idemB" });
  try {
    for (const f of [fx, fy]) await ensureOfficerProfile({ supabase: f.client, organizationId: f.orgId });
    const ctxOf = async (f: any) => (await buildOfficerContext({ supabase: f.client, organizationId: f.orgId, userId: f.userId, locale: "en" }))!;
    const X = await ctxOf(fx);
    const Y = await ctxOf(fy);
    const b = fx.contracts.b;
    const openRows = async (f: any, type: string, filter: Record<string, string> = {}) => {
      let q = f.client.from("officer_actions").select("id, status, idempotency_key, arguments")
        .eq("organization_id", f.orgId).eq("action_type", type).in("status", ["suggested", "waiting_for_approval"]);
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      return (await q).data ?? [];
    };
    const task = (ctx: any, title: string, extra: Record<string, unknown> = {}) => runOfficerTool(ctx, "createInternalAction", {
      actionType: "officer.internal_task", title, reason: `reason ${Math.random()}`, ...extra,
    });

    // ---- 1. [GATE A05 r3] same follow-up, paraphrased title -----------------------
    const t1 = await task(X, "Follow up on missing signed service-level report", { contractId: b.contractId, obligationId: b.obligationId });
    const t2 = await task(X, "Follow up on missing signed service-level report — BETA-200", { contractId: b.contractId, obligationId: b.obligationId });
    const id1 = t1.ok ? (t1.data as any).id : "x";
    check("A05 reproduction: first request creates a proposal (reused=false)", t1.ok && (t1.data as any).reused === false, JSON.stringify(t1).slice(0, 160));
    check("A05 reproduction: paraphrased repeat returns the SAME proposal (reused=true)",
      t2.ok && (t2.data as any).id === id1 && (t2.data as any).reused === true, JSON.stringify(t2).slice(0, 160));
    check("A05 reproduction: exactly one open row for the target", (await openRows(fx, "officer.internal_task", { obligation_id: b.obligationId })).length === 1);
    check("stored key is server-derived and contains no free text",
      !(await openRows(fx, "officer.internal_task"))[0]?.idempotency_key?.includes("follow"));

    // ---- 2. parent omitted / supplied / contradictory ------------------------------
    const t3 = await task(X, "Chase the report", { obligationId: b.obligationId });
    check("contract id omitted → derived from obligation → same proposal", t3.ok && (t3.data as any).id === id1);
    const bad = await task(X, "Chase", { contractId: fx.contracts.c.contractId, obligationId: b.obligationId });
    check("contradictory contract/obligation → refused (target_mismatch), nothing created",
      !bad.ok && /^target_mismatch/.test(bad.error), JSON.stringify(bad));

    // ---- 3. reordered JSON properties (assignment) ------------------------------------
    const second = fx.secondUserId as string;
    const pA = await runOfficerTool(X, "proposeAssignment", { obligationId: fx.contracts.e.obligationId, assigneeUserId: second, reason: "one" });
    const pB = await runOfficerTool(X, "proposeAssignment", { reason: "two — reworded", assigneeUserId: second, obligationId: fx.contracts.e.obligationId });
    check("reordered JSON + reworded reason → same assignment proposal",
      pA.ok && pB.ok && (pA.data as any).id === (pB.data as any).id && (pB.data as any).reused === true);
    const pC = await runOfficerTool(X, "proposeAssignment", { obligationId: fx.contracts.e.obligationId, assigneeUserId: fx.userId, reason: "different person" });
    check("different assignee → a DISTINCT proposal (explicit policy: a human chooses)",
      pC.ok && (pC.data as any).id !== (pA.data as any).id && (pC.data as any).reused === false);
    check("…both competing proposals remain open, neither rewritten",
      (await openRows(fx, "obligation.assign_owner", { obligation_id: fx.contracts.e.obligationId })).length === 2);

    // ---- 4. concurrent duplicates -------------------------------------------------------
    const cc = fx.contracts.c;
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      runOfficerTool(X, "requestHumanApproval", {
        actionType: "officer.escalate", summary: `Escalate GAMMA-300 ack gap (wording ${i})`, reason: `reason variant ${i}`,
        contractId: cc.contractId, obligationId: cc.obligationId,
      })));
    const ids = new Set(burst.filter((r) => r.ok).map((r) => (r.data as any).id));
    check("6 concurrent paraphrased escalations → all succeed", burst.every((r) => r.ok), JSON.stringify(burst.filter((r) => !r.ok)).slice(0, 200));
    check("…resolving to ONE proposal id", ids.size === 1, `${ids.size} ids`);
    check("…exactly one row in the database", (await openRows(fx, "officer.escalate", { obligation_id: cc.obligationId })).length === 1);
    check("…exactly one reported reused=false (the winner)", burst.filter((r) => r.ok && (r.data as any).reused === false).length === 1);

    // ---- 5. different gaps in the same contract ----------------------------------------
    const { data: gapRow } = await fx.client.from("evidence_gaps").select("id")
      .eq("organization_id", fx.orgId).eq("contract_id", b.contractId).eq("status", "open").limit(1).maybeSingle();
    const reqId = crypto.randomUUID();
    const { error: reqErr } = await fx.client.from("obligation_evidence_requirements").insert({
      id: reqId, organization_id: fx.orgId, obligation_id: b.obligationId, name: "Client countersignature", evidence_type: "acknowledgement", required: true,
    });
    const gap2 = crypto.randomUUID();
    const { error: gapErr } = await fx.client.from("evidence_gaps").insert({
      id: gap2, organization_id: fx.orgId, contract_id: b.contractId, obligation_id: b.obligationId,
      evidence_requirement_id: reqId, gap_type: "missing_evidence", status: "open", description: "No verified Client countersignature is recorded.",
    });
    check("second gap on the same contract seeded", !!gapRow && !reqErr && !gapErr, `${reqErr?.message ?? ""} ${gapErr?.message ?? ""}`);
    const g1 = await task(X, "Chase gap one", { gapId: gapRow?.id });
    const g1b = await task(X, "Chase gap one, reworded", { gapId: gapRow?.id, contractId: b.contractId });
    const g2 = await task(X, "Chase gap two", { gapId: gap2 });
    check("gap 1 proposal created", g1.ok && (g1.data as any).reused === false, JSON.stringify(g1).slice(0, 140));
    check("gap 1 reworded (+contract supplied) → same proposal", g1b.ok && (g1b.data as any).id === (g1.data as any).id);
    check("gap 2 on the same contract → a DISTINCT proposal", g2.ok && (g2.data as any).id !== (g1.data as any).id && (g2.data as any).reused === false);
    check("gap-level and obligation-level follow-ups are distinct identities",
      g1.ok && (g1.data as any).id !== id1);
    const gapWrong = await task(X, "Chase", { gapId: gap2, contractId: fx.contracts.c.contractId });
    check("gap with a contradictory contract → refused", !gapWrong.ok && /^target_mismatch/.test(gapWrong.error));

    // ---- 6. different tenants --------------------------------------------------------------
    const y1 = await task(Y, "Follow up on missing signed service-level report", { contractId: fy.contracts.b.contractId, obligationId: fy.contracts.b.obligationId });
    check("tenant B, same wording → its OWN proposal (never tenant A's)", y1.ok && (y1.data as any).id !== id1 && (y1.data as any).reused === false);
    const yCross = await task(Y, "Chase", { obligationId: b.obligationId });
    check("tenant B naming tenant A's obligation → refused, nothing reused",
      !yCross.ok && yCross.error === "obligation_not_found_in_organization", JSON.stringify(yCross));
    const yGap = await task(Y, "Chase", { gapId: gap2 });
    check("tenant B naming tenant A's gap → refused", !yGap.ok && yGap.error === "gap_not_found_in_organization");

    // ---- 7. legitimate later follow-up after completion / rejection -------------------------
    const done = await approveOfficerAction(X, id1);
    check("earlier internal follow-up approved → completed", done.ok && done.data.status === "completed", JSON.stringify(done));
    const later = await task(X, "Second round: follow up on the signed report", { contractId: b.contractId, obligationId: b.obligationId });
    check("after completion, a new follow-up on the same target is CREATED",
      later.ok && (later.data as any).id !== id1 && (later.data as any).reused === false);
    const escId = [...ids][0];
    const rej = await rejectOfficerAction(X, escId, "not needed yet");
    check("escalation rejected", rej.ok);
    const esc2 = await runOfficerTool(X, "requestHumanApproval", {
      actionType: "officer.escalate", summary: "Escalate again", reason: "new facts", contractId: cc.contractId, obligationId: cc.obligationId,
    });
    check("after rejection, a new escalation on the same target is CREATED", esc2.ok && (esc2.data as any).id !== escId && (esc2.data as any).reused === false);

    // ---- 8. historical (pre-0013) open proposal with NULL key ---------------------------------
    const legacyId = crypto.randomUUID();
    const { error: legErr } = await fx.client.from("officer_actions").insert({
      id: legacyId, organization_id: fx.orgId, contract_id: fx.contracts.f.contractId, obligation_id: fx.contracts.f.obligationId,
      action_type: "officer.request_evidence_internal", arguments: { summary: "Legacy wording" },
      reason: "recorded before 0013", requires_approval: true, status: "waiting_for_approval",
    });
    check("legacy NULL-key open proposal inserted (simulated history)", !legErr, legErr?.message ?? "");
    const leg = await runOfficerTool(X, "requestHumanApproval", {
      actionType: "officer.request_evidence_internal", summary: "Totally different wording", reason: "a new reason",
      contractId: fx.contracts.f.contractId, obligationId: fx.contracts.f.obligationId,
    });
    check("legacy open proposal is REUSED, no duplicate created", leg.ok && (leg.data as any).id === legacyId && (leg.data as any).reused === true, JSON.stringify(leg).slice(0, 160));
    const { data: legRow } = await fx.client.from("officer_actions").select("idempotency_key, arguments, status").eq("id", legacyId).maybeSingle();
    check("legacy row left unmodified (key still NULL, arguments intact)",
      legRow?.idempotency_key === null && legRow?.arguments?.summary === "Legacy wording" && legRow?.status === "waiting_for_approval");

    // ---- 9. the database itself refuses a second open row for one identity --------------------
    const key = (await openRows(fx, "officer.internal_task", { obligation_id: b.obligationId }))[0]?.idempotency_key;
    const { error: dupErr } = await fx.client.from("officer_actions").insert({
      organization_id: fx.orgId, contract_id: b.contractId, obligation_id: b.obligationId, action_type: "officer.internal_task",
      arguments: { title: "direct insert bypassing the app" }, reason: "bypass", requires_approval: false, status: "suggested", idempotency_key: key,
    });
    check("direct duplicate insert with the same key → unique violation (23505)", dupErr?.code === "23505", dupErr?.message ?? "no error");
  } finally {
    for (const f of [fx, fy]) {
      const td = await teardownBenchmarkOrganization(f);
      const vf = await verifyBenchmarkCleanup(f);
      console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} org=${f.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
    }
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nIDEMPOTENCY: ${checks.length - failed.length}/${checks.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
