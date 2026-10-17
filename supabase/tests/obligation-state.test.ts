// Obligation state — lifecycle, deadline and effective evidence kept separate.
// Rows are built with the real effectiveStatusForRequirement, so pending /
// retained / confirmed discrepancies follow the production rules.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/obligation-state.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CheckResult, EvidenceMatrixRow, VerificationDiscrepancyView } from "../../src/domain/evidence";
import { effectiveStatusForRequirement } from "../../src/domain/effective-status";
import { obligationEvidence, obligationStates } from "../../src/domain/obligation-state";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, "..", "..", rel), "utf8");

function row(opts: {
  ob: string; req: string; required?: boolean; latest: CheckResult | null;
  gap?: "open" | "evidence_received" | "reverification_pending"; discrepancies?: VerificationDiscrepancyView[];
}): EvidenceMatrixRow {
  return {
    requirement: { id: opts.req, obligationId: opts.ob, name: opts.req, description: null, evidenceType: "document", required: opts.required ?? true },
    obligation: { id: opts.ob, title: opts.ob, requirementText: "", clauseRef: null, clauseText: null, clausePage: null, documentId: null, dueContext: null },
    linkedItemCount: 1, latestResult: opts.latest, latestItemId: null, latestItemStatus: null, effectiveHuman: false,
    gap: opts.gap ? ({ status: opts.gap } as EvidenceMatrixRow["gap"]) : null,
    effective: effectiveStatusForRequirement({ requirementId: opts.req, latestResult: opts.latest, latestVersionId: "v1", humanOverridden: false, discrepancies: opts.discrepancies ?? [] }),
  };
}
const disc = (req: string, status: VerificationDiscrepancyView["status"]): VerificationDiscrepancyView => ({
  id: `d-${req}`, requirementId: req, evidenceVersionId: "v1", priorResult: "verified", currentResult: "needs_human_review",
  priorCheckId: "c0", currentCheckId: "c1", priorRunId: "r0", currentRunId: "r1", provider: null, model: null,
  status, resolvedBy: null, resolvedAt: null, resolutionNote: null, createdAt: "2026-10-01T00:00:00Z",
});

async function main() {
  const TODAY = "2026-10-04";
  const obligations = [
    { id: "missing", dueDate: "2026-10-20", lifecycle: "active" as const },
    { id: "verified", dueDate: "2026-10-20", lifecycle: "active" as const },
    { id: "late-verified", dueDate: "2026-09-30", lifecycle: "active" as const },
    { id: "prior", dueDate: "2026-10-20", lifecycle: "active" as const },
    { id: "none", dueDate: "", lifecycle: "approved_not_active" as const },
  ];
  const matrix = [
    row({ ob: "missing", req: "m1", latest: "missing", gap: "open" }),
    row({ ob: "verified", req: "v1", latest: "verified" }),
    row({ ob: "late-verified", req: "lv1", latest: "verified" }),
    row({ ob: "prior", req: "p1", latest: "needs_human_review", discrepancies: [disc("p1", "pending")] }),
    row({ ob: "prior", req: "p2", latest: "verified" }),
  ];
  const s = obligationStates(obligations, matrix, TODAY);

  check("active + evidence missing: lifecycle active, evidence missing (never verified)",
    s.get("missing")!.lifecycle === "active" && s.get("missing")!.evidence.state === "missing");
  check("active + verified evidence: evidence verified, deadline independent",
    s.get("verified")!.evidence.state === "verified" && s.get("verified")!.deadline.window === "monitoring");
  const lv = s.get("late-verified")!;
  check("overdue + verified: deadline overdue AND evidence verified (lateness is not a verification failure)",
    lv.deadline.window === "overdue" && lv.evidence.state === "verified" && (lv.deadline as { daysOverdue: number }).daysOverdue === 4);
  const p = s.get("prior")!;
  check("pending discrepancy: prior verified state stays in force and is flagged", p.evidence.state === "verified" && p.evidence.priorStateInForce);
  check("no requirements recorded: declared state, not verified", s.get("none")!.evidence.state === "no_requirements" && s.get("none")!.lifecycle === "approved_not_active");
  check("no normalized due date → no_due_date window", s.get("none")!.deadline.window === "no_due_date");

  const failedRead = obligationStates(obligations, null, TODAY);
  check("evidence read failure → every evidence state unavailable", [...failedRead.values()].every((x) => x.evidence.state === "unavailable"));
  const noClock = obligationStates(obligations, matrix, null);
  check("org clock unavailable → deadline unknown, evidence unaffected", [...noClock.values()].every((x) => x.deadline.window === "unknown") && noClock.get("verified")!.evidence.state === "verified");

  check("confirmed regression demotes the state (not held)",
    obligationEvidence([row({ ob: "x", req: "r", latest: "partial", discrepancies: [{ ...disc("r", "regression_confirmed"), currentResult: "partial" }] })]).state === "partial");
  check("retained prior (kept_prior) stays verified and in force",
    (() => { const e = obligationEvidence([row({ ob: "x", req: "r", latest: "needs_human_review", discrepancies: [disc("r", "kept_prior")] })]); return e.state === "verified" && e.priorStateInForce; })());
  check("upload alone (gap evidence_received) is not verified",
    obligationEvidence([row({ ob: "x", req: "r", latest: "verified", gap: "evidence_received" })]).state === "awaiting_verification");
  check("open gap overrides an older verified result", obligationEvidence([row({ ob: "x", req: "r", latest: "verified", gap: "open" })]).state === "missing");
  check("needs_human_review without a holding discrepancy → needs_review", obligationEvidence([row({ ob: "x", req: "r", latest: "needs_human_review" })]).state === "needs_review");
  check("not_applicable does not block", obligationEvidence([row({ ob: "x", req: "r", latest: "not_applicable" })]).state === "verified");
  check("optional requirement ignored for the state", obligationEvidence([row({ ob: "x", req: "a", latest: "verified" }), row({ ob: "x", req: "b", required: false, latest: "missing" })]).state === "verified");
  const mixed = obligationEvidence([row({ ob: "x", req: "a", latest: "verified" }), row({ ob: "x", req: "b", latest: "partial" }), row({ ob: "x", req: "c", latest: null })]);
  check("worst requirement wins (missing over partial); counts reported", mixed.state === "missing" && mixed.required === 3 && mixed.satisfied === 1);

  // ---- wiring ----
  const provider = src("src/data/supabase/provider.ts");
  check("provider no longer maps activation to verified", !/activation_status === "active" \? "verified"/.test(provider) && provider.includes('lifecycle: row.activation_status === "active"'));
  const table = src("src/components/app/tables.tsx");
  check("obligations table renders the three states for live rows", table.includes("<ObligationStateBadges state={o.state} />"));
  check("obligations table: live evidence column from requirements, not an empty link list", table.includes('os("satisfied"'));
  check("obligations tab reads states from the evidence matrix", src("src/app/[locale]/app/contracts/[id]/obligations/page.tsx").includes("readObligationStates"));
  const overview = src("src/app/[locale]/app/contracts/[id]/page.tsx");
  check("overview: live chart counts effective evidence states", overview.includes("byEvidence") && overview.includes("obligationState.chartTitle"));
  check("clause trace: live verification slot is the evidence state", src("src/components/app/clause-trace.tsx").includes("<EvidenceStatePill state={obligation.state} />"));
  check("helper uses the existing evidence matrix", src("src/data/obligation-states.ts").includes("getContractEvidenceMatrix"));
  for (const l of ["en", "ar"]) {
    const m = JSON.parse(src(`src/messages/${l}.json`)).app.obligationState;
    check(`${l}: lifecycle/deadline/evidence copy present`, !!m?.lifecycle?.active && !!m?.deadline?.overdue && !!m?.evidence?.no_requirements && !!m?.evidence?.unavailable && !!m?.priorInForce);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
