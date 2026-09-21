/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 3 UX consistency patch — PERSISTED QA scenario seeder.
// Builds four real, inspectable evidence items by driving the actual
// verification pipeline with a scripted deterministic verifier, then writes
// their ids to supabase/tests/qa-ux-scenarios.json so the browser QA run
// (e2e-ux.mts) can assert the UI against known operational states.
//
//   A  verified → same-version weaker rerun          → pending discrepancy
//   B  A + human "keep previous verified state"      → kept_prior
//   C  A + human "confirm regression"                → attributed new gap
//   D  verified v1 → NEW version genuinely fails     → ordinary gap, no discrepancy
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/qa-scenarios-ux.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

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

const REPORT = [
  "MONTHLY PERFORMANCE REPORT — QA UX fixture",
  "Reporting period: 01-11-2025 to 30-11-2025",
  "Contractor signature: signed — QA Fixture",
].join("\n");
const EMPTY_V2 = "placeholder upload with no signature section\n";

async function main() {
  const stamp = Date.now();
  const email = `qa-ux-${stamp}@vazora.test`;
  const password = `Qa!${crypto.randomUUID()}`;

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const { data: auth, error: authErr } = await client.auth.signUp({ email, password });
  if (authErr || !auth.user || !auth.session) throw new Error(`signUp: ${authErr?.message ?? "no session"}`);
  const userId = auth.user.id as string;
  const orgId = crypto.randomUUID();

  const seed = async (table: string, row: Record<string, unknown>) => {
    const { error } = await client.from(table).insert(row);
    if (error) throw new Error(`seed ${table}: ${error.message}`);
  };

  await seed("organizations", { id: orgId, name: "QA UX", slug: `qa-ux-${stamp}`, created_by: userId });
  await seed("organization_members", { organization_id: orgId, user_id: userId, role: "owner" });

  const contractId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const ingestionId = crypto.randomUUID();
  const obligationId = crypto.randomUUID();
  await seed("contracts", { id: contractId, organization_id: orgId, contract_number: `QA-UX-${stamp}`, title: "QA UX Consistency Contract" });
  await seed("contract_documents", { id: docId, organization_id: orgId, contract_id: contractId, file_name: "qa.pdf", storage_path: `${orgId}/docs/qa.pdf`, mime_type: "application/pdf", file_size: 10 });
  await seed("contract_ingestion_runs", { id: ingestionId, organization_id: orgId, contract_id: contractId, status: "approved", parser_version: "qa", extractor_version: "qa" });
  await seed("contract_obligations", { id: obligationId, organization_id: orgId, contract_id: contractId, ingestion_run_id: ingestionId, title: "Monthly performance reporting", requirement_text: "Submit a signed monthly performance report.", review_status: "approved" });

  /** One isolated evidence item + requirement per scenario. */
  async function makeItem(label: string) {
    const requirementId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const storagePath = `${orgId}/${itemId}/v1-${label}.csv`;
    await seed("obligation_evidence_requirements", { id: requirementId, organization_id: orgId, obligation_id: obligationId, name: `Signed report — scenario ${label}`, evidence_type: "report", required: true });
    await seed("evidence_items", { id: itemId, organization_id: orgId, contract_id: contractId, obligation_id: obligationId, title: `Scenario ${label} — monthly report`, status: "received" });
    await seed("evidence_versions", { id: versionId, organization_id: orgId, evidence_item_id: itemId, version_number: 1, file_name: `v1-${label}.csv`, storage_path: storagePath, mime_type: "text/csv", file_size: REPORT.length, file_hash: `qa-ux-${label}-v1`, uploaded_by: userId });
    await seed("evidence_requirement_links", { evidence_item_id: itemId, evidence_requirement_id: requirementId, organization_id: orgId });
    const { error } = await client.storage.from("contract-evidence").upload(storagePath, new Blob([REPORT], { type: "text/csv" }), { contentType: "text/csv" });
    if (error) throw new Error(`storage ${label}: ${error.message}`);
    return { requirementId, itemId, versionId };
  }

  const scriptCheck = (requirementId: string, result: string, excerpt: string | null): ProviderCheck => ({
    requirement_id: requirementId,
    result: result as ProviderCheck["result"],
    confidence: 0.9,
    reason: `scripted ${result} for QA UX scenario`,
    source_excerpt: excerpt,
    source_page: null,
    source_location: null,
    contradiction: false,
  });

  const verify = (itemId: string, versionId?: string) =>
    runEvidenceVerification({
      supabase: client, organizationId: orgId, evidenceItemId: itemId,
      ...(versionId ? { evidenceVersionId: versionId } : {}), userId,
    });

  const pendingDiscrepancy = async (itemId: string) => {
    const { data } = await client
      .from("evidence_verification_discrepancies")
      .select("id").eq("organization_id", orgId).eq("evidence_item_id", itemId).eq("status", "pending").maybeSingle();
    if (!data) throw new Error(`expected a pending discrepancy on ${itemId}`);
    return data.id as string;
  };

  /** verified → same-version weaker rerun = pending discrepancy */
  async function seedDiscrepancy(label: string) {
    const item = await makeItem(label);
    scriptedQueue.push([scriptCheck(item.requirementId, "verified", "Contractor signature: signed — QA Fixture")]);
    const r1 = await verify(item.itemId);
    if (!r1.ok) throw new Error(`${label} run1: ${r1.error}`);
    scriptedQueue.push([scriptCheck(item.requirementId, "needs_human_review", null)]);
    const r2 = await verify(item.itemId);
    if (!r2.ok) throw new Error(`${label} run2: ${r2.error}`);
    return item;
  }

  // ---- A: pending discrepancy ------------------------------------------
  const a = await seedDiscrepancy("a");
  await pendingDiscrepancy(a.itemId);

  // ---- B: discrepancy → keep previous verified state --------------------
  const b = await seedDiscrepancy("b");
  const bDisc = await pendingDiscrepancy(b.itemId);
  const bKeep = await resolveDiscrepancy({
    supabase: client, orgId, userId, discrepancyId: bDisc,
    decision: "keep_prior", reason: "QA: unchanged evidence, model variability only",
  });
  if (!bKeep.ok) throw new Error(`B keep_prior: ${bKeep.error}`);

  // ---- C: discrepancy → confirm regression ------------------------------
  const c = await seedDiscrepancy("c");
  const cDisc = await pendingDiscrepancy(c.itemId);
  const cConfirm = await resolveDiscrepancy({
    supabase: client, orgId, userId, discrepancyId: cDisc,
    decision: "confirm_regression", reason: "QA: reviewer judged the evidence insufficient",
  });
  if (!cConfirm.ok) throw new Error(`C confirm_regression: ${cConfirm.error}`);

  // ---- D: NEW version genuinely fails → ordinary gap, no discrepancy ----
  const d = await makeItem("d");
  scriptedQueue.push([scriptCheck(d.requirementId, "verified", "Contractor signature: signed — QA Fixture")]);
  const d1 = await verify(d.itemId);
  if (!d1.ok) throw new Error(`D run1: ${d1.error}`);
  const dV2 = crypto.randomUUID();
  const dV2Path = `${orgId}/${d.itemId}/v2-d.csv`;
  await seed("evidence_versions", { id: dV2, organization_id: orgId, evidence_item_id: d.itemId, version_number: 2, file_name: "v2-d.csv", storage_path: dV2Path, mime_type: "text/csv", file_size: EMPTY_V2.length, file_hash: "qa-ux-d-v2", uploaded_by: userId });
  const { error: dUp } = await client.storage.from("contract-evidence").upload(dV2Path, new Blob([EMPTY_V2], { type: "text/csv" }), { contentType: "text/csv" });
  if (dUp) throw new Error(`D v2 storage: ${dUp.message}`);
  scriptedQueue.push([scriptCheck(d.requirementId, "missing", null)]);
  const d2 = await verify(d.itemId);
  if (!d2.ok) throw new Error(`D run2: ${d2.error}`);

  const { data: dDisc } = await client
    .from("evidence_verification_discrepancies")
    .select("id").eq("organization_id", orgId).eq("evidence_item_id", d.itemId);
  if ((dDisc ?? []).length !== 0) throw new Error("D must NOT produce a discrepancy — new version is real evidence");

  const scenarios = {
    createdAt: new Date().toISOString(),
    login: { email, password },
    orgId,
    contractId,
    obligationId,
    scenarios: {
      a: { ...a, label: "pending discrepancy", expect: { operational: "verified", latest: "needs_review", discrepancy: "pending" } },
      b: { ...b, label: "keep_prior", expect: { operational: "verified", latest: "needs_review", discrepancy: "kept_prior" } },
      c: { ...c, label: "confirm_regression", expect: { operational: "needs_review", gap: "human_confirmed_verification_regression" } },
      d: { ...d, v2: dV2, label: "new version fails", expect: { operational: "needs_review", gap: "verification_run", discrepancy: null } },
    },
  };
  const out = join(here, "qa-ux-scenarios.json");
  writeFileSync(out, `${JSON.stringify(scenarios, null, 2)}\n`);
  console.log(`seeded QA UX scenarios → ${out}`);
  console.log(`  org      ${orgId}`);
  console.log(`  contract ${contractId}`);
  for (const [k, v] of Object.entries(scenarios.scenarios)) console.log(`  ${k}  item ${(v as any).itemId}  (${(v as any).label})`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
