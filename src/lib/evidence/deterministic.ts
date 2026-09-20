import "server-only";

import { parseDocumentBytes } from "@/lib/ingestion/parser";

/**
 * Deterministic evidence layer — everything here is code, no model.
 *
 * Two jobs:
 *   1. Turn stored bytes into plain text when a reliable parser exists
 *      (PDF text layer, DOCX, CSV/text). Images and parse failures are
 *      honest `unreadable` results — never silently "verified".
 *   2. Ground AI provenance: a claimed source_excerpt must exist VERBATIM
 *      in the extracted text. This is the deterministic gate behind
 *      NO SUPPORT → NO VERIFIED.
 */

export type EvidenceText =
  | { ok: true; text: string; pageOffsets: { page: number; start: number; end: number }[] }
  | { ok: false; reason: "ocr_required" | "unsupported_type" | "parse_failed" };

const TEXT_MIMES = new Set([
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // accepted only when the bytes are really text
  "text/plain",
]);

export async function extractEvidenceText(
  fileName: string,
  mimeType: string,
  bytes: Buffer,
): Promise<EvidenceText> {
  const lower = fileName.toLowerCase();

  if (TEXT_MIMES.has(mimeType) || lower.endsWith(".csv") || lower.endsWith(".txt")) {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { ok: true, text, pageOffsets: [] };
    } catch {
      return { ok: false, reason: "parse_failed" };
    }
  }

  if (lower.endsWith(".pdf") || lower.endsWith(".docx")) {
    try {
      const parsed = await parseDocumentBytes(fileName, bytes);
      if (parsed.emptyText) return { ok: false, reason: "ocr_required" };
      return { ok: true, text: parsed.text, pageOffsets: parsed.pageOffsets };
    } catch {
      return { ok: false, reason: "parse_failed" };
    }
  }

  if (mimeType.startsWith("image/")) return { ok: false, reason: "ocr_required" };
  // XLSX has no parser in this codebase yet — honest unable_to_verify path,
  // never a fabricated verdict.
  return { ok: false, reason: "unsupported_type" };
}

/** Whitespace/case-insensitive normalization for verbatim excerpt matching. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[ ‐-―−]/g, "-")
    .trim()
    .toLowerCase();
}

/**
 * Is `excerpt` a verbatim substring of the document text (modulo whitespace
 * and dash variants)? PDF extraction inserts/removes spaces arbitrarily, so
 * matching is done on the normalized forms.
 */
export function excerptIsGrounded(documentText: string, excerpt: string): boolean {
  const needle = normalizeForMatch(excerpt);
  if (needle.length < 4) return false; // trivially short quotes prove nothing
  return normalizeForMatch(documentText).includes(needle);
}

/**
 * Locate the page an excerpt lands on, using parser page offsets. Returns
 * null when offsets are unavailable or the excerpt spans a boundary.
 */
export function pageOfExcerpt(
  documentText: string,
  pageOffsets: { page: number; start: number; end: number }[],
  excerpt: string,
): number | null {
  if (!pageOffsets.length) return null;
  // find the raw-text window containing the normalized match: locate by a
  // distinctive probe — the first 24 normalized chars of the excerpt mapped
  // back through a normalized scan of the raw text is expensive, so we
  // approximate: find which page contains the excerpt's longest line.
  const probe = excerpt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 8)
    .sort((a, b) => b.length - a.length)[0];
  if (!probe) return null;
  const idx = documentText.indexOf(probe);
  if (idx < 0) return null;
  const hit = pageOffsets.find((p) => idx >= p.start && idx < p.end);
  return hit?.page ?? null;
}
