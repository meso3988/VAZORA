"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServer } from "@/lib/supabase/server";

const BUCKET = "contract-documents";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ALLOWED = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
]);

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  return base.replace(/[^\w.\u0600-\u06FF-]+/g, "_").slice(0, 120) || "file";
}

/**
 * Private contract-document upload. The storage object path encodes the
 * tenant: {organization_id}/{contract_id}/{document_id}_{file}; storage RLS
 * and the documents table policies verify membership server-side.
 */
export async function uploadDocument(formData: FormData) {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64);

  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/login", locale });
    throw new Error("unreachable");
  }
  const orgId = session.organizationId;
  const back = (params: string) => `/app/contracts/${contractId}?${params}`;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect({ href: back("error=noFile"), locale });
    throw new Error("unreachable");
  }
  if (file.size > MAX_BYTES) {
    redirect({ href: back("error=tooLarge"), locale });
    throw new Error("unreachable");
  }
  if (!ALLOWED.has(file.type)) {
    redirect({ href: back("error=type"), locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();

  // Contract must belong to the caller's organization (RLS -> 0 rows otherwise).
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

  const docId = crypto.randomUUID();
  const fileName = safeFileName(file.name);
  const storagePath = `${orgId}/${contractId}/${docId}_${fileName}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    redirect({ href: back("error=upload"), locale });
    throw new Error("unreachable");
  }

  const { error: rowError } = await supabase.from("contract_documents").insert({
    id: docId,
    organization_id: orgId,
    contract_id: contractId,
    file_name: fileName,
    storage_path: storagePath,
    mime_type: file.type,
    file_size: file.size,
    document_type: "contract",
    uploaded_by: session.user.id,
  });

  if (rowError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    redirect({ href: back("error=upload"), locale });
    throw new Error("unreachable");
  }

  await supabase.from("activity_log").insert({
    organization_id: orgId,
    actor_user_id: session.user.id,
    event_type: "document.uploaded",
    entity_type: "contract_document",
    entity_id: docId,
    metadata: { contract_id: contractId, file_name: fileName },
  });

  redirect({ href: back("uploaded=1"), locale });
}

/** Short-lived signed URL (60s) for a document the user already may read. */
export async function getDocumentUrl(formData: FormData) {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  const documentId = String(formData.get("documentId") ?? "").slice(0, 64);

  const session = await auth.getSession();
  if (!session || !session.organizationId) {
    redirect({ href: "/login", locale });
    throw new Error("unreachable");
  }

  const supabase = await createSupabaseServer();
  const { data: doc } = await supabase
    .from("contract_documents")
    .select("storage_path")
    .eq("id", documentId)
    .eq("organization_id", session.organizationId)
    .maybeSingle();
  if (!doc) {
    redirect({ href: "/app/contracts?error=forbidden", locale });
    throw new Error("unreachable");
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path as string, 60);

  if (!signed?.signedUrl) {
    redirect({ href: "/app/contracts", locale });
    throw new Error("unreachable");
  }
  redirect({ href: signed.signedUrl, locale });
}
