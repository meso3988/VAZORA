import { z } from "zod";

/**
 * Structured contract-extraction schemas. Provider output MUST validate here
 * before anything is persisted — a well-formatted answer that does not match
 * the schema is discarded, never saved.
 */

export const obligationTypeSchema = z.enum([
  "deliverable", "reporting", "service_level", "maintenance", "inspection",
  "payment", "claim", "invoice", "documentation", "approval", "training",
  "staffing", "insurance", "license", "safety", "quality", "compliance",
  "notification", "meeting", "handover", "other",
]);

export const evidenceTypeSchema = z.enum([
  "document", "report", "record", "signature", "approval", "acknowledgement",
  "photo", "log", "certificate", "invoice", "kpi", "meeting_minutes",
  "system_record", "other",
]);

export const submissionChannelSchema = z.enum([
  "email", "portal", "erp", "vendor_portal", "physical", "official_letter",
  "api", "other", "unspecified",
]);

export const provenanceSchema = z.enum(["explicit", "inferred", "unknown"]);

export const evidenceRequirementSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).nullish(),
  evidence_type: evidenceTypeSchema,
  required: z.boolean(),
});

export const obligationExtractionSchema = z.object({
  title: z.string().min(2).max(240),
  requirement_text: z.string().min(2).optional(),
  /** model often emits `requirement` instead — normalize */
  requirement: z.string().min(2).optional(),
  obligation_type: obligationTypeSchema,

  frequency: z.string().max(120).nullish(),
  due_rule_raw: z.string().max(400).nullish(),
  due_rule_normalized: z.string().max(120).nullish(),

  owner_role_suggested: z.string().max(120).nullish(),
  approver_role_suggested: z.string().max(120).nullish(),

  external_dependency: z.string().max(240).nullish(),

  payment_linked: z.boolean().nullish(),
  payment_link_note: z.string().max(400).nullish(),

  financial_condition: z.string().max(600).nullish(),
  penalty_condition: z.string().max(600).nullish(),
  risk_note: z.string().max(600).nullish(),

  submission_required: z.boolean().nullish(),
  submission_destination: z.string().max(200).nullish(),
  submission_channel: submissionChannelSchema.nullish(),
  submission_deadline_rule: z.string().max(200).nullish(),
  requires_external_acknowledgement: z.boolean().nullish(),

  ai_confidence: z.number().min(0).max(1).nullish(),

  /** per-field provenance — field name → explicit/inferred/unknown */
  field_provenance: z.record(z.string(), provenanceSchema).default({}),

  evidence_requirements: z.array(evidenceRequirementSchema).default([]),

  /** traceability — NO SOURCE → NO CLAIM */
  source_clause_number: z.string().max(40).nullish(),
  source_snippet: z.string().min(2), // verbatim excerpt from the source clause

  review_reason: z.string().max(300).nullish(), // why a human should look closer
});

export type ObligationExtraction = z.infer<typeof obligationExtractionSchema>;

export const chunkExtractionSchema = z.object({
  obligations: z.array(obligationExtractionSchema),
});

export type ChunkExtraction = z.infer<typeof chunkExtractionSchema>;

/**
 * Parse provider output defensively. Returns null on invalid shape — callers
 * must NOT persist obligations when this returns null or partial entries that
 * failed `.safeParse` (we surface them and mark the run accordingly).
 */
export function validateChunkExtraction(raw: unknown):
  | { ok: true; obligations: ObligationExtraction[] }
  | { ok: false; issues: string[] } {
  // Normalize before zod: providers sometimes emit `requirement` instead of
  // `requirement_text`. Canonicalize at the boundary so schemas stay stable.
  const normalized = (() => {
    if (typeof raw !== "object" || raw === null) return raw;
    const obj = raw as { obligations?: unknown[] };
    if (!Array.isArray(obj.obligations)) return raw;
    return {
      ...obj,
      obligations: obj.obligations.map((o) => {
        if (typeof o !== "object" || o === null) return o;
        const rec = o as Record<string, unknown>;
        if (rec.requirement_text == null && typeof rec.requirement === "string") {
          return { ...rec, requirement_text: rec.requirement };
        }
        return rec;
      }),
    };
  })();

  const checked = chunkExtractionSchema.safeParse(normalized);
  if (checked.success) {
    return {
      ok: true,
      obligations: checked.data.obligations.map((o) => ({
        ...o,
        requirement_text: (o.requirement_text ?? o.requirement) as string,
      })) as ObligationExtraction[],
    };
  }
  return { ok: false, issues: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
