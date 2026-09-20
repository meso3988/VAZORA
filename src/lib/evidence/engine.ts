import "server-only";

import { excerptIsGrounded, pageOfExcerpt } from "@/lib/evidence/deterministic";
import type { CheckResult, ProviderCheck } from "@/lib/evidence/schema";

/**
 * Pure verification engine — takes parsed evidence text + provider output and
 * produces the rows to persist, the overall verdict, and the gap plan.
 * No I/O, no model calls: fully unit-testable.
 */

export type Criterion = {
  requirementId: string;
  name: string;
  description: string | null;
  evidenceType: string;
  required: boolean;
  obligationId: string | null;
};

export type PlannedCheck = {
  evidenceRequirementId: string | null;
  checkLabel: string;
  checkKind: "deterministic" | "ai_semantic";
  result: CheckResult;
  confidence: number | null;
  reason: string | null;
  sourcePage: number | null;
  sourceLocation: string | null;
  sourceExcerpt: string | null;
};

export type GapDraft = {
  evidenceRequirementId: string;
  gapType: "missing_evidence" | "partial_evidence" | "contradiction" | "quality" | "other";
  description: string;
};

export type VerificationPlan = {
  checks: PlannedCheck[];
  /** requirement ids whose effective result is verified → resolve their gaps */
  resolveRequirementIds: string[];
  /** required criteria that remain unproven → ensure an active gap exists */
  openGapDrafts: GapDraft[];
  overall: "verified" | "partially_verified" | "unverified" | "needs_review" | "unable_to_verify";
  itemStatus: "verified" | "partially_verified" | "needs_review" | "rejected" | "ocr_required";
};

const STRICT_TYPES = new Set(["signature", "acknowledgement", "approval", "certificate"]);

function gapTypeFor(result: CheckResult, contradiction: boolean): GapDraft["gapType"] {
  if (contradiction) return "contradiction";
  if (result === "partial") return "partial_evidence";
  if (result === "needs_human_review" || result === "unable_to_verify") return "other";
  return "missing_evidence";
}

/**
 * Grounding gate — the deterministic half of NO SUPPORT → NO VERIFIED.
 * A provider claim of verified/partial survives only when its excerpt exists
 * verbatim in the evidence text. Otherwise the check is downgraded to
 * needs_human_review with an audit note — never silently kept.
 */
function groundCheck(
  pc: ProviderCheck,
  evidenceText: string,
): { result: CheckResult; note: string | null; page: number | null } {
  if (pc.result !== "verified" && pc.result !== "partial") {
    return { result: pc.result, note: null, page: pc.source_page ?? null };
  }
  const excerpt = pc.source_excerpt?.trim() ?? "";
  if (!excerpt) {
    return { result: "needs_human_review", note: "no_source_support", page: null };
  }
  if (!excerptIsGrounded(evidenceText, excerpt)) {
    return { result: "needs_human_review", note: "source_excerpt_not_found_verbatim", page: null };
  }
  if (pc.result === "verified" && pc.contradiction === true) {
    return { result: "needs_human_review", note: "contradiction_cannot_verify", page: null };
  }
  return { result: pc.result, note: null, page: pc.source_page ?? null };
}

/**
 * Apply a validated provider response to the criterion set.
 *
 * - Checks are emitted per criterion — the document as a whole is never
 *   "verified" in one shot.
 * - Provider checks for unknown/duplicate requirement ids are dropped.
 * - Required criteria the provider omitted get a synthesized
 *   unable_to_verify check — an absent answer is not a pass.
 * - Strict-type criteria (signature/acknowledgement/approval/certificate)
 *   verified claims must ALSO carry a location hint (page or location) —
 *   a bare quote is too easy to fake for approval semantics.
 */
export function applyVerificationOutput(opts: {
  criteria: Criterion[];
  providerChecks: ProviderCheck[];
  evidenceText: string;
  pageOffsets: { page: number; start: number; end: number }[];
  provider: string;
  model: string | null;
}): VerificationPlan {
  const { criteria, providerChecks, evidenceText, pageOffsets } = opts;
  const seen = new Set<string>();
  const byReq = new Map<string, ProviderCheck>();
  for (const pc of providerChecks) {
    if (criteria.some((c) => c.requirementId === pc.requirement_id) && !seen.has(pc.requirement_id)) {
      seen.add(pc.requirement_id);
      byReq.set(pc.requirement_id, pc);
    }
  }

  const checks: PlannedCheck[] = [
    {
      evidenceRequirementId: null,
      checkLabel: "Evidence file is machine-readable",
      checkKind: "deterministic",
      result: "verified",
      confidence: null,
      reason: `${evidenceText.length} characters extracted`,
      sourcePage: null,
      sourceLocation: null,
      sourceExcerpt: null,
    },
  ];
  const resolveRequirementIds: string[] = [];
  const openGapDrafts: GapDraft[] = [];

  for (const criterion of criteria) {
    const pc = byReq.get(criterion.requirementId);

    if (!pc) {
      checks.push({
        evidenceRequirementId: criterion.requirementId,
        checkLabel: criterion.name,
        checkKind: "ai_semantic",
        result: "unable_to_verify",
        confidence: null,
        reason: "provider omitted this required criterion",
        sourcePage: null,
        sourceLocation: null,
        sourceExcerpt: null,
      });
      if (criterion.required) {
        openGapDrafts.push({
          evidenceRequirementId: criterion.requirementId,
          gapType: "other",
          description: `No verification result produced for "${criterion.name}".`,
        });
      }
      continue;
    }

    const grounded = groundCheck(pc, evidenceText);
    let result = grounded.result;
    const reasons = [pc.reason, grounded.note].filter(Boolean);

    // Strict acknowledgement/signature rule — verified additionally needs a
    // concrete location so a human can jump straight to the approval mark.
    if (
      result === "verified" &&
      STRICT_TYPES.has(criterion.evidenceType) &&
      pc.source_page == null &&
      !pc.source_location
    ) {
      result = "needs_human_review";
      reasons.push("strict_type_needs_location");
    }

    const page = grounded.page ?? pageOfExcerpt(evidenceText, pageOffsets, pc.source_excerpt ?? "");

    checks.push({
      evidenceRequirementId: criterion.requirementId,
      checkLabel: criterion.name,
      checkKind: "ai_semantic",
      result,
      confidence: pc.confidence ?? null,
      reason: reasons.join(" | ") || null,
      sourcePage: page,
      sourceLocation: pc.source_location ?? null,
      sourceExcerpt: pc.source_excerpt ?? null,
    });

    if (result === "verified") {
      resolveRequirementIds.push(criterion.requirementId);
    } else if (criterion.required) {
      openGapDrafts.push({
        evidenceRequirementId: criterion.requirementId,
        gapType: gapTypeFor(result, pc.contradiction === true),
        description:
          pc.reason ??
          `Required evidence "${criterion.name}" was ${result} in the submitted file.`,
      });
    }
  }

  const required = criteria.filter((c) => c.required);
  const requiredChecks = checks.filter((c) => required.some((r) => r.requirementId === c.evidenceRequirementId));
  const verifiedReq = requiredChecks.filter((c) => c.result === "verified").length;
  const needsReview = requiredChecks.some(
    (c) => c.result === "needs_human_review" || c.result === "unable_to_verify",
  );

  let overall: VerificationPlan["overall"];
  let itemStatus: VerificationPlan["itemStatus"];
  if (!required.length) {
    overall = "unable_to_verify";
    itemStatus = "needs_review";
  } else if (verifiedReq === required.length) {
    overall = "verified";
    itemStatus = "verified";
  } else if (needsReview) {
    overall = "needs_review";
    itemStatus = "needs_review";
  } else if (verifiedReq > 0) {
    overall = "partially_verified";
    itemStatus = "partially_verified";
  } else {
    overall = "unverified";
    itemStatus = "rejected";
  }

  return { checks, resolveRequirementIds, openGapDrafts, overall, itemStatus };
}

/**
 * Plan when the evidence bytes cannot produce text at all — one deterministic
 * check records WHY, every required criterion gets unable_to_verify, and all
 * linked requirements keep/open gaps. Never fabricate verdicts.
 */
export function planUnreadable(opts: {
  criteria: Criterion[];
  reason: "ocr_required" | "unsupported_type" | "parse_failed";
  fileName: string;
}): VerificationPlan {
  const { criteria, reason, fileName } = opts;
  const checks: PlannedCheck[] = [
    {
      evidenceRequirementId: null,
      checkLabel: "Evidence file is machine-readable",
      checkKind: "deterministic",
      result: "unable_to_verify",
      confidence: null,
      reason: `${fileName}: ${reason}`,
      sourcePage: null,
      sourceLocation: null,
      sourceExcerpt: null,
    },
  ];
  for (const criterion of criteria) {
    checks.push({
      evidenceRequirementId: criterion.requirementId,
      checkLabel: criterion.name,
      checkKind: "ai_semantic",
      result: "unable_to_verify",
      confidence: null,
      reason: `evidence unreadable: ${reason}`,
      sourcePage: null,
      sourceLocation: null,
      sourceExcerpt: null,
    });
  }
  return {
    checks,
    resolveRequirementIds: [],
    openGapDrafts: criteria
      .filter((c) => c.required)
      .map((c) => ({
        evidenceRequirementId: c.requirementId,
        gapType: "quality" as const,
        description: `Evidence "${c.name}" could not be read (${reason}) — upload a machine-readable version.`,
      })),
    overall: "unable_to_verify",
    itemStatus: reason === "ocr_required" ? "ocr_required" : "needs_review",
  };
}
