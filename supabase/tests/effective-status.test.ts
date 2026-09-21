// Phase 3 UX consistency patch — effective-operational-state projection.
// Pure unit tests (no DB, no LLM): EFFECTIVE OPERATIONAL STATE must never
// collapse into LATEST VERIFICATION RESULT.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/effective-status.test.ts

import {
  effectiveItemStatus,
  effectiveStatusForRequirement,
} from "../../src/domain/effective-status";
import type { VerificationDiscrepancyView } from "../../src/domain/evidence";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} — ${detail}`); }
}

const REQ = "req-1";
const V1 = "ver-1";
const V2 = "ver-2";

const disc = (over: Partial<VerificationDiscrepancyView> = {}): VerificationDiscrepancyView => ({
  id: "d1",
  requirementId: REQ,
  evidenceVersionId: V1,
  priorResult: "verified",
  currentResult: "needs_human_review",
  priorCheckId: "c1",
  currentCheckId: "c2",
  priorRunId: "r1",
  currentRunId: "r2",
  provider: "qa",
  model: "qa-model",
  status: "pending",
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: "2025-01-01T00:00:00Z",
  ...over,
});

// ---- A. pending discrepancy holds the prior verified state ---------------
{
  const e = effectiveStatusForRequirement({
    requirementId: REQ,
    latestResult: "needs_human_review",
    latestVersionId: V1,
    humanOverridden: false,
    discrepancies: [disc()],
  });
  check("a1-operational-stays-verified", e.operational === "verified", `got ${e.operational}`);
  check("a2-latest-shown-honestly", e.latest === "needs_human_review", `got ${e.latest}`);
  check("a3-prior-in-force", e.priorStateInForce === true);
  check("a4-status-pending", e.discrepancyStatus === "pending");
}

// ---- B. kept_prior keeps the state in force, attributed to the human -----
{
  const e = effectiveStatusForRequirement({
    requirementId: REQ,
    latestResult: "partial",
    latestVersionId: V1,
    humanOverridden: false,
    discrepancies: [disc({ status: "kept_prior", currentResult: "partial" })],
  });
  check("b1-operational-verified", e.operational === "verified", `got ${e.operational}`);
  check("b2-source-retained", e.source === "prior_verified_retained", `got ${e.source}`);
  check("b3-latest-preserved", e.latest === "partial");
}

// ---- C. confirmed regression moves the operational state down ------------
{
  const e = effectiveStatusForRequirement({
    requirementId: REQ,
    latestResult: "needs_human_review",
    latestVersionId: V1,
    humanOverridden: false,
    discrepancies: [disc({ status: "regression_confirmed" })],
  });
  check("c1-operational-follows-latest", e.operational === "needs_human_review", `got ${e.operational}`);
  check("c2-not-in-force", e.priorStateInForce === false);
  check("c3-human-attribution", e.source === "human_confirmed_regression", `got ${e.source}`);
}

// ---- D. NEW version is judged on its own merits, never protected ---------
{
  const e = effectiveStatusForRequirement({
    requirementId: REQ,
    latestResult: "missing",
    latestVersionId: V2, // v1 discrepancy must not shield v2
    humanOverridden: false,
    discrepancies: [disc({ evidenceVersionId: V1 })],
  });
  check("d1-new-version-not-protected", e.operational === "missing", `got ${e.operational}`);
  check("d2-no-hold", e.priorStateInForce === false);
  check("d3-no-discrepancy-status", e.discrepancyStatus === null, `got ${e.discrepancyStatus}`);
}

// ---- E. unrelated requirement's discrepancy never leaks ------------------
{
  const e = effectiveStatusForRequirement({
    requirementId: "req-other",
    latestResult: "missing",
    latestVersionId: V1,
    humanOverridden: false,
    discrepancies: [disc()],
  });
  check("e1-scoped-by-requirement", e.operational === "missing" && !e.priorStateInForce, `got ${e.operational}`);
}

// ---- F. no discrepancy → operational equals latest -----------------------
{
  const verified = effectiveStatusForRequirement({
    requirementId: REQ, latestResult: "verified", latestVersionId: V1,
    humanOverridden: false, discrepancies: [],
  });
  check("f1-plain-verified", verified.operational === "verified" && verified.source === "verification_run");

  const overridden = effectiveStatusForRequirement({
    requirementId: REQ, latestResult: "verified", latestVersionId: V1,
    humanOverridden: true, discrepancies: [],
  });
  check("f2-human-override-source", overridden.source === "human_override", `got ${overridden.source}`);

  const none = effectiveStatusForRequirement({
    requirementId: REQ, latestResult: null, latestVersionId: null,
    humanOverridden: false, discrepancies: [],
  });
  check("f3-never-verified", none.operational === null && none.source === "none");
}

// ---- G. a verified latest result is never "held" -------------------------
{
  const e = effectiveStatusForRequirement({
    requirementId: REQ, latestResult: "verified", latestVersionId: V1,
    humanOverridden: false, discrepancies: [disc()],
  });
  check("g1-verified-not-held", e.priorStateInForce === false && e.operational === "verified");
}

// ---- H. item-level projection -------------------------------------------
{
  check("h1-pending-no-gaps-verified",
    effectiveItemStatus({ runStatus: "needs_review", heldDiscrepancyCount: 1, openGapCount: 0 }) === "verified");
  check("h2-open-gap-wins",
    effectiveItemStatus({ runStatus: "needs_review", heldDiscrepancyCount: 1, openGapCount: 1 }) === "needs_review");
  check("h3-no-discrepancy-passthrough",
    effectiveItemStatus({ runStatus: "partially_verified", heldDiscrepancyCount: 0, openGapCount: 0 }) === "partially_verified");
  check("h4-rejected-never-upgraded",
    effectiveItemStatus({ runStatus: "rejected", heldDiscrepancyCount: 1, openGapCount: 0 }) === "rejected");
  // A human who retained the prior state must not cause a regression —
  // kept_prior counts as held, exactly like pending.
  check("h5-kept-prior-still-verified",
    effectiveItemStatus({ runStatus: "needs_review", heldDiscrepancyCount: 1, openGapCount: 0 }) === "verified");
}

console.log(`\neffective-status tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
