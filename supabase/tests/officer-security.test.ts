/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A CP4 — Officer safety gate: tool-argument attacks, action
// authorization, stale-proposal safety, idempotency, memory truth hierarchy,
// sweep-endpoint security, manual-sweep authorization, review watermark.
// Deterministic: a scripted provider stands in for the model.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-security.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { seedBenchmarkOrganization, teardownBenchmarkOrganization } from "../benchmarks/contract-officer-benchmark-v2/fixture";

import { approveOfficerAction, rejectOfficerAction } from "../../src/lib/officer/actions";
import { authorizeAction, roleHasCapability } from "../../src/lib/officer/authority";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { confirmMemory, invalidateMemory, loadUsableMemory, recordMemory } from "../../src/lib/officer/memory";
import { acknowledgeObservation, getObservation, getUserState, listObservations, markReviewed } from "../../src/lib/officer/observations";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { runOfficerTool } from "../../src/lib/officer/tools";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function main() {
  const alpha = await seedBenchmarkOrganization({ label: "secA" });
  const beta = await seedBenchmarkOrganization({ label: "secB", timezone: "Europe/London" });
  await ensureOfficerProfile({ supabase: alpha.client, organizationId: alpha.orgId });

  const ctx = await buildOfficerContext({
    supabase: alpha.client, organizationId: alpha.orgId, userId: alpha.userId, locale: "en",
  });
  const betaCtx = await buildOfficerContext({
    supabase: beta.client, organizationId: beta.orgId, userId: beta.userId, locale: "en",
  });
  if (!ctx || !betaCtx) throw new Error("context build failed");

  // =========================================================================
  // 8 — TOOL ARGUMENT SAFETY
  // =========================================================================
  const attacks: [string, string, unknown][] = [
    ["foreign-contract", "getContract", { contractId: beta.contracts.b.contractId }],
    ["foreign-obligation", "getObligation", { obligationId: beta.contracts.b.obligationId }],
    ["foreign-clause", "getContractClause", { clauseId: beta.contracts.b.clauseId }],
    ["foreign-gaps", "getEvidenceGaps", { contractId: beta.contracts.c.contractId }],
    ["foreign-discrepancies", "getVerificationDiscrepancies", { contractId: beta.contracts.d.contractId }],
    ["model-supplied-org", "listContracts", { organizationId: beta.orgId }],
    ["extra-unexpected-field", "getEvidenceGaps", { contractId: alpha.contracts.a.contractId, bypassRls: true }],
    ["malformed-uuid", "getContract", { contractId: "'; drop table contracts; --" }],
    ["numeric-uuid", "getObligation", { obligationId: 12345 }],
    ["null-arg", "getContract", { contractId: null }],
    ["oversized-string", "requestHumanApproval", {
      actionType: "officer.escalate", summary: "x".repeat(5000), reason: "y".repeat(5000),
    }],
    ["unknown-tool", "exfiltrateEverything", {}],
    ["tenant-switch-attempt", "getOrganizationSummary", { organizationId: beta.orgId }],
  ];
  for (const [name, tool, args] of attacks) {
    const r = await runOfficerTool(ctx, tool, args);
    check(`args-${name}`, !r.ok, r.ok ? "ALLOWED" : (r as any).error.slice(0, 70));
  }
  // Legitimate use still works — isolation must not break the product.
  const own = await runOfficerTool(ctx, "getContract", { contractId: alpha.contracts.a.contractId });
  check("args-own-contract-works", own.ok, own.ok ? own.summary : JSON.stringify(own));

  // An assignee from another organization must be refused.
  const crossAssign = await runOfficerTool(ctx, "proposeAssignment", {
    obligationId: alpha.contracts.e.obligationId,
    assigneeUserId: beta.userId,
    reason: "assign another company's employee",
  });
  check("args-foreign-assignee",
    !crossAssign.ok && (crossAssign as any).error === "assignee_not_a_member_of_this_organization",
    JSON.stringify(crossAssign).slice(0, 80));

  // =========================================================================
  // 9 — ACTION AUTHORIZATION MATRIX
  // =========================================================================
  check("auth-owner-may-assign", authorizeAction("owner", "obligation.assign_owner").allowed);
  check("auth-member-may-not-assign", !authorizeAction("member", "obligation.assign_owner").allowed);
  check("auth-member-may-not-override", !authorizeAction("member", "evidence.human_override").allowed);
  check("auth-member-may-not-dismiss-gap", !authorizeAction("member", "evidence.dismiss_gap").allowed);
  check("auth-external-comms-denied-to-owner",
    !authorizeAction("owner", "external.send_message").allowed &&
    authorizeAction("owner", "external.send_message").allowed === false);
  check("auth-unknown-action-denied", !authorizeAction("owner", "delete.everything").allowed);
  // Manual sweep: every member may refresh monitoring; it mutates nothing.
  check("auth-sweep-member-allowed", roleHasCapability("member", "officer.sweep.run"));
  check("auth-sweep-norole-denied", !roleHasCapability(null, "officer.sweep.run"));

  // =========================================================================
  // 10 — STATE-CHANGED PROPOSAL SAFETY
  // =========================================================================
  const assignProposal = await runOfficerTool(ctx, "proposeAssignment", {
    obligationId: alpha.contracts.e.obligationId,
    assigneeUserId: alpha.secondUserId ?? alpha.userId,
    reason: "EPSILON-500 has no owner",
  });
  check("state-proposal-created", assignProposal.ok, JSON.stringify(assignProposal).slice(0, 90));
  const assignActionId = assignProposal.ok ? (assignProposal.data as any).id : "";

  // Change the world underneath the proposal: deactivate the obligation.
  await alpha.client.from("contract_obligations")
    .update({ activation_status: "inactive" })
    .eq("id", alpha.contracts.e.obligationId);
  const staleApprove = await approveOfficerAction(ctx, assignActionId);
  check("state-changed-refused",
    !staleApprove.ok && staleApprove.error.startsWith("state_changed"),
    JSON.stringify(staleApprove));
  const { data: stillOpen } = await alpha.client.from("officer_actions")
    .select("status, approved_by").eq("id", assignActionId).maybeSingle();
  check("state-changed-not-executed",
    stillOpen?.status === "waiting_for_approval" && stillOpen?.approved_by === null,
    `status=${stillOpen?.status}`);
  // Restore so later checks work on a sane world.
  await alpha.client.from("contract_obligations")
    .update({ activation_status: "active" })
    .eq("id", alpha.contracts.e.obligationId);

  // A member removed from the organization cannot have their proposal applied
  // by role — authorization is re-derived, never inherited from the proposal.
  const memberCtx = alpha.secondUserId
    ? await buildOfficerContext({
        supabase: alpha.client, organizationId: alpha.orgId, userId: alpha.secondUserId, locale: "en",
      })
    : null;
  if (memberCtx) {
    const memberApprove = await approveOfficerAction(memberCtx, assignActionId);
    check("auth-member-cannot-approve-assignment",
      !memberApprove.ok && memberApprove.error.includes("unauthorized"),
      JSON.stringify(memberApprove));
  }

  // =========================================================================
  // 11 — IDEMPOTENCY
  // =========================================================================
  // Re-proposing the identical action reuses the open proposal.
  const dupe = await runOfficerTool(ctx, "proposeAssignment", {
    obligationId: alpha.contracts.e.obligationId,
    assigneeUserId: alpha.secondUserId ?? alpha.userId,
    reason: "EPSILON-500 has no owner",
  });
  check("idem-proposal-reused",
    dupe.ok && (dupe.data as any).id === assignActionId,
    dupe.ok ? `${(dupe.data as any).id === assignActionId}` : JSON.stringify(dupe));

  const internal = await runOfficerTool(ctx, "createInternalAction", {
    actionType: "officer.internal_task", title: "Chase BETA-200 SLA report",
    reason: "Overdue with missing evidence", contractId: alpha.contracts.b.contractId,
  });
  const internalId = internal.ok ? (internal.data as any).id : "";
  // Double-click: two approvals in flight, exactly one may execute.
  const [first, second] = await Promise.all([
    approveOfficerAction(ctx, internalId),
    approveOfficerAction(ctx, internalId),
  ]);
  const succeeded = [first, second].filter((r) => r.ok).length;
  check("idem-double-click-single-execution", succeeded === 1,
    `ok=${succeeded} → ${JSON.stringify([first, second]).slice(0, 140)}`);
  const { data: executed } = await alpha.client.from("officer_actions")
    .select("status, executed_at, execution_result").eq("id", internalId).maybeSingle();
  check("idem-executed-once",
    executed?.status === "completed" && !!executed?.executed_at,
    `status=${executed?.status}`);
  const retryAfter = await approveOfficerAction(ctx, internalId);
  check("idem-retry-after-completion-refused", !retryAfter.ok, JSON.stringify(retryAfter));

  // Approval-required actions stop at "approved": no silent business mutation.
  const escalate = await runOfficerTool(ctx, "requestHumanApproval", {
    actionType: "officer.escalate", summary: "Escalate BETA-200",
    reason: "Overdue and unproven", contractId: alpha.contracts.b.contractId,
  });
  const escalateId = escalate.ok ? (escalate.data as any).id : "";
  const escalateApprove = await approveOfficerAction(ctx, escalateId);
  check("action-approved-not-executed",
    escalateApprove.ok && escalateApprove.data.executed === false,
    JSON.stringify(escalateApprove));

  const rejectTarget = await runOfficerTool(ctx, "requestHumanApproval", {
    actionType: "officer.escalate", summary: "To reject", reason: "test",
  });
  const rejectId = rejectTarget.ok ? (rejectTarget.data as any).id : "";
  check("action-reject-works", (await rejectOfficerAction(ctx, rejectId, "not needed")).ok);
  check("action-no-approve-after-reject", !(await approveOfficerAction(ctx, rejectId)).ok);

  // Cross-tenant approval is impossible.
  check("action-cross-tenant-approve",
    !(await approveOfficerAction(betaCtx, escalateId)).ok,
    "beta cannot approve alpha's action");

  // =========================================================================
  // 20 — MEMORY TRUTH HIERARCHY
  // =========================================================================
  const usable = await loadUsableMemory(ctx, { contractId: alpha.contracts.d.contractId });
  check("memory-confirmed-available",
    usable.some((m) => m.content.includes("weekly contract summary")),
    `usable=${usable.length}`);
  check("memory-inference-excluded",
    !usable.some((m) => m.origin === "model_inference"),
    usable.map((m) => m.origin).join(","));
  check("memory-invalidated-excluded",
    !usable.some((m) => m.content.includes("no outstanding obligations")));
  check("memory-scope-respected",
    usable.every((m) => m.scope !== "contract" || m.contractId === alpha.contracts.d.contractId));

  const speculation = await recordMemory(ctx, {
    content: "The client is probably happy with the report.", origin: "model_inference",
  });
  check("memory-inference-stays-unconfirmed", speculation.ok && speculation.data.state === "unconfirmed");
  const promoted = speculation.ok ? await confirmMemory(ctx, speculation.data.id) : { ok: false } as any;
  check("memory-human-can-confirm", promoted.ok, "explicit human promotion only");
  const crossMem = await recordMemory(ctx, {
    content: "cross-tenant note", origin: "user_confirmed", contractId: beta.contracts.a.contractId,
  });
  check("memory-cross-tenant-refused", !crossMem.ok, JSON.stringify(crossMem).slice(0, 70));
  // Both tenants are seeded from the same fixture, so identical CONTENT is
  // expected. Isolation means no shared ROWS.
  const betaUsable = await loadUsableMemory(betaCtx, {});
  const alphaIds = new Set(usable.map((m) => m.id));
  check("memory-tenant-isolated",
    betaUsable.length > 0 && !betaUsable.some((m) => alphaIds.has(m.id)),
    `alpha=${usable.length} beta=${betaUsable.length} shared=0`);
  if (speculation.ok) {
    await invalidateMemory(ctx, speculation.data.id);
    const after = await loadUsableMemory(ctx, {});
    check("memory-invalidation-effective",
      !after.some((m) => m.id === speculation.data.id));
  }

  // =========================================================================
  // 16 — REVIEW WATERMARK SEMANTICS
  // =========================================================================
  await runContractSweep({ ctx, trigger: "manual" });
  const before = await getUserState(ctx);
  await markReviewed(ctx);
  const after = await getUserState(ctx);
  check("review-watermark-advances", !!after.lastReviewedAt && after.lastReviewedAt !== before.lastReviewedAt);
  // Per-user: one member's review must not consume another's changes.
  if (memberCtx) {
    const memberState = await getUserState(memberCtx);
    check("review-watermark-per-user", memberState.lastReviewedAt === null,
      `member watermark=${memberState.lastReviewedAt}`);
  }
  // Cross-tenant write of someone else's watermark must fail.
  const { error: wmErr } = await beta.client.from("officer_user_state")
    .insert({ organization_id: alpha.orgId, user_id: alpha.userId, last_reviewed_at: new Date().toISOString() });
  check("review-watermark-cross-tenant-blocked", !!wmErr, wmErr?.message.slice(0, 60) ?? "inserted!");

  // =========================================================================
  // 17/18 — SWEEP AUTHORIZATION AND ISOLATION
  // =========================================================================
  const betaSweep = await runContractSweep({ ctx: betaCtx, trigger: "manual" });
  const alphaObs = await listObservations(ctx);
  const betaObs = await listObservations(betaCtx);
  check("sweep-tenant-scoped",
    betaSweep.contractsTotal === 6 &&
    !betaObs.some((o) => alphaObs.some((a) => a.id === o.id)),
    `beta contracts=${betaSweep.contractsTotal}`);
  const alphaTarget = alphaObs.find((o) => o.status === "active");
  check("observation-target-exists", !!alphaTarget,
    `alphaObs=${alphaObs.length} statuses=${[...new Set(alphaObs.map((o) => o.status))].join(",")}`);
  if (alphaTarget) {
    check("observation-owner-can-read", (await getObservation(ctx, alphaTarget.id))?.status === "active");
    check("observation-cross-tenant-read", (await getObservation(betaCtx, alphaTarget.id)) === null);
    check("observation-cross-tenant-ack", !(await acknowledgeObservation(betaCtx, alphaTarget.id)).ok);
    await beta.client.from("officer_observations")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", alphaTarget.id);
    const untouched = await getObservation(ctx, alphaTarget.id);
    check("observation-cross-tenant-resolve", untouched?.status === "active", `status=${untouched?.status}`);
  }

  // Model-supplied observation ids are validated server-side.
  check("observation-forged-id-rejected",
    (await getObservation(ctx, crypto.randomUUID())) === null);

  // =========================================================================
  // 17 — SWEEP ENDPOINT SECRET HYGIENE (static guarantees)
  // =========================================================================
  const routeSrc = readFileSync(join(root, "src/app/api/officer/sweep/route.ts"), "utf8");
  check("sweep-endpoint-disabled-without-secret", routeSrc.includes('status: 404') && routeSrc.includes("VAZORA_SWEEP_SECRET"));
  check("sweep-endpoint-constant-time-compare", routeSrc.includes("timingSafeEqual"));
  check("sweep-endpoint-requires-membership", routeSrc.includes("buildOfficerContext") && routeSrc.includes("status: 403"));
  check("sweep-endpoint-no-secret-echo",
    !/return\s+NextResponse\.json\([^)]*secret/i.test(routeSrc) && !routeSrc.includes("console.log(secret"));
  check("sweep-endpoint-counts-only",
    routeSrc.includes("failures: outcome.failures.length"),
    "failure codes only, no contract text");
  // The service-role key must never reach a client bundle.
  const clientLeak = readFileSync(join(root, "src/lib/officer/sweep.ts"), "utf8");
  check("service-role-not-in-officer-lib", !clientLeak.includes("SERVICE_ROLE"));
  check("sweep-route-is-server-only", !routeSrc.includes('"use client"'));

  // Teardown must refuse anything that is not an explicitly marked benchmark
  // org — even when the caller legitimately owns the target.
  {
    const realOrgId = crypto.randomUUID();
    const { error: insErr } = await alpha.client.from("organizations").insert({
      id: realOrgId, name: "Real Production Org", slug: `prod-${Date.now()}`,
      created_by: alpha.userId, timezone: "Asia/Riyadh",
      timezone_set_at: new Date().toISOString(),
    });
    check("nonbench-org-seeded", !insErr, insErr?.message ?? "");
    const refused = await teardownBenchmarkOrganization({ ...alpha, orgId: realOrgId });
    check("teardown-refuses-unmarked-org", !refused.ok, refused.error ?? "");
    const { data: still } = await alpha.client.from("organizations")
      .select("id").eq("id", realOrgId).maybeSingle();
    check("unmarked-org-survives", !!still);
    await alpha.client.from("organizations").delete().eq("id", realOrgId); // direct owner delete, not teardown
    const missing = await teardownBenchmarkOrganization({ ...alpha, orgId: crypto.randomUUID() });
    check("teardown-refuses-unknown-id", !missing.ok);
  }

  // Benchmark tenants are disposable — cascade-remove them so they never accumulate.
  for (const fx of [alpha, beta]) {
    const td = await teardownBenchmarkOrganization(fx);
    check(`cleanup-${fx.orgId.slice(0, 8)}`, td.ok, td.error ?? "");
  }

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nOFFICER SECURITY: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
