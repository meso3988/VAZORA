/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A CP1 — live Contract Officer security regression.
// Two real tenants on separate user-JWT clients (the production surface —
// the app never uses a service role). Alpha attacks Beta's officer state and
// drives the tool layer with hostile, model-style arguments.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-isolation.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { approveOfficerAction, rejectOfficerAction } from "../../src/lib/officer/actions";
import { recordMemory, loadUsableMemory } from "../../src/lib/officer/memory";
import { runOfficerTool } from "../../src/lib/officer/tools";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function makeTenant(label: string, timezone: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const email = `qa-officer-${label}-${Date.now()}@vazora.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Qa!${crypto.randomUUID()}` });
  if (error || !data.user || !data.session) throw new Error(`${label} signUp: ${error?.message ?? "no session"}`);
  const orgId = crypto.randomUUID();
  const { error: oe } = await client.from("organizations").insert({
    id: orgId, name: `QA ${label}`, slug: `qa-off-${label}-${Date.now()}`, created_by: data.user.id, timezone,
  });
  if (oe) throw new Error(`${label} org: ${oe.message}`);
  const { error: me } = await client.from("organization_members")
    .insert({ organization_id: orgId, user_id: data.user.id, role: "owner" });
  if (me) throw new Error(`${label} member: ${me.message}`);
  return { client, userId: data.user.id, orgId };
}

async function seedContract(client: any, orgId: string, tag: string) {
  const contractId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const ingestionId = crypto.randomUUID();
  const clauseId = crypto.randomUUID();
  const obligationId = crypto.randomUUID();
  const seed = async (table: string, row: Record<string, unknown>) => {
    const { error } = await client.from(table).insert(row);
    if (error) throw new Error(`${tag} seed ${table}: ${error.message}`);
  };
  await seed("contracts", { id: contractId, organization_id: orgId, contract_number: `${tag}-1`, title: `${tag} contract` });
  await seed("contract_documents", { id: docId, organization_id: orgId, contract_id: contractId, file_name: `${tag}.pdf`, storage_path: `${orgId}/docs/${tag}.pdf`, mime_type: "application/pdf", file_size: 10 });
  await seed("contract_ingestion_runs", { id: ingestionId, organization_id: orgId, contract_id: contractId, status: "approved", parser_version: "qa", extractor_version: "qa" });
  await seed("contract_clauses", { id: clauseId, organization_id: orgId, contract_id: contractId, ingestion_run_id: ingestionId, document_id: docId, clause_number: "14.2", heading: `${tag} clause`, text: `${tag} clause text`, page_number: 1 });
  // Activation is gated on traceability: create the obligation as a draft,
  // register its source reference, then activate (the Phase 2B rule).
  await seed("contract_obligations", {
    id: obligationId, organization_id: orgId, contract_id: contractId, ingestion_run_id: ingestionId,
    title: `${tag} obligation`, requirement_text: `${tag} requirement`,
  });
  await seed("obligation_source_refs", {
    organization_id: orgId, obligation_id: obligationId, document_id: docId,
    clause_id: clauseId, page_number: 1, source_snippet: `${tag} clause text`,
  });
  const { error: actErr } = await client
    .from("contract_obligations")
    .update({ review_status: "approved", activation_status: "active" })
    .eq("id", obligationId);
  if (actErr) throw new Error(`${tag} activate obligation: ${actErr.message}`);
  return { contractId, obligationId, clauseId };
}

async function main() {
  const alpha = await makeTenant("alpha", "Asia/Riyadh");
  const beta = await makeTenant("beta", "Europe/London");
  const A = alpha.client;
  const B = beta.client;

  const alphaC = await seedContract(A, alpha.orgId, "ALPHA");
  const betaC = await seedContract(B, beta.orgId, "BETA");

  // ---------- Beta seeds officer state Alpha must never see ----------
  await ensureOfficerProfile({ supabase: B, organizationId: beta.orgId });
  const betaConvId = crypto.randomUUID();
  const betaMsgId = crypto.randomUUID();
  const betaMemId = crypto.randomUUID();
  const betaActionId = crypto.randomUUID();
  const betaObsId = crypto.randomUUID();
  const bseed = async (table: string, row: Record<string, unknown>) => {
    const { error } = await B.from(table).insert(row);
    if (error) throw new Error(`beta seed ${table}: ${error.message}`);
  };
  await bseed("officer_conversations", { id: betaConvId, organization_id: beta.orgId, scope: "contract", contract_id: betaC.contractId, title: "Beta confidential thread", created_by: beta.userId });
  await bseed("officer_messages", { id: betaMsgId, organization_id: beta.orgId, conversation_id: betaConvId, role: "user", content: "Beta secret question", author_user_id: beta.userId });
  await bseed("officer_memory", { id: betaMemId, organization_id: beta.orgId, scope: "organization", kind: "fact", content: "Beta secret memory", origin: "user_confirmed", state: "confirmed", confirmed_by: beta.userId, author_user_id: beta.userId });
  await bseed("officer_actions", { id: betaActionId, organization_id: beta.orgId, contract_id: betaC.contractId, action_type: "obligation.assign_owner", arguments: {}, reason: "beta proposal", requires_approval: true, status: "waiting_for_approval" });
  await bseed("officer_observations", { id: betaObsId, organization_id: beta.orgId, contract_id: betaC.contractId, kind: "evidence_missing", title: "Beta observation", dedupe_key: `beta-${Date.now()}` });

  // ---------- contexts ----------
  const alphaCtx = await buildOfficerContext({ supabase: A, organizationId: alpha.orgId, userId: alpha.userId, locale: "en" });
  const betaCtx = await buildOfficerContext({ supabase: B, organizationId: beta.orgId, userId: beta.userId, locale: "en" });
  if (!alphaCtx || !betaCtx) throw new Error("context build failed");
  check("ctx-alpha-role", alphaCtx.role === "owner", alphaCtx.role);
  check("ctx-timezone-per-org",
    alphaCtx.clock.timeZone === "Asia/Riyadh" && betaCtx.clock.timeZone === "Europe/London",
    `${alphaCtx.clock.timeZone} / ${betaCtx.clock.timeZone}`);

  // A forged organization id must not yield a context: membership is authority.
  const forged = await buildOfficerContext({ supabase: A, organizationId: beta.orgId, userId: alpha.userId, locale: "en" });
  check("ctx-forged-org-denied", forged === null, forged ? "context built!" : "");

  // ---------- 1. raw table reads ----------
  const reads: [string, string][] = [
    ["officer_conversations", betaConvId],
    ["officer_messages", betaMsgId],
    ["officer_memory", betaMemId],
    ["officer_actions", betaActionId],
    ["officer_observations", betaObsId],
    ["officer_profiles", ""],
  ];
  for (const [table] of reads) {
    const { data } = await A.from(table).select("id").eq("organization_id", beta.orgId);
    check(`read-beta-${table}`, (data ?? []).length === 0, `rows=${(data ?? []).length}`);
  }

  // ---------- 2. cross-tenant writes ----------
  const { error: convErr } = await A.from("officer_conversations").insert({
    organization_id: beta.orgId, scope: "organization", created_by: alpha.userId,
  });
  check("write-beta-conversation", !!convErr, convErr?.message.slice(0, 60) ?? "inserted!");

  // Alpha's own org id, but Beta's contract — the nastiest shape.
  const { error: mixedErr } = await A.from("officer_conversations").insert({
    organization_id: alpha.orgId, scope: "contract", contract_id: betaC.contractId, created_by: alpha.userId,
  });
  check("write-mixed-tenant-contract", !!mixedErr, mixedErr?.message.slice(0, 60) ?? "inserted!");

  const { error: msgErr } = await A.from("officer_messages").insert({
    organization_id: alpha.orgId, conversation_id: betaConvId, role: "assistant", content: "injected",
  });
  check("write-into-beta-conversation", !!msgErr, msgErr?.message.slice(0, 60) ?? "inserted!");

  const { error: actErr } = await A.from("officer_actions").insert({
    organization_id: alpha.orgId, contract_id: betaC.contractId,
    action_type: "obligation.assign_owner", arguments: {}, reason: "cross-tenant", requires_approval: true,
  });
  check("write-action-against-beta-contract", !!actErr, actErr?.message.slice(0, 60) ?? "inserted!");

  const { error: obsErr } = await A.from("officer_observations").insert({
    organization_id: alpha.orgId, contract_id: betaC.contractId, kind: "x", title: "x", dedupe_key: `x-${Date.now()}`,
  });
  check("write-observation-against-beta-contract", !!obsErr, obsErr?.message.slice(0, 60) ?? "inserted!");

  // ---------- 3. cross-tenant updates ----------
  await A.from("officer_actions").update({ status: "approved", approved_by: alpha.userId }).eq("id", betaActionId);
  const { data: betaAction } = await B.from("officer_actions").select("status, approved_by").eq("id", betaActionId).maybeSingle();
  check("update-beta-action-blocked",
    betaAction?.status === "waiting_for_approval" && betaAction?.approved_by === null,
    `status=${betaAction?.status}`);

  await A.from("officer_memory").update({ content: "tampered" }).eq("id", betaMemId);
  const { data: betaMem } = await B.from("officer_memory").select("content").eq("id", betaMemId).maybeSingle();
  check("update-beta-memory-blocked", betaMem?.content === "Beta secret memory", String(betaMem?.content));

  // Messages are an immutable transcript — even the owner cannot rewrite one.
  await B.from("officer_messages").update({ content: "rewritten history" }).eq("id", betaMsgId);
  const { data: betaMsg } = await B.from("officer_messages").select("content").eq("id", betaMsgId).maybeSingle();
  check("messages-immutable", betaMsg?.content === "Beta secret question", String(betaMsg?.content));

  // ---------- 4. DB-level memory integrity ----------
  const { error: specErr } = await A.from("officer_memory").insert({
    organization_id: alpha.orgId, scope: "organization", kind: "fact",
    content: "the client probably approved it", origin: "model_inference", state: "confirmed",
  });
  check("model-inference-cannot-be-confirmed", !!specErr, specErr?.message.slice(0, 70) ?? "inserted!");

  const { error: unappErr } = await A.from("officer_actions").insert({
    organization_id: alpha.orgId, action_type: "evidence.dismiss_gap", arguments: {},
    reason: "no approver", requires_approval: true, status: "completed",
  });
  check("approval-required-needs-approver", !!unappErr, unappErr?.message.slice(0, 70) ?? "inserted!");

  // ---------- 5. tool layer against hostile arguments ----------
  const t1 = await runOfficerTool(alphaCtx, "getContract", { contractId: betaC.contractId });
  check("tool-getContract-cross-tenant", !t1.ok, JSON.stringify(t1).slice(0, 80));

  const t2 = await runOfficerTool(alphaCtx, "getObligation", { obligationId: betaC.obligationId });
  check("tool-getObligation-cross-tenant", !t2.ok, JSON.stringify(t2).slice(0, 80));

  const t3 = await runOfficerTool(alphaCtx, "getEvidenceGaps", { contractId: betaC.contractId });
  check("tool-getEvidenceGaps-cross-tenant", !t3.ok, JSON.stringify(t3).slice(0, 80));

  const t4 = await runOfficerTool(alphaCtx, "getVerificationDiscrepancies", { contractId: betaC.contractId });
  check("tool-getDiscrepancies-cross-tenant", !t4.ok, JSON.stringify(t4).slice(0, 80));

  // The model cannot widen scope by naming an organization: the schema is
  // strict, so an organizationId argument is rejected outright.
  const t5 = await runOfficerTool(alphaCtx, "listContracts", { organizationId: beta.orgId });
  check("tool-rejects-model-supplied-org", !t5.ok && String((t5 as any).error).startsWith("invalid_arguments"),
    JSON.stringify(t5).slice(0, 90));

  const t6 = await runOfficerTool(alphaCtx, "dropAllTables", {});
  check("tool-unknown-refused", !t6.ok && (t6 as any).error === "unknown_tool");

  const t7 = await runOfficerTool(alphaCtx, "getContract", { contractId: "not-a-uuid" });
  check("tool-bad-argument-refused", !t7.ok && String((t7 as any).error).startsWith("invalid_arguments"));

  // Alpha's own reads still work — isolation must not break the product.
  const t8 = await runOfficerTool(alphaCtx, "getContract", { contractId: alphaC.contractId });
  check("tool-own-contract-works", t8.ok, t8.ok ? t8.summary : JSON.stringify(t8));

  const t9 = await runOfficerTool(alphaCtx, "getOrganizationSummary", {});
  check("tool-summary-scoped",
    t9.ok && (t9.data as any).contracts.total === 1 && (t9.data as any).organization === "QA alpha",
    t9.ok ? JSON.stringify((t9.data as any).contracts) : JSON.stringify(t9));

  const t10 = await runOfficerTool(alphaCtx, "getUpcomingObligations", { withinDays: 7 });
  check("tool-upcoming-uses-org-clock",
    t10.ok && (t10.data as any).timeZone === "Asia/Riyadh", t10.ok ? "" : JSON.stringify(t10));

  // ---------- 6. assignment safety ----------
  const t11 = await runOfficerTool(alphaCtx, "proposeAssignment", {
    obligationId: alphaC.obligationId, assigneeUserId: beta.userId, reason: "assign another company's employee",
  });
  check("tool-assignee-must-be-member", !t11.ok && (t11 as any).error === "assignee_not_a_member_of_this_organization",
    JSON.stringify(t11).slice(0, 90));

  const t12 = await runOfficerTool(alphaCtx, "proposeAssignment", {
    obligationId: betaC.obligationId, assigneeUserId: alpha.userId, reason: "beta obligation",
  });
  check("tool-assign-cross-tenant-obligation", !t12.ok, JSON.stringify(t12).slice(0, 80));

  // ---------- 7. proposal → approval → execution ----------
  const propose = await runOfficerTool(alphaCtx, "requestHumanApproval", {
    actionType: "officer.request_evidence_internal",
    summary: "Request SLA record", reason: "Clause requires it; no verified evidence exists.",
    contractId: alphaC.contractId,
  });
  check("propose-approval-required", propose.ok && (propose.data as any).status === "waiting_for_approval",
    propose.ok ? JSON.stringify(propose.data) : JSON.stringify(propose));
  const approvalActionId = propose.ok ? (propose.data as any).id : "";

  // Beta must not approve Alpha's action.
  const betaApprove = await approveOfficerAction(betaCtx, approvalActionId);
  check("approve-cross-tenant-blocked", !betaApprove.ok && betaApprove.error === "not_found", JSON.stringify(betaApprove));

  // Approval-required actions stop at "approved" in Phase 4A — no silent execution.
  const alphaApprove = await approveOfficerAction(alphaCtx, approvalActionId);
  check("approve-does-not-silently-execute",
    alphaApprove.ok && alphaApprove.data.executed === false && alphaApprove.data.status === "approved",
    JSON.stringify(alphaApprove));

  const { data: approvedRow } = await A.from("officer_actions")
    .select("status, approved_by, executed_at, execution_result").eq("id", approvalActionId).maybeSingle();
  check("approval-attributed-to-human",
    approvedRow?.approved_by === alpha.userId && approvedRow?.executed_at === null,
    JSON.stringify(approvedRow).slice(0, 120));

  const doubleApprove = await approveOfficerAction(alphaCtx, approvalActionId);
  check("no-double-approval", !doubleApprove.ok, JSON.stringify(doubleApprove));

  // Internal bookkeeping DOES execute — and is attributed.
  const note = await runOfficerTool(alphaCtx, "createInternalAction", {
    actionType: "officer.internal_task", title: "Follow up on SLA record",
    reason: "Officer bookkeeping", contractId: alphaC.contractId,
  });
  check("internal-action-suggested", note.ok && (note.data as any).status === "suggested",
    note.ok ? JSON.stringify(note.data) : JSON.stringify(note));
  const noteId = note.ok ? (note.data as any).id : "";
  const runNote = await approveOfficerAction(alphaCtx, noteId);
  check("internal-action-executes", runNote.ok && runNote.data.executed === true && runNote.data.status === "completed",
    JSON.stringify(runNote));

  const reject = await runOfficerTool(alphaCtx, "requestHumanApproval", {
    actionType: "officer.escalate", summary: "Escalate", reason: "test rejection path",
  });
  const rejectId = reject.ok ? (reject.data as any).id : "";
  const rejected = await rejectOfficerAction(alphaCtx, rejectId, "not needed");
  check("reject-path", rejected.ok, JSON.stringify(rejected));
  const rejectAgain = await approveOfficerAction(alphaCtx, rejectId);
  check("cannot-approve-after-reject", !rejectAgain.ok, JSON.stringify(rejectAgain));

  // ---------- 8. memory truth rules ----------
  const mem1 = await recordMemory(alphaCtx, {
    content: "The client signature is expected tomorrow (per the project manager).",
    origin: "user_confirmed", kind: "promise", contractId: alphaC.contractId,
  });
  check("memory-user-confirmed", mem1.ok && mem1.data.state === "confirmed", JSON.stringify(mem1).slice(0, 90));

  const mem2 = await recordMemory(alphaCtx, {
    content: "The client probably approved it.", origin: "model_inference",
  });
  check("memory-inference-stays-unconfirmed", mem2.ok && mem2.data.state === "unconfirmed",
    JSON.stringify(mem2).slice(0, 90));

  const mem3 = await recordMemory(alphaCtx, {
    content: "cross-tenant memory", origin: "user_confirmed", contractId: betaC.contractId,
  });
  check("memory-cross-tenant-contract-refused", !mem3.ok, JSON.stringify(mem3).slice(0, 80));

  const usable = await loadUsableMemory(alphaCtx, { contractId: alphaC.contractId });
  check("memory-usable-excludes-inference",
    usable.some((m) => m.origin === "user_confirmed") && !usable.some((m) => m.origin === "model_inference"),
    `usable=${usable.length}`);

  const betaMemory = await loadUsableMemory(betaCtx, {});
  check("memory-tenant-scoped",
    !betaMemory.some((m) => m.content.includes("client signature is expected")),
    `beta usable=${betaMemory.length}`);

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nOFFICER ISOLATION: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
