"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServer } from "@/lib/supabase/server";

type AppLocale = (typeof routing.locales)[number];

const BUCKET = "contract-evidence";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB

const EVIDENCE_TYPES = new Set([
  "document", "report", "record", "spreadsheet", "signature",
  "acknowledgement", "approval", "photo", "certificate", "invoice",
  "kpi", "log", "meeting_minutes", "system_record", "other",
]);

// Declared MIME → magic bytes. We never trust the browser's file.type or
// extension alone: the stored signature must match before we accept bytes.
// Empty signature list = content must prove it is plain UTF-8 text (CSV).
const MIME_SIGNATURES: Record<string, { offset?: number; bytes: number[] }[]> = {
  "application/pdf": [{ bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }], // PK zip
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [{ bytes: [0x50, 0x4b, 0x03, 0x04] }],
  "text/csv": [],
  "application/csv": [],
  // Some browsers label .csv as ms-excel — accepted only when the bytes are
  // really text, never for binary spreadsheet payloads.
  "application/vnd.ms-excel": [],
  "image/png": [{ bytes: [0x89, 0x50, 0x4e, 0x47] }],
  "image/jpeg": [{ bytes: [0xff, 0xd8, 0xff] }],
  "image/webp": [{ bytes: [0x52, 0x49, 0x46, 0x46] }], // RIFF
};

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "evidence";
  return base.replace(/[^\w.؀-ۿ-]+/g, "_").slice(0, 120) || "file";
}

function signatureMatches(buffer: Buffer, mime: string): boolean {
  const sigs = MIME_SIGNATURES[mime];
  if (!sigs) return false;
  if (sigs.length === 0) {
    // CSV: must decode as text without NUL bytes (not a binary masquerade).
    if (buffer.includes(0x00)) return false;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return true;
    } catch {
      return false;
    }
  }
  return sigs.some((sig) => sig.bytes.every((b, i) => buffer[(sig.offset ?? 0) + i] === b));
}

type Session = Awaited<ReturnType<typeof auth.getSession>>;
async function liveSession(locale: AppLocale): Promise<Session & { organizationId: string }> {
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/login", locale });
    throw new Error("unreachable");
  }
  return session as Session & { organizationId: string };
}

function localeOf(formData: FormData): AppLocale {
  const raw = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

/**
 * Create a logical evidence item under a contract (optionally tied to an
 * obligation). RLS + valid_* guards reject cross-tenant references.
 */
export async function createEvidenceItem(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);
  const orgId = session.organizationId;
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const obligationId = String(formData.get("obligationId") ?? "").slice(0, 64) || null;
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const evidenceType = String(formData.get("evidenceType") ?? "document");
  const back = (params: string) => `/app/contracts/${contractId}/evidence?${params}`;

  if (!title || !EVIDENCE_TYPES.has(evidenceType)) {
    redirect({ href: back("error=invalid"), locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();
  const { data: item, error } = await supabase
    .from("evidence_items")
    .insert({
      organization_id: orgId,
      contract_id: contractId,
      obligation_id: obligationId,
      title,
      evidence_type: evidenceType,
      created_by: session.user.id,
    })
    .select("id")
    .single();

  if (error || !item) {
    redirect({ href: back("error=create"), locale });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: session.user.id,
    event_type: "evidence.created",
    entity_type: "evidence_item",
    entity_id: item.id,
    metadata: { contract_id: contractId, obligation_id: obligationId },
  });

  redirect({ href: back(`created=${item.id}`), locale });
}

type UploadOutcome =
  | { ok: true; versionId: string; versionNumber: number }
  | { ok: false; error: string };

/**
 * Shared version-upload path: validate bytes, store privately, insert the
 * immutable version row, then nudge the gap lifecycle. NEVER closes gaps —
 * only a verification run may resolve them (Checkpoint 2).
 */
async function storeEvidenceVersion(opts: {
  supabase: Awaited<ReturnType<typeof createSupabaseServer>>;
  orgId: string;
  userId: string;
  evidenceItemId: string;
  contractId: string;
  file: File;
}): Promise<UploadOutcome> {
  const { supabase, orgId, userId, evidenceItemId, contractId, file } = opts;

  const { data: last } = await supabase
    .from("evidence_versions")
    .select("version_number")
    .eq("evidence_item_id", evidenceItemId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = ((last?.version_number as number | undefined) ?? 0) + 1;

  const versionId = crypto.randomUUID();
  const fileName = safeFileName(file.name);
  const storagePath = `${orgId}/${contractId}/${evidenceItemId}/${versionId}_${fileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });
  if (uploadError) return { ok: false, error: "upload" };

  const hashBuffer = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  const fileHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { error: rowError } = await supabase.from("evidence_versions").insert({
    id: versionId,
    organization_id: orgId,
    evidence_item_id: evidenceItemId,
    version_number: versionNumber,
    file_name: fileName,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    file_hash: fileHash,
    uploaded_by: userId,
  });
  if (rowError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: "upload" };
  }

  // New version ⇒ previous verification no longer applies to the candidate.
  await supabase
    .from("evidence_items")
    .update({ status: "received" })
    .eq("id", evidenceItemId)
    .eq("organization_id", orgId);

  // Open gaps on this item's linked requirements move to evidence_received —
  // they stay open; only a verification run may resolve them.
  const { data: links } = await supabase
    .from("evidence_requirement_links")
    .select("evidence_requirement_id")
    .eq("evidence_item_id", evidenceItemId)
    .eq("organization_id", orgId);
  const reqIds = (links ?? []).map((l) => l.evidence_requirement_id as string);
  if (reqIds.length) {
    await supabase
      .from("evidence_gaps")
      .update({ status: "evidence_received" })
      .eq("organization_id", orgId)
      .in("evidence_requirement_id", reqIds)
      .eq("status", "open");
  }

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: userId,
    event_type: "evidence.version_uploaded",
    entity_type: "evidence_item",
    entity_id: evidenceItemId,
    metadata: { version_id: versionId, version_number: versionNumber, file_name: fileName },
  });

  // New evidence received → re-verification. Runs only when a provider is
  // configured and criteria are linked; a failed attempt never marks the
  // item verified and never closes a gap.
  const { verificationProviderConfigured, runEvidenceVerification } = await import("@/lib/evidence/run");
  if (verificationProviderConfigured()) {
    try {
      await runEvidenceVerification({
        supabase, organizationId: orgId, evidenceItemId, userId,
      });
    } catch {
      // verification failure is isolated — the upload itself still succeeds
    }
  }

  return { ok: true, versionId, versionNumber };
}

function validateUploadFile(file: FormDataEntryValue | null): { ok: true; file: File } | { ok: false; error: string } {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "noFile" };
  if (file.size > MAX_BYTES) return { ok: false, error: "tooLarge" };
  if (!Object.hasOwn(MIME_SIGNATURES, file.type)) return { ok: false, error: "type" };
  return { ok: true, file };
}

async function signatureOk(file: File): Promise<boolean> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return signatureMatches(buffer, file.type);
}

/**
 * Upload a new version of an evidence item. UPLOADED ≠ VERIFIED: this action
 * never closes gaps or mutates prior verification results — it only resets
 * the item to "received" and flips open gaps to "evidence_received" so
 * re-verification can run (Checkpoint 2).
 */
export async function uploadEvidenceVersion(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);
  const orgId = session.organizationId;
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "").slice(0, 64);
  const back = (params: string) => `/app/evidence?${params}`;

  const check = validateUploadFile(formData.get("file"));
  if (!check.ok) {
    redirect({ href: back(`error=${check.error}`), locale });
    throw new Error("unreachable");
  }
  if (!(await signatureOk(check.file))) {
    redirect({ href: back("error=signature"), locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();
  const { data: item } = await supabase
    .from("evidence_items")
    .select("id, contract_id")
    .eq("id", evidenceItemId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!item) {
    redirect({ href: back("error=forbidden"), locale });
    throw new Error("unreachable");
  }

  const stored = await storeEvidenceVersion({
    supabase, orgId, userId: session.user.id,
    evidenceItemId, contractId: item.contract_id as string, file: check.file,
  });
  if (!stored.ok) {
    redirect({ href: back(`error=${stored.error}`), locale });
    throw new Error("unreachable");
  }

  redirect({ href: back(`uploaded=${evidenceItemId}`), locale });
}

/**
 * One-shot flow: create the evidence item AND upload its first version.
 * This is the primary "add evidence" entry point (contract/obligation/global).
 */
export async function uploadNewEvidence(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);
  const orgId = session.organizationId;
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const obligationId = String(formData.get("obligationId") ?? "").slice(0, 64) || null;
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const evidenceType = String(formData.get("evidenceType") ?? "document");
  const back = (params: string) => `/app/contracts/${contractId}/evidence?${params}`;

  if (!title || !EVIDENCE_TYPES.has(evidenceType)) {
    redirect({ href: back("error=invalid"), locale });
    throw new Error("unreachable");
  }
  const check = validateUploadFile(formData.get("file"));
  if (!check.ok) {
    redirect({ href: back(`error=${check.error}`), locale });
    throw new Error("unreachable");
  }
  if (!(await signatureOk(check.file))) {
    redirect({ href: back("error=signature"), locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();
  const { data: contract } = await supabase
    .from("contracts")
    .select("id")
    .eq("id", contractId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!contract) {
    redirect({ href: "/app/contracts?error=forbidden", locale });
    throw new Error("unreachable");
  }

  const { data: item, error: itemError } = await supabase
    .from("evidence_items")
    .insert({
      organization_id: orgId,
      contract_id: contractId,
      obligation_id: obligationId,
      title,
      evidence_type: evidenceType,
      created_by: session.user.id,
    })
    .select("id")
    .single();
  if (itemError || !item) {
    redirect({ href: back("error=create"), locale });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: session.user.id,
    event_type: "evidence.created",
    entity_type: "evidence_item",
    entity_id: item.id,
    metadata: { contract_id: contractId, obligation_id: obligationId },
  });

  const stored = await storeEvidenceVersion({
    supabase, orgId, userId: session.user.id,
    evidenceItemId: item.id as string, contractId, file: check.file,
  });
  if (!stored.ok) {
    redirect({ href: back(`error=${stored.error}`), locale });
    throw new Error("unreachable");
  }

  redirect({ href: back(`uploaded=${item.id}`), locale });
}

/**
 * Link an evidence item (optionally a specific version) to an obligation
 * evidence requirement. Human-driven; AI suggestions land via link_source.
 */
export async function linkEvidenceToRequirement(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);
  const orgId = session.organizationId;
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "").slice(0, 64);
  const requirementId = String(formData.get("requirementId") ?? "").slice(0, 64);
  const versionId = String(formData.get("versionId") ?? "").slice(0, 64) || null;
  const back = (params: string) => `/app/evidence?${params}`;

  const supabase = await createSupabaseServer();
  const { error } = await supabase.from("evidence_requirement_links").insert({
    organization_id: orgId,
    evidence_item_id: evidenceItemId,
    evidence_version_id: versionId,
    evidence_requirement_id: requirementId,
    link_source: "manual",
    created_by: session.user.id,
  });
  if (error) {
    redirect({ href: back("error=link"), locale });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: session.user.id,
    event_type: "evidence.linked",
    entity_type: "evidence_item",
    entity_id: evidenceItemId,
    metadata: { evidence_requirement_id: requirementId, version_id: versionId },
  });

  redirect({ href: back(`linked=${evidenceItemId}`), locale });
}

const OVERRIDE_RESULTS = new Set([
  "verified", "partial", "missing", "not_found",
  "not_applicable", "needs_human_review", "unable_to_verify",
]);

/**
 * Run a verification attempt on the item's latest version. Every call creates
 * a NEW verification run — prior history is never overwritten.
 */
export async function requestEvidenceVerification(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "").slice(0, 64);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const back = (params: string) =>
    contractId ? `/app/contracts/${contractId}/evidence?${params}` : `/app/evidence?${params}`;

  const supabase = await createSupabaseServer();
  const { runEvidenceVerification } = await import("@/lib/evidence/run");
  const outcome = await runEvidenceVerification({
    supabase,
    organizationId: session.organizationId,
    evidenceItemId,
    userId: session.user.id,
  });
  if (!outcome.ok) {
    redirect({ href: back(`error=${outcome.error.split(":")[0]}`), locale });
    throw new Error("unreachable");
  }
  redirect({ href: back(`verified=${outcome.overall}`), locale });
}

/**
 * Authorized human override on a single check. The AI/deterministic result is
 * NEVER mutated — the human decision is stored alongside it (human_result +
 * reason + actor + timestamp). When the effective result becomes verified,
 * the matching open gap resolves via the check's verification run.
 */
export async function overrideEvidenceCheck(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);
  const orgId = session.organizationId;
  const checkId = String(formData.get("checkId") ?? "").slice(0, 64);
  const humanResult = String(formData.get("humanResult") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);
  const back = (params: string) =>
    contractId ? `/app/contracts/${contractId}/evidence?${params}` : `/app/evidence?${params}`;

  if (!OVERRIDE_RESULTS.has(humanResult) || !reason) {
    redirect({ href: back("error=invalid"), locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();
  const { data: check } = await supabase
    .from("evidence_verification_checks")
    .select("id, verification_run_id, evidence_requirement_id")
    .eq("id", checkId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!check) {
    redirect({ href: back("error=forbidden"), locale });
    throw new Error("unreachable");
  }

  const { error } = await supabase
    .from("evidence_verification_checks")
    .update({
      human_result: humanResult,
      human_reason: reason,
      overridden_by: session.user.id,
      overridden_at: new Date().toISOString(),
    })
    .eq("id", checkId)
    .eq("organization_id", orgId);
  if (error) {
    redirect({ href: back("error=override"), locale });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: session.user.id,
    event_type: "evidence.human_override",
    entity_type: "evidence_verification_check",
    entity_id: checkId,
    metadata: { run_id: check.verification_run_id, human_result: humanResult },
  });

  // Override to verified resolves the criterion's active gap — attribution is
  // the check's own run, and the override record keeps the AI result intact.
  if (humanResult === "verified" && check.evidence_requirement_id) {
    const { data: gap } = await supabase
      .from("evidence_gaps")
      .update({ status: "resolved", closed_by_verification_run_id: check.verification_run_id })
      .eq("organization_id", orgId)
      .eq("evidence_requirement_id", check.evidence_requirement_id)
      .in("status", ["open", "evidence_received", "reverification_pending"])
      .select("id")
      .maybeSingle();
    if (gap) {
      await supabase.from("activity_log").insert({
        organization_id: orgId,
        actor_user_id: session.user.id,
        event_type: "evidence.gap_closed",
        entity_type: "evidence_gap",
        entity_id: gap.id,
        metadata: { run_id: check.verification_run_id, via: "human_override" },
      });
    }
  }

  redirect({ href: back(`overridden=${checkId}`), locale });
}

/** Short-lived signed URL (60s) — minted only after the RLS-checked select. */
export async function getEvidenceSignedUrl(formData: FormData) {
  const locale = localeOf(formData);
  const session = await liveSession(locale);

  const versionId = String(formData.get("versionId") ?? "").slice(0, 64);
  const supabase = await createSupabaseServer();
  const { data: version } = await supabase
    .from("evidence_versions")
    .select("storage_path")
    .eq("id", versionId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!version) {
    redirect({ href: "/app/evidence?error=forbidden", locale });
    throw new Error("unreachable");
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(version.storage_path as string, 60);
  if (!signed?.signedUrl) {
    redirect({ href: "/app/evidence?error=url", locale });
    throw new Error("unreachable");
  }
  redirect({ href: signed.signedUrl, locale });
}
