import "server-only";

import { extractEvidenceText } from "@/lib/evidence/deterministic";
import { applyVerificationOutput, planUnreadable, type Criterion, type VerificationPlan } from "@/lib/evidence/engine";
import { getVerificationProvider, verifyValidated } from "@/lib/evidence/verifier";

// Side-effect: registers verification provider factories.
import "@/lib/evidence/providers/anthropic";
import "@/lib/evidence/providers/openai-compat";

type SupabaseLike = Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServer>>;

const BUCKET = "contract-evidence";

/**
 * Is a verification provider configured? Call sites use this to decide
 * whether upload-time re-verification can run — no provider means the item
 * honestly stays "received" with gaps untouched (no fake run is created).
 */
export function verificationProviderConfigured(): boolean {
  return getVerificationProvider() !== null;
}

export type VerificationRunOutcome =
  | { ok: true; runId: string; overall: VerificationPlan["overall"] }
  | { ok: false; runId: string | null; error: string };

/**
 * Run one verification attempt against an evidence version.
 *
 * Immutable history: every call inserts a NEW evidence_verification_runs row —
 * prior runs are never touched. Gap reconciliation is idempotent: unproven
 * criteria reuse the existing active gap for that requirement (updated, not
 * duplicated); proven criteria resolve their gaps via closed_by_verification_run_id.
 *
 * UPLOADED ≠ VERIFIED is enforced by the DB gate — this function is the ONLY
 * application path that can set a gap to resolved.
 */
export async function runEvidenceVerification(opts: {
  supabase: SupabaseLike;
  organizationId: string;
  evidenceItemId: string;
  evidenceVersionId?: string;
  userId: string;
}): Promise<VerificationRunOutcome> {
  const { supabase, organizationId, evidenceItemId, userId } = opts;

  // 1. Load item, target version, linked criteria, contract context.
  const { data: item } = await supabase
    .from("evidence_items")
    .select("id, contract_id, obligation_id, title, status")
    .eq("id", evidenceItemId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!item) return { ok: false, runId: null, error: "forbidden" };

  let versionQuery = supabase
    .from("evidence_versions")
    .select("id, file_name, storage_path, mime_type, version_number")
    .eq("evidence_item_id", evidenceItemId)
    .eq("organization_id", organizationId)
    .order("version_number", { ascending: false })
    .limit(1);
  if (opts.evidenceVersionId) versionQuery = versionQuery.eq("id", opts.evidenceVersionId);
  const { data: version } = await versionQuery.maybeSingle();
  if (!version) return { ok: false, runId: null, error: "no_version" };

  const { data: linkRows } = await supabase
    .from("evidence_requirement_links")
    .select("evidence_requirement_id")
    .eq("evidence_item_id", evidenceItemId)
    .eq("organization_id", organizationId);
  const reqIds = [...new Set((linkRows ?? []).map((l) => l.evidence_requirement_id as string))];
  if (!reqIds.length) return { ok: false, runId: null, error: "no_linked_requirements" };

  const { data: reqRows } = await supabase
    .from("obligation_evidence_requirements")
    .select("id, obligation_id, name, description, evidence_type, required")
    .eq("organization_id", organizationId)
    .in("id", reqIds);
  const criteria: Criterion[] = (reqRows ?? []).map((r) => ({
    requirementId: r.id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    evidenceType: r.evidence_type as string,
    required: (r.required as boolean) ?? true,
    obligationId: (r.obligation_id as string | null) ?? null,
  }));
  if (!criteria.length) return { ok: false, runId: null, error: "no_linked_requirements" };

  const { data: contract } = await supabase
    .from("contracts")
    .select("title")
    .eq("id", item.contract_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const obligationIds = [...new Set(criteria.map((c) => c.obligationId).filter((x): x is string => !!x))];
  const { data: obligationRows } = obligationIds.length
    ? await supabase
        .from("contract_obligations")
        .select("id, title")
        .eq("organization_id", organizationId)
        .in("id", obligationIds)
    : { data: [] as { id: string; title: string }[] };
  const obligationTitles = Object.fromEntries((obligationRows ?? []).map((o) => [o.id as string, o.title as string]));

  // Re-verification = a prior run already exists for this item.
  const { count: priorRuns } = await supabase
    .from("evidence_verification_runs")
    .select("id", { count: "exact", head: true })
    .eq("evidence_item_id", evidenceItemId)
    .eq("organization_id", organizationId);
  const isReverification = (priorRuns ?? 0) > 0;

  const provider = getVerificationProvider();

  // 2. Create the run row — immutable history, one row per attempt.
  const { data: runRow, error: runErr } = await supabase
    .from("evidence_verification_runs")
    .insert({
      organization_id: organizationId,
      contract_id: item.contract_id,
      obligation_id: item.obligation_id,
      evidence_item_id: evidenceItemId,
      evidence_version_id: version.id,
      status: "running",
      verifier_provider: provider?.id ?? null,
      verifier_model: provider?.model ?? null,
      triggered_by: userId,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runErr || !runRow) return { ok: false, runId: null, error: `run_insert: ${runErr?.message ?? "none"}` };
  const runId = runRow.id as string;
  const t0 = Date.now();

  await supabase
    .from("evidence_items")
    .update({ status: "verification_pending" })
    .eq("id", evidenceItemId)
    .eq("organization_id", organizationId);

  // Gaps waiting on these requirements move to reverification_pending.
  await supabase
    .from("evidence_gaps")
    .update({ status: "reverification_pending" })
    .eq("organization_id", organizationId)
    .in("evidence_requirement_id", reqIds)
    .in("status", ["open", "evidence_received"]);

  await supabase.from("activity_log").insert({
    organization_id: organizationId,
    actor_user_id: userId,
    event_type: isReverification ? "evidence.reverification_started" : "evidence.verification_started",
    entity_type: "evidence_item",
    entity_id: evidenceItemId,
    metadata: { run_id: runId, version_id: version.id, criteria: criteria.length },
  });

  /** Fail the run cleanly: gaps return to open, item back to received. */
  const fail = async (code: string, message: string): Promise<VerificationRunOutcome> => {
    await supabase
      .from("evidence_verification_runs")
      .update({
        status: "failed",
        error_code: code,
        error_message: message.slice(0, 400),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
      })
      .eq("id", runId);
    await supabase
      .from("evidence_gaps")
      .update({ status: "open" })
      .eq("organization_id", organizationId)
      .in("evidence_requirement_id", reqIds)
      .eq("status", "reverification_pending");
    await supabase
      .from("evidence_items")
      .update({ status: "received" })
      .eq("id", evidenceItemId)
      .eq("organization_id", organizationId);
    return { ok: false, runId, error: `${code}: ${message}` };
  };

  try {
    // 3. Fetch bytes + extract text deterministically.
    const { data: fileData, error: dlErr } = await supabase.storage
      .from(BUCKET)
      .download(version.storage_path as string);
    if (dlErr || !fileData) return fail("storage_download", dlErr?.message ?? "cannot read file");

    const bytes = Buffer.from(await fileData.arrayBuffer());
    const extracted = await extractEvidenceText(
      version.file_name as string,
      version.mime_type as string,
      bytes,
    );

    // 4. Provider + engine plan.
    let plan: VerificationPlan;
    let usageIn: number | null = null;
    let usageOut: number | null = null;
    if (!extracted.ok) {
      plan = planUnreadable({
        criteria,
        reason: extracted.reason,
        fileName: version.file_name as string,
      });
    } else if (!provider) {
      return fail("no_provider", "VAZORA_VERIFICATION_PROVIDER not configured");
    } else {
      const result = await verifyValidated(provider, {
        organizationId,
        evidenceItemId,
        evidenceVersionId: version.id as string,
        fileName: version.file_name as string,
        documentText: extracted.text,
        pageOffsets: extracted.pageOffsets,
        criteria,
        context: { contractTitle: (contract?.title as string) ?? "", obligations: obligationTitles },
      });
      if (!result.ok) return fail("provider_error", result.error);
      usageIn = result.usage?.inputTokens ?? null;
      usageOut = result.usage?.outputTokens ?? null;
      plan = applyVerificationOutput({
        criteria,
        providerChecks: result.checks,
        evidenceText: extracted.text,
        pageOffsets: extracted.pageOffsets,
        provider: provider.id,
        model: result.model ?? provider.model,
      });
    }

    // 5. Persist per-criterion checks (append-only history).
    const checkInserts = plan.checks.map((c) => ({
      organization_id: organizationId,
      verification_run_id: runId,
      evidence_requirement_id: c.evidenceRequirementId,
      check_label: c.checkLabel,
      check_kind: c.checkKind,
      result: c.result,
      confidence: c.confidence,
      reason: c.reason,
      source_page: c.sourcePage,
      source_location: c.sourceLocation,
      source_excerpt: c.sourceExcerpt,
      provider: provider?.id ?? null,
      model: provider?.model ?? null,
    }));
    const { error: checkErr } = await supabase.from("evidence_verification_checks").insert(checkInserts);
    if (checkErr) return fail("check_insert", checkErr.message);

    // 6. Gap reconciliation — idempotent per requirement.
    const { data: activeGaps } = await supabase
      .from("evidence_gaps")
      .select("id, evidence_requirement_id, status")
      .eq("organization_id", organizationId)
      .in("evidence_requirement_id", reqIds)
      .in("status", ["open", "evidence_received", "reverification_pending"]);
    const activeByReq = new Map<string, string>();
    for (const g of activeGaps ?? []) {
      const req = g.evidence_requirement_id as string;
      if (!activeByReq.has(req)) activeByReq.set(req, g.id as string);
    }

    const resolvedGapIds: string[] = [];
    for (const reqId of plan.resolveRequirementIds) {
      const gapId = activeByReq.get(reqId);
      if (!gapId) continue;
      const { error } = await supabase
        .from("evidence_gaps")
        .update({ status: "resolved", closed_by_verification_run_id: runId })
        .eq("id", gapId)
        .eq("organization_id", organizationId);
      if (!error) resolvedGapIds.push(gapId);
    }

    for (const draft of plan.openGapDrafts) {
      const existing = activeByReq.get(draft.evidenceRequirementId);
      if (existing && !resolvedGapIds.includes(existing)) {
        // Re-verified but still unproven — same gap, refreshed attempt ref.
        await supabase
          .from("evidence_gaps")
          .update({ status: "open", verification_run_id: runId, description: draft.description })
          .eq("id", existing)
          .eq("organization_id", organizationId);
        await supabase.from("activity_log").insert({
          organization_id: organizationId,
          actor_user_id: userId,
          event_type: "evidence.gap_updated",
          entity_type: "evidence_gap",
          entity_id: existing,
          metadata: { run_id: runId, requirement_id: draft.evidenceRequirementId },
        });
      } else if (!existing) {
        const { data: gapRow } = await supabase
          .from("evidence_gaps")
          .insert({
            organization_id: organizationId,
            contract_id: item.contract_id,
            obligation_id: criteria.find((c) => c.requirementId === draft.evidenceRequirementId)?.obligationId ?? item.obligation_id,
            evidence_requirement_id: draft.evidenceRequirementId,
            verification_run_id: runId,
            gap_type: draft.gapType,
            description: draft.description,
          })
          .select("id")
          .single();
        if (gapRow) {
          await supabase.from("activity_log").insert({
            organization_id: organizationId,
            actor_user_id: userId,
            event_type: "evidence.gap_opened",
            entity_type: "evidence_gap",
            entity_id: gapRow.id,
            metadata: { run_id: runId, requirement_id: draft.evidenceRequirementId, gap_type: draft.gapType },
          });
        }
      }
    }
    // Any linked-requirement gap left in reverification_pending (e.g. an
    // optional criterion or an untouched path) returns to open — the run
    // completed without resolving it.
    await supabase
      .from("evidence_gaps")
      .update({ status: "open" })
      .eq("organization_id", organizationId)
      .in("evidence_requirement_id", reqIds)
      .eq("status", "reverification_pending");

    for (const gapId of resolvedGapIds) {
      await supabase.from("activity_log").insert({
        organization_id: organizationId,
        actor_user_id: userId,
        event_type: "evidence.gap_closed",
        entity_type: "evidence_gap",
        entity_id: gapId,
        metadata: { run_id: runId },
      });
    }

    // 7. Finish: run verdict + item status.
    await supabase
      .from("evidence_verification_runs")
      .update({
        status: "completed",
        overall_result: plan.overall,
        check_count: plan.checks.length,
        verified_count: plan.resolveRequirementIds.length,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        usage_tokens_input: usageIn,
        usage_tokens_output: usageOut,
      })
      .eq("id", runId);
    await supabase
      .from("evidence_items")
      .update({ status: plan.itemStatus })
      .eq("id", evidenceItemId)
      .eq("organization_id", organizationId);

    await supabase.from("activity_log").insert({
      organization_id: organizationId,
      actor_user_id: userId,
      event_type: isReverification ? "evidence.reverification_completed" : "evidence.verification_completed",
      entity_type: "evidence_item",
      entity_id: evidenceItemId,
      metadata: { run_id: runId, overall: plan.overall, checks: plan.checks.length, resolved_gaps: resolvedGapIds.length },
    });

    return { ok: true, runId, overall: plan.overall };
  } catch (e) {
    return fail("unexpected", e instanceof Error ? e.message : "unknown");
  }
}
