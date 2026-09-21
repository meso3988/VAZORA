/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 3 stability patch — VERIFICATION_DISCREPANCY live regression.
// Drives the REAL pipeline (runEvidenceVerification → extraction → scripted
// deterministic provider → gap reconciliation) against a live tenant: a
// weaker re-run on the SAME immutable version must record a discrepancy and
// leave the resolved gap untouched; a NEW version reconciles normally.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/discrepancy.test.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

// ---- scripted deterministic verifier — no model calls ----------------------
import { resolveDiscrepancy } from "../../src/lib/evidence/discrepancy";
import { runEvidenceVerification } from "../../src/lib/evidence/run";
import type { ProviderCheck } from "../../src/lib/evidence/schema";
import { registerVerificationProvider } from "../../src/lib/evidence/verifier";

const scriptedQueue: ProviderCheck[][] = [];
process.env.VAZORA_VERIFICATION_PROVIDER = "qa-scripted";
registerVerificationProvider("qa-scripted", () => ({
  id: "qa-scripted",
  model: "qa-deterministic",
  async verify() {
    const next = scriptedQueue.shift();
    return next ? { ok: true as const, checks: next } : { ok: false as const, error: "scripted queue empty" };
  },
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function makeTenant(label: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const email = `qa-disc-${label}-${Date.now()}@vazora.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Qa!${crypto.randomUUID()}` });
  if (error || !data.user || !data.session) throw new Error(`${label} signUp: ${error?.message ?? "no session"}`);
  const orgId = crypto.randomUUID();
  const { error: oe } = await client.from("organizations").insert({ id: orgId, name: `QA ${label}`, slug: `qa-${label}-${Date.now()}`, created_by: data.user.id });
  if (oe) throw new Error(`${label} org: ${oe.message}`);
  const { error: me } = await client.from("organization_members").insert({ organization_id: orgId, user_id: data.user.id, role: "owner" });
  if (me) throw new Error(`${label} member: ${me.message}`);
  return { client, userId: data.user.id, orgId };
}

const CSV_TEXT = [
  "MONTHLY REPORT — QA stability fixture",
  "Reporting period: 01-11-2025 to 30-11-2025",
  "Contractor signature: signed — QA Fixture",
].join("\n");

async function main() {
  const alpha = await makeTenant("alpha");
  const beta = await makeTenant("beta");
  const A = alpha.client;
  const B = beta.client;

  const contractId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const ingestionId = crypto.randomUUID();
  const obligationId = crypto.randomUUID();
  const requirementId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const version1Id = crypto.randomUUID();
  const version2Id = crypto.randomUUID();
  const gapSeedId = crypto.randomUUID();
  const storagePath1 = `${alpha.orgId}/${itemId}/v1-report.csv`;
  const storagePath2 = `${alpha.orgId}/${itemId}/v2-report.csv`;

  const seed = async (table: string, row: Record<string, unknown>) => {
    const { error } = await A.from(table).insert(row);
    if (error) throw new Error(`alpha seed ${table}: ${error.message}`);
  };

  await seed("contracts", { id: contractId, organization_id: alpha.orgId, contract_number: "A-DISC-1", title: "Alpha contract" });
  await seed("contract_documents", { id: docId, organization_id: alpha.orgId, contract_id: contractId, file_name: "a.pdf", storage_path: `${alpha.orgId}/docs/a.pdf`, mime_type: "application/pdf", file_size: 10 });
  await seed("contract_ingestion_runs", { id: ingestionId, organization_id: alpha.orgId, contract_id: contractId, status: "approved", parser_version: "t", extractor_version: "t" });
  await seed("contract_obligations", { id: obligationId, organization_id: alpha.orgId, contract_id: contractId, ingestion_run_id: ingestionId, title: "Alpha obligation", requirement_text: "alpha req", review_status: "approved" });
  await seed("obligation_evidence_requirements", { id: requirementId, organization_id: alpha.orgId, obligation_id: obligationId, name: "Alpha report", evidence_type: "report", required: true });
  await seed("evidence_items", { id: itemId, organization_id: alpha.orgId, contract_id: contractId, obligation_id: obligationId, title: "Alpha evidence", status: "received" });
  await seed("evidence_versions", { id: version1Id, organization_id: alpha.orgId, evidence_item_id: itemId, version_number: 1, file_name: "v1-report.csv", storage_path: storagePath1, mime_type: "text/csv", file_size: CSV_TEXT.length, file_hash: "disc-v1", uploaded_by: alpha.userId });
  await seed("evidence_requirement_links", { evidence_item_id: itemId, evidence_requirement_id: requirementId, organization_id: alpha.orgId });
  await seed("evidence_gaps", { id: gapSeedId, organization_id: alpha.orgId, contract_id: contractId, obligation_id: obligationId, evidence_requirement_id: requirementId, status: "open", description: "seeded gap" });

  const { error: upErr } = await A.storage.from("contract-evidence").upload(storagePath1, new Blob([CSV_TEXT], { type: "text/csv" }), { contentType: "text/csv" });
  if (upErr) throw new Error(`alpha storage seed: ${upErr.message}`);

  const runVerify = () =>
    runEvidenceVerification({
      supabase: A,
      organizationId: alpha.orgId,
      evidenceItemId: itemId,
      userId: alpha.userId,
    });

  const scriptCheck = (result: string, excerpt: string | null): ProviderCheck => ({
    requirement_id: requirementId,
    result: result as ProviderCheck["result"],
    confidence: 0.9,
    reason: `scripted ${result}`,
    source_excerpt: excerpt,
    source_page: null,
    source_location: null,
    contradiction: false,
  });

  const gapsOf = async () =>
    (await A.from("evidence_gaps").select("id, status, opened_via, closed_by_verification_run_id").eq("organization_id", alpha.orgId).eq("evidence_requirement_id", requirementId)).data ?? [];
  const discrepanciesOf = async (client: any = A) =>
    (await client.from("evidence_verification_discrepancies").select("*").eq("organization_id", alpha.orgId)).data ?? [];
  const eventsOf = async (type: string) =>
    (await A.from("activity_log").select("id, metadata").eq("organization_id", alpha.orgId).eq("event_type", type)).data ?? [];

  // ===== A. v1 verified → same v1 rerun needs_human_review ==================
  scriptedQueue.push([scriptCheck("verified", "Contractor signature: signed — QA Fixture")]);
  const run1 = await runVerify();
  check("a1-run1-verified", run1.ok === true, JSON.stringify(run1));
  let gaps = await gapsOf();
  check("a2-gap-resolved", gaps.length === 1 && gaps[0].status === "resolved" && !!gaps[0].closed_by_verification_run_id,
    `gaps=${JSON.stringify(gaps)}`);

  scriptedQueue.push([scriptCheck("needs_human_review", null)]);
  const run2 = await runVerify();
  check("a3-run2-weaker", run2.ok === true, JSON.stringify(run2));
  gaps = await gapsOf();
  const discs = await discrepanciesOf();
  check("a4-no-new-gap", gaps.length === 1 && gaps[0].status === "resolved", `gaps=${JSON.stringify(gaps)}`);
  check("a5-discrepancy-recorded", discs.length === 1 && discs[0].status === "pending"
    && discs[0].prior_result === "verified" && discs[0].current_result === "needs_human_review"
    && discs[0].prior_run_id === (run1 as any).runId && discs[0].current_run_id === (run2 as any).runId
    && discs[0].evidence_version_id === version1Id,
    `discs=${JSON.stringify(discs.map((d: any) => ({ s: d.status, pr: d.prior_result, cr: d.current_result })))}`);
  check("a6-detected-event", (await eventsOf("evidence.verification_discrepancy_detected")).length === 1, "");

  // ===== B. NEW version v2 missing → normal gap behavior ====================
  await seed("evidence_versions", { id: version2Id, organization_id: alpha.orgId, evidence_item_id: itemId, version_number: 2, file_name: "v2-report.csv", storage_path: storagePath2, mime_type: "text/csv", file_size: 20, file_hash: "disc-v2", uploaded_by: alpha.userId });
  const { error: upErr2 } = await A.storage.from("contract-evidence").upload(storagePath2, new Blob(["empty v2\n"], { type: "text/csv" }), { contentType: "text/csv" });
  if (upErr2) throw new Error(`alpha v2 storage: ${upErr2.message}`);

  scriptedQueue.push([scriptCheck("missing", null)]);
  const run3 = await runVerify(); // latest version = v2
  check("b1-run3-missing", run3.ok === true, JSON.stringify(run3));
  gaps = await gapsOf();
  const openV2 = gaps.filter((g: any) => g.status !== "resolved" && g.opened_via === "verification_run");
  check("b2-new-version-gap-opens", openV2.length === 1, `gaps=${JSON.stringify(gaps.map((g: any) => ({ s: g.status, v: g.opened_via })))}`);
  check("b3-no-new-version-discrepancy", (await discrepanciesOf()).length === 1, "still one discrepancy (v1 only)");

  // Human confirms regression on... wait — the v2 gap is legitimately open.
  // Resolve it cleanly via a verified rerun on v2 so step D stays isolated.
  scriptedQueue.push([scriptCheck("verified", "empty v2")]);
  const run3b = await runVerify();
  check("b4-v2-reverified", run3b.ok === true && (await gapsOf()).every((g: any) => g.status === "resolved"),
    `gaps=${JSON.stringify(await gapsOf())}`);

  // ===== C. keep_prior — prior verified state retained ======================
  const disc1 = (await discrepanciesOf())[0];
  const keep = await resolveDiscrepancy({
    supabase: A, orgId: alpha.orgId, userId: alpha.userId,
    discrepancyId: disc1.id, decision: "keep_prior", reason: "model noise — evidence unchanged",
  });
  check("c1-keep-ok", keep.ok === true, JSON.stringify(keep));
  const disc1After = (await discrepanciesOf())[0];
  check("c2-kept-prior", disc1After.status === "kept_prior" && disc1After.resolved_by === alpha.userId && !!disc1After.resolved_at,
    `status=${disc1After.status}`);
  check("c3-still-no-gap", (await gapsOf()).every((g: any) => g.status === "resolved"), "");
  check("c4-retained-event", (await eventsOf("evidence.verification_previous_state_retained")).length === 1, "");

  // ===== D. new pending discrepancy → confirm regression ====================
  // Another weaker rerun on v1? v2 is now latest — run explicitly against v1.
  scriptedQueue.push([scriptCheck("needs_human_review", null)]);
  const run4 = await runEvidenceVerification({
    supabase: A, organizationId: alpha.orgId, evidenceItemId: itemId,
    evidenceVersionId: version1Id, userId: alpha.userId,
  });
  check("d1-run4-weaker-v1", run4.ok === true, JSON.stringify(run4));
  const discs2 = await discrepanciesOf();
  const disc2 = discs2.find((d: any) => d.status === "pending");
  check("d2-second-discrepancy", discs2.length === 2 && !!disc2 && disc2.evidence_version_id === version1Id,
    `discs=${discs2.length}`);
  check("d3-gaps-still-resolved", (await gapsOf()).every((g: any) => g.status === "resolved"),
    `gaps=${JSON.stringify((await gapsOf()).map((g: any) => g.status))}`);

  const confirm = await resolveDiscrepancy({
    supabase: A, orgId: alpha.orgId, userId: alpha.userId,
    discrepancyId: disc2.id, decision: "confirm_regression", reason: "evidence actually insufficient",
  });
  check("d4-confirm-ok", confirm.ok === true, JSON.stringify(confirm));
  gaps = await gapsOf();
  const regressed = gaps.find((g: any) => g.opened_via === "human_confirmed_verification_regression");
  check("d5-attributed-gap-open", !!regressed && regressed.status !== "resolved",
    `gaps=${JSON.stringify(gaps.map((g: any) => ({ s: g.status, v: g.opened_via })))}`);
  check("d6-confirmed-event", (await eventsOf("evidence.verification_regression_confirmed")).length === 1, "");
  const disc2After = (await discrepanciesOf()).find((d: any) => d.id === disc2.id);
  check("d7-status-confirmed", disc2After.status === "regression_confirmed" && disc2After.resolved_by === alpha.userId,
    `status=${disc2After?.status}`);
  // Double-decision must fail — already resolved.
  const again = await resolveDiscrepancy({
    supabase: A, orgId: alpha.orgId, userId: alpha.userId,
    discrepancyId: disc2.id, decision: "keep_prior", reason: "late flip",
  });
  check("d8-no-double-decision", again.ok === false && (again as any).error === "already_resolved", JSON.stringify(again));

  // ===== E. historical integrity — every run + check intact =================
  const { data: runRows } = await A.from("evidence_verification_runs")
    .select("id, status, overall_result, verifier_model, evidence_version_id")
    .eq("organization_id", alpha.orgId).eq("evidence_item_id", itemId)
    .order("created_at", { ascending: true });
  const { data: checkRows } = await A.from("evidence_verification_checks")
    .select("verification_run_id, evidence_requirement_id, result, human_result, reason")
    .eq("organization_id", alpha.orgId)
    .order("created_at", { ascending: true });
  check("e1-five-runs-intact", (runRows ?? []).length === 5 && (runRows ?? []).every((r: any) => r.status === "completed"),
    `runs=${(runRows ?? []).length}`);
  const criterionCheckResults = (checkRows ?? [])
    .filter((c: any) => c.evidence_requirement_id !== null)
    .map((c: any) => c.result);
  check("e2-checks-untouched", criterionCheckResults.join(",") === "verified,needs_human_review,missing,verified,needs_human_review"
    && (checkRows ?? []).length === 10
    && (checkRows ?? []).every((c: any) => c.human_result === null),
    `results=${criterionCheckResults.join(",")} total=${(checkRows ?? []).length}`);

  // ===== F. RLS — Beta cannot see, decide, or forge Alpha discrepancies =====
  const betaSees = await B.from("evidence_verification_discrepancies").select("id").eq("organization_id", alpha.orgId);
  check("f1-cross-tenant-read", (betaSees.data ?? []).length === 0, `rows=${(betaSees.data ?? []).length}`);
  const betaDecide = await resolveDiscrepancy({
    supabase: B, orgId: beta.orgId, userId: beta.userId,
    discrepancyId: disc1.id, decision: "confirm_regression", reason: "cross-tenant attack",
  });
  check("f2-cross-tenant-decide", betaDecide.ok === false, JSON.stringify(betaDecide));
  const { error: forgeErr } = await B.from("evidence_verification_discrepancies").insert({
    organization_id: alpha.orgId, evidence_item_id: itemId, evidence_version_id: version1Id,
    evidence_requirement_id: requirementId, prior_check_id: (await A.from("evidence_verification_checks").select("id").limit(1)).data[0].id,
    current_check_id: (await A.from("evidence_verification_checks").select("id").limit(1)).data[0].id,
    prior_run_id: (run1 as any).runId, current_run_id: (run2 as any).runId,
    prior_result: "verified", current_result: "missing",
  });
  check("f3-cross-tenant-forge", !!forgeErr, forgeErr?.message ?? "inserted!");
  // Beta deciding under Alpha's org id — resolveDiscrepancy scopes by org.
  const betaAsAlpha = await resolveDiscrepancy({
    supabase: B, orgId: alpha.orgId, userId: beta.userId,
    discrepancyId: disc1.id, decision: "keep_prior", reason: "forged org scope",
  });
  check("f4-forged-org-decide", betaAsAlpha.ok === false, JSON.stringify(betaAsAlpha));
  // Alpha-side sanity: discrepancy1 unchanged (still kept_prior).
  check("f5-alpha-state-unchanged", (await discrepanciesOf())[0].status === "kept_prior", "");

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
