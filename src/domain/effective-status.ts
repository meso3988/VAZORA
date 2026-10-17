import type {
  CheckResult,
  EffectiveEvidenceStatus,
  EvidenceItemStatus,
  VerificationDiscrepancyView,
} from "@/domain/evidence";

/**
 * Projection of EFFECTIVE OPERATIONAL STATE from verification history.
 *
 * Pure — no I/O, no framework. The single place that answers "what should
 * the organization act on?" so the UI (and later the AI Contract Officer)
 * never has to re-derive it from raw model output.
 *
 * The invariant this enforces: a weaker model result on an UNCHANGED
 * evidence version does not demote the operational state. The prior
 * accepted result stays in force until a new version is uploaded or an
 * authorized human confirms the regression.
 */

/** Anything below "verified" — the set that can trigger a discrepancy. */
const WEAKER_THAN_VERIFIED = new Set<CheckResult>([
  "partial", "missing", "not_found", "needs_human_review", "unable_to_verify",
]);

export function isWeakerThanVerified(result: CheckResult | null): boolean {
  return result != null && WEAKER_THAN_VERIFIED.has(result);
}

/**
 * Discrepancies that still hold a prior verified state in force: awaiting
 * review, or explicitly retained by an authorized human. A confirmed
 * regression does NOT hold — the human accepted the weaker reality.
 */
function holdingDiscrepancy(
  discrepancies: VerificationDiscrepancyView[],
  requirementId: string,
  latestVersionId: string | null,
): VerificationDiscrepancyView | null {
  return (
    discrepancies.find(
      (d) =>
        d.requirementId === requirementId &&
        (d.status === "pending" || d.status === "kept_prior") &&
        // Scoped to the version the latest run actually examined: a new
        // version is new evidence and must re-verify on its own merits.
        (latestVersionId == null || d.evidenceVersionId === latestVersionId),
    ) ?? null
  );
}

/**
 * Effective status for ONE criterion.
 *
 * @param latestResult  newest check result (human override already applied)
 * @param latestVersionId  version the newest run examined — null when unknown
 */
export function effectiveStatusForRequirement(opts: {
  requirementId: string;
  latestResult: CheckResult | null;
  latestVersionId: string | null;
  humanOverridden: boolean;
  discrepancies: VerificationDiscrepancyView[];
}): EffectiveEvidenceStatus {
  const { requirementId, latestResult, latestVersionId, humanOverridden, discrepancies } = opts;

  const held = isWeakerThanVerified(latestResult)
    ? holdingDiscrepancy(discrepancies, requirementId, latestVersionId)
    : null;

  if (held) {
    return {
      operational: held.priorResult,
      latest: latestResult,
      priorStateInForce: true,
      discrepancyStatus: held.status,
      source: held.status === "kept_prior" ? "prior_verified_retained" : "verification_run",
    };
  }

  // A confirmed regression is attributed to the human who confirmed it —
  // the operational state genuinely moved to the weaker result.
  const confirmed = discrepancies.find(
    (d) => d.requirementId === requirementId && d.status === "regression_confirmed",
  );

  return {
    operational: latestResult,
    latest: latestResult,
    priorStateInForce: false,
    discrepancyStatus: confirmed ? "regression_confirmed" : null,
    source:
      latestResult == null ? "none"
      : confirmed ? "human_confirmed_regression"
      : humanOverridden ? "human_override"
      : "verification_run",
  };
}

/**
 * Effective ITEM status for the inbox and inspector. `runStatus` is the
 * stored evidence_items.status (the newest run's verdict).
 *
 * `heldDiscrepancyCount` counts discrepancies that still hold a prior
 * verified state — awaiting review OR explicitly retained by a human. Both
 * keep the item operationally verified; a retained decision is if anything
 * *stronger* than a pending one, so excluding kept_prior here would make an
 * item regress the moment a reviewer said "keep the previous state".
 */
export function effectiveItemStatus(opts: {
  runStatus: EvidenceItemStatus;
  heldDiscrepancyCount: number;
  openGapCount: number;
}): EvidenceItemStatus {
  const { runStatus, heldDiscrepancyCount, openGapCount } = opts;
  if (heldDiscrepancyCount > 0 && openGapCount === 0 && runStatus !== "rejected") {
    return "verified";
  }
  return runStatus;
}
