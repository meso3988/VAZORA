import { z } from "zod";

/**
 * Structured evidence-verification output. Provider responses MUST validate
 * here before anything is persisted — a well-formatted answer that does not
 * match the schema is discarded, never saved, and can never close a gap.
 *
 * Mirrors the DB enum verification_check_result exactly.
 */
export const checkResultSchema = z.enum([
  "verified",
  "partial",
  "missing",
  "not_found",
  "not_applicable",
  "needs_human_review",
  "unable_to_verify",
]);

export type CheckResult = z.infer<typeof checkResultSchema>;

/**
 * One criterion-level result. Verification is criterion-first: the provider
 * answers one entry PER requested requirement — never a single document-level
 * verdict.
 *
 * NO SUPPORT → NO VERIFIED: `verified` (and `partial`, which asserts partial
 * proof) require a verbatim `source_excerpt` from the evidence text. The
 * engine additionally requires the excerpt to exist verbatim in the parsed
 * document — the schema only enforces presence.
 */
export const providerCheckSchema = z
  .object({
    requirement_id: z.string().min(1).max(64),
    result: checkResultSchema,
    confidence: z.number().min(0).max(1).nullish(),
    reason: z.string().max(1000).nullish(),
    /** verbatim excerpt copied from the evidence document — never paraphrased */
    source_excerpt: z.string().max(2000).nullish(),
    /** 1-based PDF page when known */
    source_page: z.number().int().positive().nullish(),
    /** e.g. sheet "KPI" B4:I4, docx section heading, CSV row */
    source_location: z.string().max(400).nullish(),
    /** true when the evidence actively contradicts the requirement */
    contradiction: z.boolean().nullish(),
  })
  .superRefine((c, ctx) => {
    if ((c.result === "verified" || c.result === "partial") && !c.source_excerpt?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["source_excerpt"],
        message: "verified/partial requires a verbatim source_excerpt",
      });
    }
    if (c.result === "verified" && c.contradiction === true) {
      ctx.addIssue({
        code: "custom",
        path: ["contradiction"],
        message: "a contradictory check cannot be verified",
      });
    }
  });

export type ProviderCheck = z.infer<typeof providerCheckSchema>;

export const verificationOutputSchema = z.object({
  checks: z.array(providerCheckSchema).max(200),
});

export type VerificationOutput = z.infer<typeof verificationOutputSchema>;

/** Defensive parse — invalid output is a hard failure, never persisted. */
export function validateVerificationOutput(
  raw: unknown,
): { ok: true; output: VerificationOutput } | { ok: false; issues: string[] } {
  const parsed = verificationOutputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, output: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 8),
  };
}
