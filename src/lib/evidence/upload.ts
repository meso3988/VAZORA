import "server-only";

import type { SupabaseLike } from "@/lib/evidence/run";

export const EVIDENCE_BUCKET = "contract-evidence";

export type UploadOutcome =
  | { ok: true; versionId: string; versionNumber: number }
  | { ok: false; error: string };

export function safeEvidenceFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "evidence";
  return base.replace(/[^\w.؀-ۿ-]+/g, "_").slice(0, 120) || "file";
}

/**
 * Shared version-upload path: validate bytes, store privately, insert the
 * immutable version row, then nudge the gap lifecycle. NEVER closes gaps —
 * only a verification run may resolve them (Checkpoint 2).
 */
export async function storeEvidenceVersion(opts: {
  supabase: SupabaseLike;
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
  const fileName = safeEvidenceFileName(file.name);
  const storagePath = `${orgId}/${contractId}/${evidenceItemId}/${versionId}_${fileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
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
    await supabase.storage.from(EVIDENCE_BUCKET).remove([storagePath]);
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
  if (process.env.VAZORA_EVIDENCE_AUTO_VERIFY !== "0") {
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
  }

  return { ok: true, versionId, versionNumber };
}
