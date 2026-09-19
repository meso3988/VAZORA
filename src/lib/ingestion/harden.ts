import "server-only";

import { extractTemporal } from "./temporal";
import type { ObligationExtraction } from "./schema";

/**
 * Anti-hallucination gate applied AFTER model output, BEFORE persistence.
 *
 * Rules:
 *  A. source_snippet must literally appear in its clause/source text (fuzzily
 *     normalized whitespace); unknown → rejected (NO VERIFIED SOURCE
 *     → NO OBLIGATION).
 *  B. Reject generic/summary headings (e.g. "Summary of duties",
 *     "General compliance", "Overall maintenance").
 *  C. Frequency/due from model are replaced by deterministic temporal pass;
 *     model values survive only if supported by raw text.
 *  D. financial_condition/penalty_condition stay ONLY if the source carries a
 *     monetary marker (%, SAR, ريال, خصم, غرامة, penalty, damages, fees…).
 *  E. Duplicate suppression within run: same (title, clause number) keeps the
 *     first instance; conflicting due rules across documents are surfaced via
 *     conflict_group_id (already handled in run.ts).
 *  F. Per-field provenance: fields the temporal pass re-derived :=
 *     "explicit"; model-claimed values without evidence := "inferred".
 */

const SUMMARY_PATTERN = /^(summary|overview|general|overall|comprehensive|responsibilities of|duties of|الملخص|إجمالي|بنود عامة|مجمل)/i;

const MONEY_MARKERS = /(\d+(\.\d+)?\s*%|٪\s*\d+|ريال|ر\.س|SAR|USD|EUR|penalty|liquidated|damages|deduct|fine|غرامة|خصم|جزاء|تعويض)/i;

export function hardenExtraction(opts: {
  extraction: ObligationExtraction;
  /** clause text candidates we might validate the snippet against */
  clauseTexts: { text: string; clauseNumber: string | null; documentId: string }[];
  documentId: string;
}): ObligationExtraction | null {
  const { extraction } = opts;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  // A — source validation
  const snippet = extraction.source_snippet?.trim() ?? "";
  if (!snippet || snippet.length < 4) return null;
  const snippetNorm = norm(snippet);
  const clausePool = opts.clauseTexts.filter((c) => c.documentId === opts.documentId);
  const preferred = opts.clauseTexts.find(
    (c) => c.documentId === opts.documentId && c.clauseNumber === extraction.source_clause_number,
  );
  const haystacks = [preferred, ...clausePool.filter((c) => c !== preferred)].filter(Boolean) as { text: string; clauseNumber: string | null; documentId: string }[];
  const found = haystacks.some((c) => norm(c.text).includes(snippetNorm.slice(0, 60)) || norm(c.text).includes(snippetNorm));
  if (!found) return null;

  // B — summary-style headings are not obligations
  if (SUMMARY_PATTERN.test(extraction.title) || SUMMARY_PATTERN.test(extraction.requirement_text ?? "")) return null;

  // C — temporal pass over the source text replaces model's guess; model's
  // values are kept only if the deterministic pass supports the same rule.
  const tem = extractTemporal(snippet + "\n" + (extraction.due_rule_raw ?? ""));
  const out: ObligationExtraction = { ...extraction };
  const provenance = { ...(out.field_provenance ?? {}) };

  if (tem.frequency || tem.due) {
    // deterministic wins whenever text is explicit
    out.frequency = tem.frequency ?? out.frequency;
    if (tem.due) {
      out.due_rule_normalized = tem.due;
      out.due_rule_raw = out.due_rule_raw ?? tem.raw;
      provenance.frequency = "explicit";
      provenance.due = "explicit";
    } else if (out.frequency) {
      provenance.frequency = "explicit";
      provenance.due = "inferred";
    }
  } else {
    // No temporal evidence in the clause text — normalize to UNKNOWN instead of keeping hallucinated rules.
    out.frequency = null;
    out.due_rule_raw = null;
    out.due_rule_normalized = null;
    provenance.frequency = "unknown";
    provenance.due = "unknown";
  }

  // D — strict financiality: only keep when the source carries money markers.
  if (out.financial_condition && !MONEY_MARKERS.test(snippet)) {
    out.financial_condition = null;
    provenance.financial_condition = "inferred";
  } else if (out.financial_condition) {
    provenance.financial_condition = "explicit";
  }
  if (out.penalty_condition && !MONEY_MARKERS.test(snippet)) {
    out.penalty_condition = null;
    provenance.penalty_condition = "inferred";
  } else if (out.penalty_condition) {
    provenance.penalty_condition = "explicit";
  }

  out.field_provenance = provenance;
  return out;
}

/** Deterministic dedup: same normalized title within the same clause/document is a duplicate. */
export function dedupeAcross(chunks: { extraction: ObligationExtraction; documentId: string }[]): { extraction: ObligationExtraction; documentId: string }[] {
  const seen = new Set<string>();
  const out: typeof chunks = [];
  for (const item of chunks) {
    const key = `${item.documentId}|${(item.extraction.source_clause_number ?? "").toLowerCase()}|${item.extraction.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
