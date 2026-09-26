/* eslint-disable @typescript-eslint/no-explicit-any */
// Live stale-proposal approval safety — exercises the PRODUCT path only
// (runOfficerTool to propose, approveOfficerAction to decide). No model calls,
// no new execution capability: state changes are ordinary authorized writes
// by the org owner against synthetic QA data.
//
// Proves:
//   • unchanged state → approval lands (APPROVAL_REQUIRED held at "approved",
//     SAFE_INTERNAL_WRITE executes to "completed")
//   • state moved underneath a proposal → approval REFUSED with
//     state_changed:* and the proposal stays open for fresh review:
//       - obligation kicked back to review (obligation.* action type)
//       - proposed assignee removed from the organization
//       - contract deleted
//   • authority is re-checked at approval time: a manager whose role was
//     downgraded to member between proposal and approval is refused
//   • a decided action cannot be decided twice (not_open / already_decided)
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-stale-approval.test.ts

import { readFileSync } from "node:fs";
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
import { runOfficerTool } from "../../src/lib/officer/tools";
import { approveOfficerAction } from "../../src/lib/officer/actions";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const fx = await seedBenchmarkOrganization({ label: "stale" });
  try {
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const ctxOf = (userId: string) =>
      buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId, locale: "en" });
    const owner = (await ctxOf(fx.userId))!;
    const second = fx.secondUserId as string;
    const statusOf = async (id: string) =>
      (await fx.client.from("officer_actions").select("status").eq("id", id).maybeSingle()).data?.status;

    // ---- 1. unchanged-state path -------------------------------------------
    const p1 = await runOfficerTool(owner, "proposeAssignment", {
      obligationId: fx.contracts.a.obligationId, assigneeUserId: second,
      reason: "Assign the quarterly statement to a real owner.",
    });
    check("proposal created (waiting_for_approval)",
      p1.ok && (p1.data as any).status === "waiting_for_approval", JSON.stringify(p1).slice(0, 140));
    const p1Id = p1.ok ? (p1.data as any).id : "";

    const a1 = await approveOfficerAction(owner, p1Id);
    check("unchanged state → approved, held (APPROVAL_REQUIRED never executes in 4A)",
      a1.ok && a1.data.status === "approved" && a1.data.executed === false, JSON.stringify(a1));

    const a1b = await approveOfficerAction(owner, p1Id);
    check("decided proposal cannot be approved twice", !a1b.ok && /^not_open/.test(a1b.error ?? ""), JSON.stringify(a1b));

    // SAFE_INTERNAL_WRITE executes for real on the unchanged path.
    const note = await runOfficerTool(owner, "createInternalAction", {
      actionType: "officer.internal_task", title: "Follow up on ALPHA-100 statement",
      reason: "Officer bookkeeping", contractId: fx.contracts.a.contractId,
    });
    const noteId = note.ok ? (note.data as any).id : "";
    const aNote = await approveOfficerAction(owner, noteId);
    check("unchanged state → internal bookkeeping executes to completed",
      aNote.ok && aNote.data.status === "completed" && aNote.data.executed === true, JSON.stringify(aNote));

    // ---- 2. stale obligation -----------------------------------------------
    const p2 = await runOfficerTool(owner, "proposeAssignment", {
      obligationId: fx.contracts.b.obligationId, assigneeUserId: second,
      reason: "Assign the overdue BETA-200 obligation.",
    });
    const p2Id = p2.ok ? (p2.data as any).id : "";
    // The world moves: obligation deactivated. (review_status='needs_review'
    // is refused by obligation_activation_gate while activation stays 'active',
    // so the authorized change here is deactivation.)
    const { error: obErr } = await fx.client.from("contract_obligations")
      .update({ activation_status: "inactive" }).eq("id", fx.contracts.b.obligationId);
    check("obligation deactivated (authorized QA change)", !obErr, obErr?.message ?? "");
    const a2 = await approveOfficerAction(owner, p2Id);
    check("stale obligation → approval refused (state_changed)",
      !a2.ok && a2.error === "state_changed: obligation_no_longer_operational", JSON.stringify(a2));
    check("stale obligation → proposal still open for fresh review",
      (await statusOf(p2Id)) === "waiting_for_approval", `status=${await statusOf(p2Id)}`);

    // ---- 3. stale assignee ---------------------------------------------------
    const p3 = await runOfficerTool(owner, "proposeAssignment", {
      obligationId: fx.contracts.c.obligationId, assigneeUserId: second,
      reason: "Assign the GAMMA-300 obligation.",
    });
    const p3Id = p3.ok ? (p3.data as any).id : "";
    await fx.client.from("organization_members")
      .delete().eq("organization_id", fx.orgId).eq("user_id", second);
    const a3 = await approveOfficerAction(owner, p3Id);
    check("assignee left the org → approval refused (state_changed)",
      !a3.ok && a3.error === "state_changed: assignee_no_longer_a_member", JSON.stringify(a3));
    check("assignee left → proposal still open",
      (await statusOf(p3Id)) === "waiting_for_approval", `status=${await statusOf(p3Id)}`);

    // ---- 4. authority re-checked at approval time ---------------------------
    // An admin CAN approve. Downgrade admin→member between proposal and
    // approval; the same user must then be refused on their CURRENT role.
    // (member_role enum is owner/admin/member — the officer's planned roles
    // such as 'manager' are code-level only.)
    // signUp on a SEPARATE client — using fx.client would swap its session
    // to the new user and silently strip the owner's role for later calls.
    const third = `${crypto.randomUUID()}@vazora.test`;
    const thirdClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: thirdAuth } = await thirdClient.auth.signUp({ email: third, password: `Qa!${crypto.randomUUID()}` });
    const managerId = thirdAuth?.user?.id as string | undefined;
    check("third user provisioned", !!managerId, managerId ?? "none");
    if (managerId) {
      const { error: memErr } = await fx.client.from("organization_members")
        .insert({ organization_id: fx.orgId, user_id: managerId, role: "admin" });
      check("admin member added (authorized QA change)", !memErr, memErr?.message ?? "");
      const mgr = await ctxOf(managerId);
      check("admin context builds", !!mgr);
      const p4 = await runOfficerTool(owner, "requestHumanApproval", {
        actionType: "officer.escalate", summary: "Escalate DELTA-400 discrepancy",
        reason: "Pending verification disagreement needs a human decision.",
        contractId: fx.contracts.d.contractId,
      });
      const p4Id = p4.ok ? (p4.data as any).id : "";
      const a4ok = mgr ? await approveOfficerAction(mgr, p4Id) : { ok: false, error: "no ctx" } as any;
      check("admin role approves (unchanged path, cross-user)", a4ok.ok && a4ok.data.status === "approved", JSON.stringify(a4ok));

      const p5 = await runOfficerTool(owner, "requestHumanApproval", {
        actionType: "officer.escalate", summary: "Escalate ZETA-600 financial condition",
        reason: "Penalty exposure needs human sign-off.",
        contractId: fx.contracts.f.contractId,
      });
      const p5Id = p5.ok ? (p5.data as any).id : "";
      const { error: roleErr } = await fx.client.from("organization_members")
        .update({ role: "member" }).eq("organization_id", fx.orgId).eq("user_id", managerId);
      check("role downgrade applied (owner manages members)", !roleErr, roleErr?.message ?? "");
      const mgrAfter = await ctxOf(managerId);
      const a5 = mgrAfter ? await approveOfficerAction(mgrAfter, p5Id) : { ok: false, error: "no ctx" } as any;
      check("role removed after proposal → approval refused (unauthorized)",
        !a5.ok && /^unauthorized/.test(a5.error ?? ""), JSON.stringify(a5));
      check("unauthorized → proposal still open",
        (await statusOf(p5Id)) === "waiting_for_approval", `status=${await statusOf(p5Id)}`);
      // restore for any later checks
      await fx.client.from("organization_members")
        .update({ role: "admin" }).eq("organization_id", fx.orgId).eq("user_id", managerId);
    }

    // ---- 5. stale contract (most destructive — last) --------------------------
    const p6 = await runOfficerTool(owner, "requestHumanApproval", {
      actionType: "officer.request_evidence_internal",
      summary: "Request EPSILON-500 compliance statement",
      reason: "Quarterly statement required; none verified.",
      contractId: fx.contracts.e.contractId,
    });
    const p6Id = p6.ok ? (p6.data as any).id : "";
    const { error: delErr } = await fx.client.from("contracts")
      .delete().eq("organization_id", fx.orgId).eq("id", fx.contracts.e.contractId);
    check("contract deleted (authorized QA change)", !delErr, delErr?.message ?? "");
    const a6 = await approveOfficerAction(owner, p6Id);
    // officer_actions.contract_id is ON DELETE CASCADE: deleting the contract
    // deletes the pending proposal itself, so loadAction → not_found. That is
    // a STRONGER prevention than revalidation — a cascaded proposal can never
    // be approved. The revalidation branch remains defense-in-depth.
    const p6Status = await statusOf(p6Id);
    check("contract gone → approval refused, no stale execution",
      !a6.ok && /^(not_found|state_changed:)/.test(a6.error ?? ""), JSON.stringify(a6));
    check("contract gone → proposal cascaded away or still open, never decided",
      p6Status === undefined || p6Status === "waiting_for_approval", `status=${p6Status ?? "row deleted (FK cascade)"}`);

    // ---- 6. concurrent double-decide ----------------------------------------
    const p7 = await runOfficerTool(owner, "createInternalAction", {
      actionType: "officer.internal_task", title: "Race check task",
      reason: "Concurrent approval must decide exactly once", contractId: fx.contracts.c.contractId,
    });
    const p7Id = p7.ok ? (p7.data as any).id : "";
    const [r1, r2] = await Promise.all([
      approveOfficerAction(owner, p7Id), approveOfficerAction(owner, p7Id),
    ]);
    const okCount = [r1, r2].filter((r) => r.ok).length;
    const loser = [r1, r2].find((r) => !r.ok);
    check("concurrent approvals → exactly one succeeds, loser refused",
      okCount === 1 && !!loser && /already_decided|not_open/.test(loser.error ?? ""),
      `ok=${okCount} loser=${JSON.stringify(loser).slice(0, 120)}`);
  } finally {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} org=${fx.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\nSTALE-APPROVAL SAFETY: ${checks.length - failed.length}/${checks.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
