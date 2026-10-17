/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A CP3 — Contract Sweep: detectors, dedupe, resolve, severity,
// buckets, change detection, brief, and tenant isolation. No model calls:
// detection is deterministic by design.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-sweep.test.ts

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { buildTodayBrief } from "../../src/lib/officer/brief";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import {
  acknowledgeObservation, getObservation, listObservations, markReviewed,
} from "../../src/lib/officer/observations";
import { runContractSweep } from "../../src/lib/officer/sweep";
import { addDays, localDate } from "../../src/lib/officer/time";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** A tenant with one contract and a set of purpose-built obligations. */
async function makeTenant(label: string, timezone: string) {
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } }) as any;
  const email = `qa-sweep-${label}-${Date.now()}@vazora.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Qa!${crypto.randomUUID()}` });
  if (error || !data.user || !data.session) throw new Error(`${label} signUp: ${error?.message ?? "no session"}`);
  const userId = data.user.id as string;
  const orgId = crypto.randomUUID();
  const seed = async (table: string, row: Record<string, unknown>) => {
    const { error: e } = await client.from(table).insert(row);
    if (e) throw new Error(`${label} seed ${table}: ${e.message}`);
  };
  await seed("organizations", {
    id: orgId, name: `QA Sweep ${label}`, slug: `qa-sweep-${label}-${Date.now()}`,
    created_by: userId, timezone, timezone_set_at: new Date().toISOString(),
  });
  await seed("organization_members", { organization_id: orgId, user_id: userId, role: "owner" });
  return { client, userId, orgId, seed, timezone };
}

async function main() {
  const tz = "Asia/Riyadh";
  const A = await makeTenant("alpha", tz);
  const B = await makeTenant("beta", "Europe/London");
  const today = localDate(new Date(), tz);

  const contractId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const ingestionId = crypto.randomUUID();
  await A.seed("contracts", {
    id: contractId, organization_id: A.orgId, contract_number: "SW-001", title: "Sweep test contract",
    status: "active", end_date: addDays(today, 20),   // J: expiry approaching
  });
  await A.seed("contract_documents", { id: docId, organization_id: A.orgId, contract_id: contractId, file_name: "c.pdf", storage_path: `${A.orgId}/docs/c-${Date.now()}.pdf`, mime_type: "application/pdf", file_size: 100 });
  await A.seed("contract_ingestion_runs", { id: ingestionId, organization_id: A.orgId, contract_id: contractId, status: "approved", parser_version: "qa", extractor_version: "qa" });

  /** Create an approved+active obligation with a traceable source clause. */
  async function obligation(cfg: {
    title: string; due: string | null; extras?: Record<string, unknown>;
    assignOwner?: boolean;
  }) {
    const clauseId = crypto.randomUUID();
    const obligationId = crypto.randomUUID();
    await A.seed("contract_clauses", { id: clauseId, organization_id: A.orgId, contract_id: contractId, ingestion_run_id: ingestionId, document_id: docId, clause_number: "9.1", heading: cfg.title, text: `${cfg.title} clause text`, page_number: 2 });
    await A.seed("contract_obligations", {
      id: obligationId, organization_id: A.orgId, contract_id: contractId, ingestion_run_id: ingestionId,
      title: cfg.title, requirement_text: `${cfg.title} requirement`,
      due_date_normalized: cfg.due, due_rule_raw: "monthly by the fifth", ...(cfg.extras ?? {}),
    });
    await A.seed("obligation_source_refs", { organization_id: A.orgId, obligation_id: obligationId, document_id: docId, clause_id: clauseId, page_number: 2, source_snippet: "clause text" });
    const { error } = await A.client.from("contract_obligations")
      .update({ review_status: "approved", activation_status: "active" }).eq("id", obligationId);
    if (error) throw new Error(`activate: ${error.message}`);
    if (cfg.assignOwner !== false) {
      await A.seed("obligation_assignment_suggestions", {
        organization_id: A.orgId, obligation_id: obligationId, suggestion_kind: "owner",
        suggested_role: "Contract Manager", suggested_person_id: A.userId, confidence: "high",
        approved: true, decided_by: A.userId, decided_at: new Date().toISOString(),
      });
    }
    return { obligationId, clauseId };
  }

  /** Requirement + optional verified/missing evidence state. */
  async function requirement(obligationId: string, name: string, state: "verified" | "missing" | "none" | "partial") {
    const reqId = crypto.randomUUID();
    await A.seed("obligation_evidence_requirements", {
      id: reqId, organization_id: A.orgId, obligation_id: obligationId, name,
      evidence_type: /acknowledg/i.test(name) ? "acknowledgement" : "report", required: true,
    });
    if (state === "none") return { reqId, itemId: null, versionId: null, runId: null, checkId: null };

    const itemId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const checkId = crypto.randomUUID();
    await A.seed("evidence_items", { id: itemId, organization_id: A.orgId, contract_id: contractId, obligation_id: obligationId, title: `${name} item`, status: "partially_verified" });
    await A.seed("evidence_versions", { id: versionId, organization_id: A.orgId, evidence_item_id: itemId, version_number: 1, file_name: "e.csv", storage_path: `${A.orgId}/${itemId}/v1-${Date.now()}.csv`, mime_type: "text/csv", file_size: 10, file_hash: `sw-${crypto.randomUUID()}`, uploaded_by: A.userId });
    await A.seed("evidence_requirement_links", { evidence_item_id: itemId, evidence_requirement_id: reqId, organization_id: A.orgId });
    await A.seed("evidence_verification_runs", { id: runId, organization_id: A.orgId, contract_id: contractId, obligation_id: obligationId, evidence_item_id: itemId, evidence_version_id: versionId, status: "completed", overall_result: state === "verified" ? "verified" : "partially_verified", verifier_provider: "qa", verifier_model: "qa", completed_at: new Date().toISOString() });
    await A.seed("evidence_verification_checks", {
      id: checkId, organization_id: A.orgId, verification_run_id: runId, evidence_requirement_id: reqId,
      check_label: name, result: state === "verified" ? "verified" : state === "partial" ? "partial" : "missing",
      ...(state !== "missing" ? { source_excerpt: "excerpt", source_location: "r1" } : {}),
      provider: "qa", model: "qa",
    });
    if (state !== "verified") {
      await A.seed("evidence_gaps", { organization_id: A.orgId, contract_id: contractId, obligation_id: obligationId, evidence_requirement_id: reqId, verification_run_id: runId, gap_type: state === "partial" ? "partial_evidence" : "missing_evidence", status: "open", description: `${name} incomplete` });
    }
    return { reqId, itemId, versionId, runId, checkId };
  }

  // ---- scenarios ----------------------------------------------------------
  const scA = await obligation({ title: "A due tomorrow evidence missing", due: addDays(today, 1) });
  await requirement(scA.obligationId, "A report", "missing");

  const scB = await obligation({ title: "B due in 5 days evidence complete", due: addDays(today, 5) });
  await requirement(scB.obligationId, "B report", "verified");

  const scC = await obligation({ title: "C overdue by 6 days", due: addDays(today, -6) });
  await requirement(scC.obligationId, "C report", "missing");

  const scD = await obligation({ title: "D unassigned", due: addDays(today, 10), assignOwner: false, extras: { owner_role_suggested: "Project Manager" } });
  await requirement(scD.obligationId, "D report", "verified");

  const scE = await obligation({
    title: "E external acknowledgement pending", due: addDays(today, 2),
    extras: { requires_external_acknowledgement: true, external_dependency: "Client PMO" },
  });
  await requirement(scE.obligationId, "E client acknowledgement", "missing");

  const scF = await obligation({ title: "F discrepancy pending", due: addDays(today, 9) });
  const fReq = await requirement(scF.obligationId, "F signed report", "verified");
  // same-version weaker rerun → pending discrepancy, operational stays verified
  const fRun2 = crypto.randomUUID();
  const fCheck2 = crypto.randomUUID();
  await A.seed("evidence_verification_runs", { id: fRun2, organization_id: A.orgId, contract_id: contractId, obligation_id: scF.obligationId, evidence_item_id: fReq.itemId, evidence_version_id: fReq.versionId, status: "completed", overall_result: "needs_review", verifier_provider: "qa", verifier_model: "qa", completed_at: new Date().toISOString() });
  await A.seed("evidence_verification_checks", { id: fCheck2, organization_id: A.orgId, verification_run_id: fRun2, evidence_requirement_id: fReq.reqId, check_label: "F signed report", result: "needs_human_review", reason: "could not re-confirm", provider: "qa", model: "qa" });
  await A.seed("evidence_verification_discrepancies", { organization_id: A.orgId, evidence_item_id: fReq.itemId, evidence_version_id: fReq.versionId, evidence_requirement_id: fReq.reqId, prior_check_id: fReq.checkId, current_check_id: fCheck2, prior_run_id: fReq.runId, current_run_id: fRun2, prior_result: "verified", current_result: "needs_human_review", provider: "qa", model: "qa", status: "pending" });

  const scK = await obligation({ title: "K healthy", due: addDays(today, 30) });
  await requirement(scK.obligationId, "K report", "verified");

  // I: an internal action awaiting approval
  await A.seed("officer_actions", {
    organization_id: A.orgId, contract_id: contractId, action_type: "officer.request_evidence_internal",
    arguments: { summary: "Request A report" }, reason: "A report is not recorded", requires_approval: true,
    status: "waiting_for_approval", risk_level: "medium",
  });

  await ensureOfficerProfile({ supabase: A.client, organizationId: A.orgId });
  const ctx = await buildOfficerContext({ supabase: A.client, organizationId: A.orgId, userId: A.userId, locale: "en" });
  const betaCtx = await buildOfficerContext({ supabase: B.client, organizationId: B.orgId, userId: B.userId, locale: "en" });
  if (!ctx || !betaCtx) throw new Error("context build failed");
  check("clock-uses-org-timezone", ctx.clock.timeZone === tz && ctx.clock.today === today, `${ctx.clock.timeZone} ${ctx.clock.today}`);

  // ===== first sweep =======================================================
  const sweep1 = await runContractSweep({ ctx, trigger: "manual" });
  check("sweep1-ok", sweep1.ok && sweep1.status === "completed", JSON.stringify({ ...sweep1, failures: sweep1.failures }));
  check("sweep1-created", sweep1.created > 0 && sweep1.updated === 0, `created=${sweep1.created} updated=${sweep1.updated}`);

  const obs1 = await listObservations(ctx);
  const byKind = (kind: string) => obs1.filter((o) => o.kind === kind);
  const forOb = (obligationId: string) => obs1.filter((o) => o.obligationId === obligationId);

  // A — due tomorrow + evidence missing
  const a = forOb(scA.obligationId);
  check("A-due-soon-detected",
    a.some((o) => o.kind === "due_soon" && o.severity === "high" && o.timeBucket === "next_3_days"),
    JSON.stringify(a.map((o) => [o.kind, o.severity, o.timeBucket])));
  check("A-missing-evidence-detected",
    a.some((o) => o.kind === "missing_required_evidence" && o.citations.some((c) => c.target === "evidence_requirement")),
    JSON.stringify(a.map((o) => o.kind)));
  check("A-has-clause-citation",
    a.some((o) => o.citations.some((c) => c.target === "clause")),
    "traceable to the contract");
  check("A-recommends-action",
    a.some((o) => o.recommendedActionType === "officer.request_evidence_internal"));
  check("A-facts-deterministic",
    a.some((o) => (o.supportingFacts as any).days_until_due === 1),
    JSON.stringify(a.map((o) => o.supportingFacts)));

  // B — due in 5 days, evidence complete: NOT an issue
  check("B-no-noise", forOb(scB.obligationId).length === 0,
    JSON.stringify(forOb(scB.obligationId).map((o) => o.kind)));

  // C — overdue 6 days with missing evidence → critical
  const c = forOb(scC.obligationId);
  check("C-overdue-critical",
    c.some((o) => o.kind === "overdue" && o.severity === "critical" && o.timeBucket === "critical"),
    JSON.stringify(c.map((o) => [o.kind, o.severity])));
  check("C-days-overdue-exact",
    c.some((o) => (o.supportingFacts as any).days_overdue === 6),
    JSON.stringify(c.map((o) => o.supportingFacts)));

  // D — unassigned, with suggested role but no auto-assignment
  const d = forOb(scD.obligationId);
  check("D-unassigned-detected", d.some((o) => o.kind === "unassigned_obligation"));
  check("D-suggested-role-shown",
    d.some((o) => (o.supportingFacts as any).suggested_role === "Project Manager"));
  check("D-assignment-needs-approval",
    d.some((o) => o.recommendedActionType === "obligation.assign_owner"));

  // E — external dependency, not internal failure
  const e = forOb(scE.obligationId);
  check("E-external-dependency",
    e.some((o) => o.kind === "external_dependency_pending"),
    JSON.stringify(e.map((o) => o.kind)));
  check("E-not-blamed-internally",
    e.every((o) => o.kind !== "missing_required_evidence") &&
    e.some((o) => /external/i.test(o.detail ?? "")),
    JSON.stringify(e.map((o) => o.detail?.slice(0, 60))));

  // F — pending discrepancy: review need, NOT "evidence missing"
  const f = forOb(scF.obligationId);
  check("F-discrepancy-detected", f.some((o) => o.kind === "verification_discrepancy"));
  check("F-not-called-missing",
    f.every((o) => o.kind !== "missing_required_evidence" && o.kind !== "due_soon"),
    JSON.stringify(f.map((o) => o.kind)));
  check("F-operational-still-verified",
    f.some((o) => (o.supportingFacts as any).operational_status === "verified"),
    JSON.stringify(f.map((o) => o.supportingFacts)));
  check("F-cites-discrepancy",
    f.some((o) => o.citations.some((ci) => ci.target === "verification_discrepancy")));

  // I — approval waiting
  check("I-approval-waiting", byKind("action_waiting_for_approval").length === 1);

  // J — contract expiry
  check("J-expiry-detected", byKind("contract_expiry_approaching").length === 1,
    JSON.stringify(byKind("contract_expiry_approaching").map((o) => o.supportingFacts)));

  // K — healthy obligation produces nothing
  check("K-healthy-silent", forOb(scK.obligationId).length === 0,
    JSON.stringify(forOb(scK.obligationId).map((o) => o.kind)));

  // No observation may exist without a source.
  check("all-observations-cited",
    obs1.filter((o) => o.kind !== "action_waiting_for_approval").every((o) => o.citations.length > 0),
    `uncited=${obs1.filter((o) => o.citations.length === 0).map((o) => o.kind).join(",")}`);
  // Conservative money language: no amount may appear anywhere.
  check("no-invented-financial-exposure",
    obs1.every((o) => !/SAR\s?\d|\d{3,}\s?(riyal|SAR)/i.test(`${o.title} ${o.detail ?? ""} ${JSON.stringify(o.supportingFacts)}`)),
    "no amounts invented");

  // ===== second sweep, unchanged state: NO duplicates ======================
  const before = obs1.length;
  const sweep2 = await runContractSweep({ ctx, trigger: "scheduled" });
  const obs2 = await listObservations(ctx);
  check("sweep2-no-duplicates", obs2.length === before && sweep2.created === 0 && sweep2.updated > 0,
    `before=${before} after=${obs2.length} created=${sweep2.created} updated=${sweep2.updated}`);
  const firstSeenStable = obs1.every((o) => {
    const again = obs2.find((x) => x.id === o.id);
    return again && again.firstDetectedAt === o.firstDetectedAt;
  });
  check("sweep2-first-detected-stable", firstSeenStable);
  check("sweep2-last-seen-advanced",
    obs2.some((o) => {
      const prev = obs1.find((x) => x.id === o.id);
      return prev && Date.parse(o.lastSeenAt) >= Date.parse(prev.lastSeenAt);
    }));

  // ===== state changes: the condition resolves =============================
  // Supply verified evidence for A's requirement → its missing-evidence and
  // due_soon observations must resolve.
  const aObs = forOb(scA.obligationId);
  const aMissing = aObs.find((o) => o.kind === "missing_required_evidence");
  const aReqId = aMissing?.evidenceRequirementId;
  if (!aReqId) throw new Error("A requirement id missing from observation");
  const { data: aCheck } = await A.client.from("evidence_verification_checks")
    .select("id").eq("organization_id", A.orgId).eq("evidence_requirement_id", aReqId).limit(1).maybeSingle();
  await A.client.from("evidence_verification_checks")
    .update({ result: "verified", source_excerpt: "now present", source_location: "r2" })
    .eq("id", aCheck!.id);
  await A.client.from("evidence_gaps")
    .update({ status: "resolved", closed_by_verification_run_id: aMissing ? null : null })
    .eq("organization_id", A.orgId).eq("evidence_requirement_id", aReqId);

  const sweep3 = await runContractSweep({ ctx, trigger: "manual" });
  check("sweep3-resolved-something", sweep3.resolved >= 2, `resolved=${sweep3.resolved}`);
  const aAfter = await getObservation(ctx, aMissing!.id);
  check("resolved-not-deleted", !!aAfter && aAfter.status === "resolved" && !!aAfter.resolvedAt,
    `status=${aAfter?.status}`);
  check("resolved-history-preserved", !!aAfter && aAfter.firstDetectedAt === aMissing!.firstDetectedAt);
  const stillOpen = await listObservations(ctx);
  check("resolved-leaves-active-set", !stillOpen.some((o) => o.id === aMissing!.id));

  // ===== reopen preserves history =========================================
  await A.client.from("evidence_verification_checks")
    .update({ result: "missing", source_excerpt: null, source_location: null })
    .eq("id", aCheck!.id);
  const sweep4 = await runContractSweep({ ctx, trigger: "manual" });
  check("sweep4-reopened", sweep4.created >= 1, `created=${sweep4.created}`);
  const { data: reopenedRows } = await A.client.from("officer_observations")
    .select("first_detected_at, reopen_count, reopened_at, status")
    .eq("organization_id", A.orgId).eq("dedupe_key", aMissing!.dedupeKey)
    .order("created_at", { ascending: false }).limit(1);
  const reopened = (reopenedRows ?? [])[0];
  check("reopen-keeps-first-detected",
    !!reopened && reopened.first_detected_at === aMissing!.firstDetectedAt && reopened.reopen_count === 1,
    JSON.stringify(reopened));

  // ===== acknowledge ======================================================
  const ackTarget = (await listObservations(ctx)).find((o) => o.status === "active")!;
  const ack = await acknowledgeObservation(ctx, ackTarget.id);
  check("acknowledge-works", ack.ok, JSON.stringify(ack));
  const ackAgain = await acknowledgeObservation(ctx, ackTarget.id);
  check("acknowledge-idempotent-guard", !ackAgain.ok, JSON.stringify(ackAgain));
  const ackedRow = await getObservation(ctx, ackTarget.id);
  check("acknowledge-does-not-resolve", ackedRow?.status === "acknowledged" && !ackedRow?.resolvedAt);

  // ===== Today Brief ======================================================
  const brief = await buildTodayBrief(ctx);
  check("brief-deterministic-counts",
    brief.approvalsWaiting === 1 && brief.counts.critical >= 1 && brief.asOfDate === today,
    JSON.stringify({ approvals: brief.approvalsWaiting, counts: brief.counts, asOf: brief.asOfDate }));
  check("brief-has-priorities", brief.highestPriorityItems.length > 0 &&
    brief.highestPriorityItems.every((i) => i.citations.length > 0 || i.kind === "action_waiting_for_approval"),
    `items=${brief.highestPriorityItems.length}`);
  check("brief-not-quiet", brief.quiet === false);
  check("brief-severity-ordered",
    brief.highestPriorityItems[0].severity === "critical" || brief.highestPriorityItems[0].severity === "high",
    brief.highestPriorityItems[0].severity);

  // change detection against a real watermark
  await markReviewed(ctx);
  const briefAfterReview = await buildTodayBrief(ctx);
  check("brief-since-last-review", briefAfterReview.sinceKind === "last_review" && !!briefAfterReview.since);
  check("brief-no-invented-changes",
    briefAfterReview.changes.every((c) => !!c.eventType && !!c.at),
    `changes=${briefAfterReview.changes.length}`);
  check("brief-new-issues-reset", briefAfterReview.newIssues === 0,
    `newIssues=${briefAfterReview.newIssues} (nothing new since the watermark)`);

  // ===== tenant isolation =================================================
  const betaSees = await listObservations(betaCtx);
  check("iso-beta-sees-nothing", betaSees.length === 0, `rows=${betaSees.length}`);
  const betaGet = await getObservation(betaCtx, ackTarget.id);
  check("iso-beta-cannot-read-one", betaGet === null);
  const betaAck = await acknowledgeObservation(betaCtx, ackTarget.id);
  check("iso-beta-cannot-acknowledge", !betaAck.ok, JSON.stringify(betaAck));
  await B.client.from("officer_observations").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", ackTarget.id);
  const afterAttack = await getObservation(ctx, ackTarget.id);
  check("iso-beta-cannot-resolve", afterAttack?.status === "acknowledged", `status=${afterAttack?.status}`);
  const betaSweep = await runContractSweep({ ctx: betaCtx, trigger: "manual" });
  check("iso-beta-sweep-empty", betaSweep.contractsTotal === 0 && betaSweep.created === 0,
    JSON.stringify(betaSweep));
  const betaBrief = await buildTodayBrief(betaCtx);
  check("iso-beta-brief-quiet", betaBrief.quiet === true && betaBrief.highestPriorityItems.length === 0);

  // ===== sweep run bookkeeping ============================================
  const { data: runs } = await A.client.from("officer_sweep_runs")
    .select("status, contracts_total, contracts_done, observations_created, observations_resolved, as_of_date, timezone, trigger")
    .eq("organization_id", A.orgId).order("started_at", { ascending: true });
  check("sweep-runs-recorded", (runs ?? []).length === 4 && (runs ?? []).every((r: any) => r.status === "completed"),
    JSON.stringify((runs ?? []).map((r: any) => r.status)));
  check("sweep-run-records-clock",
    (runs ?? []).every((r: any) => r.as_of_date === today && r.timezone === tz));
  check("sweep-trigger-recorded",
    (runs ?? []).some((r: any) => r.trigger === "scheduled") && (runs ?? []).some((r: any) => r.trigger === "manual"));

  const { data: events } = await A.client.from("activity_log")
    .select("event_type").eq("organization_id", A.orgId);
  const types = new Set((events ?? []).map((e: any) => e.event_type));
  check("audit-events-logged",
    ["officer.sweep_started", "officer.sweep_completed", "officer.observation_created",
     "officer.observation_resolved", "officer.observation_acknowledged"].every((t) => types.has(t)),
    [...types].filter((t) => String(t).startsWith("officer.")).join(","));

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nOFFICER SWEEP: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
