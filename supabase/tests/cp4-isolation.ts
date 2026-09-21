/* eslint-disable @typescript-eslint/no-explicit-any */
// Checkpoint 4 §14 — live tenant-isolation regression.
// Two real tenants (Alpha/Beta) on separate user-JWT clients — exactly the
// production attack surface (the app never uses a service role). Alpha
// attempts every cross-tenant operation; each must fail or see zero rows.

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function makeTenant(label: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as any;
  const email = `qa-iso-${label}-${Date.now()}@vazora.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Qa!${crypto.randomUUID()}` });
  if (error || !data.user || !data.session) throw new Error(`${label} signUp: ${error?.message ?? "no session"}`);
  const orgId = crypto.randomUUID();
  const { error: oe } = await client.from("organizations").insert({ id: orgId, name: `QA ${label}`, slug: `qa-${label}-${Date.now()}`, created_by: data.user.id });
  if (oe) throw new Error(`${label} org: ${oe.message}`);
  const { error: me } = await client.from("organization_members").insert({ organization_id: orgId, user_id: data.user.id, role: "owner" });
  if (me) throw new Error(`${label} member: ${me.message}`);
  return { client, userId: data.user.id, orgId };
}

async function main() {
  const alpha = await makeTenant("alpha");
  const beta = await makeTenant("beta");
  const A = alpha.client;
  const B = beta.client;

  // ---------- Beta seeds a full evidence chain ----------
  const contractId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const ingestionId = crypto.randomUUID();
  const obligationId = crypto.randomUUID();
  const requirementId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  const gapId = crypto.randomUUID();
  const storagePath = `${beta.orgId}/${itemId}/v1-beta-secret.csv`;

  const seed = async (table: string, row: Record<string, unknown>) => {
    const { error } = await B.from(table).insert(row);
    if (error) throw new Error(`beta seed ${table}: ${error.message}`);
  };

  await seed("contracts", { id: contractId, organization_id: beta.orgId, contract_number: "B-ISO-1", title: "Beta contract" });
  await seed("contract_documents", { id: docId, organization_id: beta.orgId, contract_id: contractId, file_name: "b.pdf", storage_path: `${beta.orgId}/docs/b.pdf`, mime_type: "application/pdf", file_size: 10 });
  await seed("contract_ingestion_runs", { id: ingestionId, organization_id: beta.orgId, contract_id: contractId, status: "approved", parser_version: "t", extractor_version: "t" });
  await seed("contract_obligations", { id: obligationId, organization_id: beta.orgId, contract_id: contractId, ingestion_run_id: ingestionId, title: "Beta obligation", requirement_text: "beta req", review_status: "approved" });
  await seed("obligation_evidence_requirements", { id: requirementId, organization_id: beta.orgId, obligation_id: obligationId, name: "Beta report", evidence_type: "report", required: true });
  await seed("evidence_items", { id: itemId, organization_id: beta.orgId, contract_id: contractId, title: "Beta evidence", status: "received" });
  await seed("evidence_versions", { id: versionId, organization_id: beta.orgId, evidence_item_id: itemId, version_number: 1, file_name: "beta-secret.csv", storage_path: storagePath, mime_type: "text/csv", file_size: 24, file_hash: "isotest-beta", uploaded_by: beta.userId });
  await seed("evidence_requirement_links", { evidence_item_id: itemId, evidence_requirement_id: requirementId, organization_id: beta.orgId });
  await seed("evidence_verification_runs", { id: runId, organization_id: beta.orgId, contract_id: contractId, obligation_id: obligationId, evidence_item_id: itemId, evidence_version_id: versionId, status: "completed", verifier_provider: "iso-test", verifier_model: "iso-test" });
  await seed("evidence_verification_checks", { id: checkId, organization_id: beta.orgId, verification_run_id: runId, evidence_requirement_id: requirementId, check_label: "Beta check", result: "verified", source_excerpt: "beta excerpt", source_location: "p1" });
  await seed("evidence_gaps", { id: gapId, organization_id: beta.orgId, contract_id: contractId, obligation_id: obligationId, evidence_requirement_id: requirementId, verification_run_id: runId, status: "open", description: "beta gap" });

  const { error: upErr } = await B.storage.from("contract-evidence").upload(storagePath, new Blob(["kpi,value\n1,2\n"], { type: "text/csv" }), { contentType: "text/csv" });
  if (upErr) throw new Error(`beta storage seed: ${upErr.message}`);
  console.log(`beta seeded — org ${beta.orgId.slice(0, 8)} · item ${itemId.slice(0, 8)}`);

  // ---------- READ attacks: every read must see zero Beta rows ----------
  const readAttacks: [string, string, Record<string, string>][] = [
    ["items", "evidence_items", { id: itemId }],
    ["versions", "evidence_versions", { evidence_item_id: itemId }],
    ["links", "evidence_requirement_links", { evidence_item_id: itemId }],
    ["runs", "evidence_verification_runs", { evidence_version_id: versionId }],
    ["checks", "evidence_verification_checks", { verification_run_id: runId }],
    ["gaps", "evidence_gaps", { id: gapId }],
    ["requirements", "obligation_evidence_requirements", { id: requirementId }],
    ["obligations", "contract_obligations", { id: obligationId }],
    ["contracts", "contracts", { id: contractId }],
  ];
  for (const [label, table, filter] of readAttacks) {
    let q = A.from(table).select("*");
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { data, error } = await q;
    check(`read-beta-${label}`, !error && (data?.length ?? 0) === 0,
      error ? `error=${error.message}` : `rows=${data?.length ?? 0}`);
  }

  // ---------- STORAGE attacks ----------
  {
    const { data, error } = await A.storage.from("contract-evidence").download(storagePath);
    check("download-beta-file", !!error, error ? `denied: ${error.message.slice(0, 60)}` : `leaked ${data?.size ?? 0}B`);
  }
  {
    const { data, error } = await A.storage.from("contract-evidence").createSignedUrl(storagePath, 60);
    const leaked = data?.signedUrl && !error;
    check("signedurl-beta-file", !leaked, leaked ? "SIGNED URL ISSUED" : `denied: ${(error?.message ?? "no url").slice(0, 60)}`);
  }
  {
    const { data: removed } = await A.storage.from("contract-evidence").remove([storagePath]);
    const { data: still } = await B.storage.from("contract-evidence").download(storagePath);
    check("delete-beta-file", !!still && (removed?.length ?? 0) === 0, `removed=${removed?.length ?? 0} file intact=${!!still}`);
  }

  // ---------- WRITE attacks ----------
  let alphaItem = "";
  const alphaContractId = crypto.randomUUID();
  const { error: cErr } = await A.from("contracts").insert({ id: alphaContractId, organization_id: alpha.orgId, contract_number: "A-ISO-1", title: "Alpha contract" });
  if (cErr) throw new Error(`alpha contract seed: ${cErr.message}`);
  {
    const { error } = await A.from("evidence_verification_runs").insert({
      organization_id: beta.orgId, contract_id: contractId, obligation_id: obligationId, evidence_item_id: itemId, evidence_version_id: versionId, status: "completed", verifier_provider: "x", verifier_model: "x",
    });
    check("verify-beta-evidence", !!error, error ? `denied: ${error.message.slice(0, 60)}` : "INSERT ACCEPTED");
  }
  {
    const { error } = await A.from("evidence_verification_checks")
      .update({ human_result: "verified", human_reason: "spoofed", overridden_by: alpha.userId, overridden_at: new Date().toISOString() })
      .eq("id", checkId);
    const { data: after } = await B.from("evidence_verification_checks").select("human_result").eq("id", checkId).single();
    check("override-beta-check", !!error || !after?.human_result, error ? `denied: ${error.message.slice(0, 50)}` : `human_result=${after?.human_result}`);
  }
  {
    const { error } = await A.from("evidence_gaps").update({ status: "resolved" }).eq("id", gapId);
    const { data: after } = await B.from("evidence_gaps").select("status").eq("id", gapId).single();
    check("resolve-beta-gap", after?.status === "open", `gap status=${after?.status}${error ? ` (err: ${error.message.slice(0, 40)})` : ""}`);
  }
  {
    // Cross-link: bind Alpha's OWN item to BETA's requirement — the dangerous one.
    const alphaItemId = crypto.randomUUID();
    const { error: itemErr } = await A.from("evidence_items").insert({ id: alphaItemId, organization_id: alpha.orgId, contract_id: alphaContractId, title: "Alpha item", status: "received" });
    if (itemErr) throw new Error(`alpha item seed: ${itemErr.message}`);
    const { error } = await A.from("evidence_requirement_links").insert({ evidence_item_id: alphaItemId, evidence_requirement_id: requirementId, organization_id: alpha.orgId });
    check("crosslink-beta-requirement", !!error, error ? `denied: ${error.message.slice(0, 60)}` : "CROSS-LINK ACCEPTED");
    alphaItem = alphaItemId;
  }
  {
    const { error } = await A.from("evidence_items").delete().eq("id", itemId);
    const { data: still } = await B.from("evidence_items").select("id").eq("id", itemId);
    check("delete-beta-item", (still?.length ?? 0) === 1, `beta item rows=${still?.length ?? 0}${error ? ` (err)` : ""}`);
  }

  // ---------- Positive controls: same-tenant ops still work ----------
  const { data: ownItems } = await A.from("evidence_items").select("id").eq("id", alphaItem);
  check("alpha-read-own", (ownItems?.length ?? 0) === 1, `rows=${ownItems?.length}`);

  const alphaPath = `${alpha.orgId}/${alphaItem}/v1-a.csv`;
  const { error: aUpErr } = await A.storage.from("contract-evidence").upload(alphaPath, new Blob(["a,b\n"], { type: "text/csv" }), { contentType: "text/csv" });
  check("alpha-upload-own", !aUpErr, aUpErr?.message ?? "uploaded");
  const { data: aUrl } = await A.storage.from("contract-evidence").createSignedUrl(alphaPath, 60);
  check("alpha-signedurl-own", !!aUrl?.signedUrl, aUrl?.signedUrl ? "issued" : "FAILED");
  const { data: aDl } = await A.storage.from("contract-evidence").download(alphaPath);
  check("alpha-download-own", !!aDl && aDl.size === 4, `size=${aDl?.size}`);
  const alphaVersionId = crypto.randomUUID();
  const { error: aVerErr } = await A.from("evidence_versions").insert({
    id: alphaVersionId, organization_id: alpha.orgId, evidence_item_id: alphaItem,
    version_number: 1, file_name: "a.csv", storage_path: alphaPath, mime_type: "text/csv", file_size: 4, file_hash: "isotest-alpha", uploaded_by: alpha.userId,
  });
  if (aVerErr) throw new Error(`alpha version seed: ${aVerErr.message}`);
  const { error: aRunErr } = await A.from("evidence_verification_runs").insert({
    organization_id: alpha.orgId, contract_id: alphaContractId, evidence_item_id: alphaItem, evidence_version_id: alphaVersionId, status: "failed", verifier_provider: "t", verifier_model: "t", error_code: "no_provider",
  });
  check("alpha-write-own-run", !aRunErr, aRunErr ? `${aRunErr.code}: ${aRunErr.message.slice(0, 50)}` : "inserted");

  const pass = checks.filter((c) => c.pass).length;
  console.log(`\nISOLATION: ${pass}/${checks.length} PASS`);
  if (pass !== checks.length) {
    console.log("BREACHES:", checks.filter((c) => !c.pass).map((c) => c.name).join(", "));
    process.exit(1);
  }
}

main().catch((e) => { console.error("isolation harness failed:", e); process.exit(2); });
