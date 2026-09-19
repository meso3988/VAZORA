import "server-only";

import { chunkSegments, documentFingerprint, segmentDocument } from "@/lib/ingestion/segment";
import { extractChunkValidated, getExtractionProvider } from "@/lib/ingestion/extractor";
import { parseDocumentBytes } from "@/lib/ingestion/parser";
import type { ObligationExtraction } from "@/lib/ingestion/schema";

// Side-effect: registers the OpenAI-compatible provider factory.
import "@/lib/ingestion/openai-compat";

type SupabaseLike = Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServer>>;

type DocRow = {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  document_version: number;
};

const PARSER_VERSION = "0.2.0";

/**
 * End-to-end ingestion for one contract: parse all its documents, chunk
 * clause segments, extract obligations with the configured AI provider,
 * validate the structured output, and persist draft obligations. Every step
 * writes status back so a page reload or network interruption never corrupts
 * the run.
 *
 * Never silently reruns expensive AI: idempotency_key = contract + document
 * fingerprint makes duplicate Analyze clicks a no-op.
 */
export async function runContractIngestion(opts: {
  supabase: SupabaseLike;
  organizationId: string;
  contractId: string;
  userId: string;
  contractTitle: string;
  force?: boolean;
}): Promise<{ runId: string; status: string; obligations: number }> {
  const { supabase, organizationId, contractId, userId, contractTitle, force } = opts;

  const provider = getExtractionProvider();
  if (!provider) {
    return { runId: "", status: "failed", obligations: 0 };
  }

  // 1. Documents tied to the contract
  const { data: docsRaw } = await supabase
    .from("contract_documents")
    .select("id, file_name, storage_path, mime_type, file_size, document_version")
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .order("created_at", { ascending: true });
  const docs = (docsRaw ?? []) as DocRow[];
  if (!docs.length) throw new Error("no_documents");

  const fingerprint = await documentFingerprint(
    docs.map((d) => ({ id: d.id, fileName: d.file_name, fileSize: d.file_size, version: d.document_version })),
  );
  const idempotencyKey = `${contractId}:${fingerprint}`;

  // 2. Dedupe: reuse the existing run unless force=true (explicit re-analysis).
  if (!force) {
    const { data: existing } = await supabase
      .from("contract_ingestion_runs")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .eq("idempotency_key", idempotencyKey)
      .in("status", ["ready_for_review", "approved", "extracting", "consolidating", "parsing", "queued"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { runId: existing.id as string, status: existing.status as string, obligations: 0 };
  } else {
    // explicit re-run supersedes earlier review-ready runs — never touched audit
    await supabase
      .from("contract_ingestion_runs")
      .update({ status: "superseded" })
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .in("status", ["ready_for_review"]);
  }

  const { data: runRow, error: runErr } = await supabase
    .from("contract_ingestion_runs")
    .insert({
      organization_id: organizationId,
      contract_id: contractId,
      status: "queued",
      parser_version: PARSER_VERSION,
      extractor_version: provider.id,
      model_identifier: provider.model,
      document_count: docs.length,
      idempotency_key: idempotencyKey,
      document_fingerprint: fingerprint,
      created_by: userId,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (runErr || !runRow) throw new Error(`run_insert: ${runErr?.message ?? "none"}`);
  const runId = runRow.id as string;
  const t0 = Date.now();

  const fail = async (code: string, message: string) => {
    await supabase
      .from("contract_ingestion_runs")
      .update({ status: "failed", error_code: code, error_message: message.slice(0, 400), completed_at: new Date().toISOString(), duration_ms: Date.now() - t0 })
      .eq("id", runId);
    return { runId, status: "failed", obligations: 0 };
  };

  try {
    // 3. PARSE — every document → clauses
    await supabase.from("contract_ingestion_runs").update({ status: "parsing" }).eq("id", runId);

    const clauseInserts: Record<string, unknown>[] = [];
    const segmentContexts: { documentId: string; chunkIndex: number; fileName: string; segments: { clauseNumber: string | null; heading: string | null; text: string; pageNumber: number | null }[] }[] = [];
    let pageCount = 0;
    let chunkIndex = 0;

    for (const doc of docs) {
      const { data: fileData, error: dlError } = await supabase.storage
        .from("contract-documents")
        .download(doc.storage_path);
      if (dlError || !fileData) return fail("storage_download", `cannot read ${doc.file_name}`);

      const bytes = Buffer.from(await fileData.arrayBuffer());
      let parsed;
      try {
        parsed = await parseDocumentBytes(doc.file_name, bytes);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "parse";
        if (msg.startsWith("UNSUPPORTED_DOC_TYPE")) return fail("unsupported_document", msg);
        return fail("parse_failed", `${doc.file_name}: ${msg}`);
      }
      if (parsed.emptyText) {
        return fail("ocr_required", `${doc.file_name}: no digital text layer — likely a scanned document`);
      }
      pageCount += parsed.pageCount ?? 0;

      const segments = segmentDocument(parsed);
      for (const seg of segments) {
        clauseInserts.push({
          organization_id: organizationId,
          contract_id: contractId,
          ingestion_run_id: runId,
          document_id: doc.id,
          clause_number: seg.clauseNumber,
          heading: seg.heading,
          text: seg.text.slice(0, 50000),
          page_number: seg.pageNumber,
          sequence_number: seg.sequence,
        });
      }
      for (const chunk of chunkSegments(segments)) {
        segmentContexts.push({
          documentId: doc.id,
          chunkIndex: chunkIndex++,
          fileName: doc.file_name,
          segments: chunk.map((s) => ({ clauseNumber: s.clauseNumber, heading: s.heading, text: s.text, pageNumber: s.pageNumber })),
        });
      }
    }

    const { error: clauseErr } = await supabase
      .from("contract_clauses")
      .insert(clauseInserts);
    if (clauseErr) return fail("clause_insert", clauseErr.message);

    await supabase
      .from("contract_ingestion_runs")
      .update({ status: "parsed", page_count: pageCount, segment_count: segmentContexts.length })
      .eq("id", runId);

    // 4. EXTRACT — one provider call per chunk, validated
    await supabase.from("contract_ingestion_runs").update({ status: "extracting" }).eq("id", runId);

    const obligations: { extraction: ObligationExtraction; segmentContext: (typeof segmentContexts)[number] }[] = [];
    const tokensIn = 0;
    const tokensOut = 0;
    for (const ctx of segmentContexts) {
      const result = await extractChunkValidated(provider, {
        organizationId,
        contractId,
        contractTitle,
        chunk: { chunkIndex: ctx.chunkIndex, documentIds: [ctx.documentId], documentNames: [ctx.fileName], segments: ctx.segments },
      });
      if (!result.ok) return fail("extraction_failed", `${ctx.chunkIndex}: ${result.error}`);
      for (const ext of result.obligations) obligations.push({ extraction: ext, segmentContext: ctx });
    }

    // 5. Consolidate — never blend sources; duplicates merge by (title, source ref)
    await supabase.from("contract_ingestion_runs").update({ status: "consolidating" }).eq("id", runId);

    const clauseIndex = new Map<string, string>(); // "documentId|clauseNumber" -> clause row id
    const { data: clauseRowsAll } = await supabase
      .from("contract_clauses")
      .select("id, clause_number, document_id")
      .eq("ingestion_run_id", runId);
    for (const row of clauseRowsAll ?? []) {
      if (row.clause_number) clauseIndex.set(`${row.document_id}|${row.clause_number}`, row.id as string);
    }

    // 5b. Conflict detection: same clause in DIFFERENT documents with a
    // different due-rule (e.g. main "day 5" vs addendum "day 7") is a
    // POTENTIAL CONTRACTUAL CONFLICT — never resolved automatically.
    const normTitle = (s?: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const byClause = new Map<string, typeof obligations>();
    obligations.forEach((ob) => {
      const k = (ob.extraction.source_clause_number ?? "").toLowerCase();
      if (!k) return;
      const list = byClause.get(k) ?? [];
      list.push(ob);
      byClause.set(k, list);
    });
    const conflictIdByIndex = new Map<number, string>();
    for (const group of byClause.values()) {
      const docs = new Set(group.map((o) => o.segmentContext.documentId));
      const dueRaw = new Set(group.map((o) => normTitle(o.extraction.due_rule_raw)).filter(Boolean));
      const dueNorm = new Set(group.map((o) => normTitle(o.extraction.due_rule_normalized)).filter(Boolean));
      if (docs.size > 1 && (dueRaw.size > 1 || dueNorm.size > 1)) {
        const groupId = crypto.randomUUID();
        group.forEach((o) => conflictIdByIndex.set(obligations.indexOf(o), groupId));
      }
    }

    const obligationInserts: Record<string, unknown>[] = [];
    const obligationSnippets: { snippet: string; documentId: string; page: number | null; clauseNumber: string | null }[][] = [];
    obligations.forEach(({ extraction, segmentContext }, idx) => {
      const inConflict = conflictIdByIndex.has(idx);
      const reviewStatus =
        !extraction.source_snippet || extraction.ai_confidence == null || extraction.ai_confidence < 0.6
          ? "needs_review"
          : inConflict
            ? "conflict_requires_review"
            : "extracted";
      const needsSourceReview = !extraction.source_snippet || !extraction.source_clause_number;

      obligationInserts.push({
        organization_id: organizationId,
        contract_id: contractId,
        ingestion_run_id: runId,
        title: extraction.title,
        requirement_text: extraction.requirement_text,
        obligation_type: extraction.obligation_type,
        frequency: extraction.frequency ?? null,
        due_rule_raw: extraction.due_rule_raw ?? null,
        due_rule_normalized: extraction.due_rule_normalized ?? null,
        owner_role_suggested: extraction.owner_role_suggested ?? null,
        approver_role_suggested: extraction.approver_role_suggested ?? null,
        external_dependency: extraction.external_dependency ?? null,
        payment_linked: extraction.payment_linked ?? null,
        payment_link_note: extraction.payment_link_note ?? null,
        financial_condition: extraction.financial_condition ?? null,
        penalty_condition: extraction.penalty_condition ?? null,
        risk_note: extraction.risk_note ?? null,
        submission_required: extraction.submission_required ?? null,
        submission_destination: extraction.submission_destination ?? null,
        submission_channel: extraction.submission_channel ?? null,
        submission_deadline_rule: extraction.submission_deadline_rule ?? null,
        requires_external_acknowledgement: extraction.requires_external_acknowledgement ?? null,
        ai_confidence: extraction.ai_confidence ?? null,
        field_provenance: extraction.field_provenance ?? {},
        ai_payload: extraction,
        review_status: reviewStatus,
        review_notes: extraction.review_reason ?? null,
        needs_source_review: needsSourceReview,
        conflict_group_id: conflictIdByIndex.get(idx) ?? null,
      });
      obligationSnippets.push(
        (extraction.source_snippet
          ? [{
              snippet: extraction.source_snippet,
              documentId: segmentContext.documentId,
              page: segmentContext.segments.find((s) => s.text.includes(extraction.source_snippet.slice(0, 60)))?.pageNumber ?? null,
              clauseNumber: extraction.source_clause_number ?? null,
            }]
          : []),
      );
    });

    const { data: obligationRows, error: oblErr } = await supabase
      .from("contract_obligations")
      .insert(obligationInserts)
      .select("id");
    if (oblErr || !obligationRows) return fail("obligation_insert", oblErr?.message ?? "none");

    // 6. Source refs + evidence requirements (never untraceable)
    const refInserts: Record<string, unknown>[] = [];
    const evidenceInserts: Record<string, unknown>[] = [];
    obligations.forEach(({ extraction }, i) => {
      const obligationId = obligationRows[i].id as string;
      for (const s of obligationSnippets[i]) {
        refInserts.push({
          organization_id: organizationId,
          obligation_id: obligationId,
          document_id: s.documentId,
          clause_id: s.clauseNumber ? clauseIndex.get(`${s.documentId}|${s.clauseNumber}`) ?? null : null,
          page_number: s.page,
          source_snippet: s.snippet,
        });
      }
      for (const ev of extraction.evidence_requirements) {
        evidenceInserts.push({
          organization_id: organizationId,
          obligation_id: obligationId,
          name: ev.name,
          description: ev.description ?? null,
          evidence_type: ev.evidence_type,
          required: ev.required,
        });
      }
    });

    if (refInserts.length) {
      const { data: refRows, error: refErr } = await supabase.from("obligation_source_refs").insert(refInserts).select("id, obligation_id");
      if (refErr) return fail("source_ref_insert", refErr.message);
      // Link evidence requirements to their obligation's first source ref when present.
      const refByObligation = new Map<string, string>();
      for (const r of refRows ?? []) if (!refByObligation.has(r.obligation_id as string)) refByObligation.set(r.obligation_id as string, r.id as string);
      for (const ev of evidenceInserts) {
        ev.source_ref_id = refByObligation.get(ev.obligation_id as string) ?? null;
      }
    }
    if (evidenceInserts.length) {
      const { error: evErr } = await supabase.from("obligation_evidence_requirements").insert(evidenceInserts);
      if (evErr) return fail("evidence_insert", evErr.message);
    }

    await supabase
      .from("contract_ingestion_runs")
      .update({
        status: "ready_for_review",
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        usage_tokens_input: tokensIn || null,
        usage_tokens_output: tokensOut || null,
      })
      .eq("id", runId);

    await supabase.from("activity_log").insert({
      organization_id: organizationId,
      actor_user_id: userId,
      event_type: "contract.analysis_completed",
      entity_type: "contract",
      entity_id: contractId,
      metadata: { run_id: runId, obligations: obligationRows.length, documents: docs.length },
    });

    return { runId, status: "ready_for_review", obligations: obligationRows.length };
  } catch (e) {
    return fail("unexpected", e instanceof Error ? e.message : "unknown");
  }
}
