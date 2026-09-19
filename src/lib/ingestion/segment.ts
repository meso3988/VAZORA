import "server-only";

import type { ParsedDocument } from "./parser";

/**
 * Clause segmentation across Arabic / English / mixed contracts.
 *
 * Supported first-line patterns (first non-empty line of a clause block):
 *   12.1 / 12-1 / §12.1            (western)
 *   المادة 12 / المادة الثانية عشرة  (arabic numeric + words)
 *   البند 8/4
 *   Clause 5
 * Numberless chunks keep a stable synthetic ref so nothing is left implicit.
 */
export type Segment = {
  clauseNumber: string | null;
  heading: string | null;
  text: string;
  pageNumber: number | null;
  sequence: number;
};

const CLAUSE_HEADS: RegExp[] = [
  // "12.1 Title" or "12-1 Title" or "§12.1 Title"
  /^\s*(?:§\s*)?(\d+(?:[.\-/]\d+)+)\s*[):.–-]?\s*(.*)$/,
  // "المادة 12" / "المادة الثانية عشرة" / "المادة: 4"
  /^\s*المادة\s+([^\s:]{1,20})\s*:?\s*(.*)$/,
  // "البند 8/4"
  /^\s*البند\s+([^\s:]{1,20})\s*:?\s*(.*)$/,
  // "Clause 5" / "Section 3.1"
  /^\s*(?:Clause|Section)\s+([0-9][\d.\-/]*)\s*[).:-]?\s*(.*)$/i,
];

function pageAt(offsets: ParsedDocument["pageOffsets"], pos: number): number | null {
  if (!offsets.length) return null;
  const hit = offsets.find((o) => pos >= o.start && pos < o.end);
  return hit?.page ?? offsets[offsets.length - 1].page;
}

export function segmentDocument(doc: ParsedDocument): Segment[] {
  const lines = doc.text.split(/\r?\n/);
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let seq = 0;
  let cursor = 0; // approximate char offset for page mapping

  const flush = () => {
    if (current && current.text.trim()) segments.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();
    let head: { num: string; rest: string } | null = null;
    for (let i = 0; i < CLAUSE_HEADS.length; i++) {
      const m = trimmed.match(CLAUSE_HEADS[i]);
      if (m && m[1]) {
        // Western/English patterns must carry a numeral — Arabic word forms stay valid.
        if ((i === 0 || i === 3) && !/\d/.test(m[1])) continue;
        head = { num: m[1].trim(), rest: (m[2] ?? "").trim() };
        break;
      }
    }
    if (head && trimmed.length < 200) {
      flush();
      seq += 1;
      current = {
        clauseNumber: head.num,
        heading: head.rest.slice(0, 180) || null,
        text: trimmed,
        pageNumber: pageAt(doc.pageOffsets, cursor),
        sequence: seq,
      };
    } else if (current) {
      current.text += "\n" + trimmed;
    } else if (trimmed) {
      seq += 1;
      current = {
        clauseNumber: null,
        heading: null,
        text: trimmed,
        pageNumber: pageAt(doc.pageOffsets, cursor),
        sequence: seq,
      };
    }
    cursor += line.length + 1;
  }
  flush();

  // Merge pathological over-segmentation (single-char "clauses") back into the previous block.
  const merged: Segment[] = [];
  for (const seg of segments) {
    const prev = merged[merged.length - 1];
    if (prev && seg.text.trim().length < 25 && seg.clauseNumber === null) {
      prev.text += "\n" + seg.text.trim();
    } else {
      merged.push(seg);
    }
  }
  return merged;
}

/** Deterministic, budget-aware chunking: never split a clause; target ≤ maxChars. */
export function chunkSegments(segments: Segment[], maxChars = 8000): Segment[][] {
  const chunks: Segment[][] = [];
  let chunk: Segment[] = [];
  let size = 0;
  for (const seg of segments) {
    const len = seg.text.length;
    if (chunk.length && size + len > maxChars) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push(seg);
    size += len;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** sha-256 of included document snapshots — drives idempotency. */
export async function documentFingerprint(docs: { id: string; fileName: string; fileSize: number; version: number }[]): Promise<string> {
  const material = docs
    .map((d) => `${d.id}:${d.fileName}:${d.fileSize}:${d.version}`)
    .sort()
    .join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
