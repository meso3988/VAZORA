import "server-only";

import type { CitationTarget, OfficerCitation } from "@/domain/officer";
import type { OfficerContext } from "@/lib/officer/context";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Citation resolver / validator.
 *
 * A MODEL-GENERATED CITATION IS NOT TRUSTED. Before anything is persisted or
 * displayed, every citation must:
 *   1. name a known target type
 *   2. be a well-formed id
 *   3. exist
 *   4. belong to the caller's organization (no cross-tenant resolution)
 *
 * Invalid citations are dropped with a recorded reason rather than shown —
 * an unsupported claim must look unsupported, not decorated with a
 * plausible-looking source.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** target → table to verify against; every lookup is organization-scoped. */
const TARGET_TABLE: Record<CitationTarget, string> = {
  contract: "contracts",
  clause: "contract_clauses",
  obligation: "contract_obligations",
  evidence_requirement: "obligation_evidence_requirements",
  evidence_item: "evidence_items",
  evidence_version: "evidence_versions",
  verification_run: "evidence_verification_runs",
  verification_check: "evidence_verification_checks",
  evidence_gap: "evidence_gaps",
  verification_discrepancy: "evidence_verification_discrepancies",
  activity_event: "activity_log",
  officer_memory: "officer_memory",
};

const TARGETS = new Set(Object.keys(TARGET_TABLE) as CitationTarget[]);

export type RejectedCitation = {
  target: string;
  id: string;
  reason: "unknown_target" | "malformed_id" | "not_found_in_organization";
};

export type CitationValidation = {
  valid: OfficerCitation[];
  rejected: RejectedCitation[];
};

/** Deep link for a resolved source, locale-prefixed by the caller's router. */
function hrefFor(target: CitationTarget, row: any): string | null {
  const contractId = row?.contract_id ?? null;
  switch (target) {
    case "contract":
      return `/app/contracts/${row.id}`;
    case "clause":
      return contractId ? `/app/contracts/${contractId}` : null;
    case "obligation":
      return contractId ? `/app/contracts/${contractId}/obligations` : null;
    case "evidence_gap":
      return contractId ? `/app/contracts/${contractId}/evidence` : null;
    case "evidence_item":
      return `/app/evidence/${row.id}`;
    case "evidence_version":
      return row?.evidence_item_id ? `/app/evidence/${row.evidence_item_id}` : null;
    case "verification_discrepancy":
      return row?.evidence_item_id ? `/app/evidence/${row.evidence_item_id}` : null;
    case "verification_run":
      return row?.evidence_item_id ? `/app/evidence/${row.evidence_item_id}` : null;
    case "verification_check":
      return null; // rendered inside its run
    case "evidence_requirement":
    case "activity_event":
    case "officer_memory":
      return null;
  }
}

/** Columns worth selecting per target for labelling and linking. */
const SELECT: Partial<Record<CitationTarget, string>> = {
  contract: "id, contract_id:id, contract_number, title",
  clause: "id, contract_id, clause_number, heading",
  obligation: "id, contract_id, title",
  evidence_requirement: "id, name, obligation_id",
  evidence_item: "id, contract_id, title",
  evidence_version: "id, evidence_item_id, version_number, file_name",
  verification_run: "id, evidence_item_id, evidence_version_id, overall_result",
  verification_check: "id, verification_run_id, check_label, result",
  evidence_gap: "id, contract_id, gap_type, status",
  verification_discrepancy: "id, evidence_item_id, prior_result, current_result, status",
  activity_event: "id, event_type, created_at",
  officer_memory: "id, kind, content",
};

function labelFor(target: CitationTarget, row: any, fallback: string): string {
  switch (target) {
    case "contract": return `${row.contract_number} — ${row.title}`;
    case "clause": return row.clause_number ? `Clause ${row.clause_number}` : (row.heading ?? fallback);
    case "obligation": return row.title ?? fallback;
    case "evidence_requirement": return row.name ?? fallback;
    case "evidence_item": return row.title ?? fallback;
    case "evidence_version": return `v${row.version_number} — ${row.file_name}`;
    case "verification_run": return `Verification run ${String(row.id).slice(0, 8)}`;
    case "verification_check": return row.check_label ?? fallback;
    case "evidence_gap": return `${row.gap_type} gap`;
    case "verification_discrepancy": return `${row.prior_result} → ${row.current_result}`;
    case "activity_event": return row.event_type ?? fallback;
    case "officer_memory": return `Memory: ${String(row.content ?? "").slice(0, 60)}`;
    default: return fallback;
  }
}

/**
 * Validate a batch of citations against live, tenant-scoped state.
 *
 * Ids are grouped per target so one query per target is enough; a row that
 * does not come back simply does not exist FOR THIS ORGANIZATION — the
 * distinction between "absent" and "another tenant's" is deliberately not
 * exposed to the caller.
 */
export async function validateCitations(
  ctx: OfficerContext,
  candidates: { target: string; id: string; label?: string }[],
): Promise<CitationValidation> {
  const valid: OfficerCitation[] = [];
  const rejected: RejectedCitation[] = [];
  if (!candidates.length) return { valid, rejected };

  const byTarget = new Map<CitationTarget, Set<string>>();
  for (const c of candidates) {
    const target = c.target as CitationTarget;
    if (!TARGETS.has(target)) {
      rejected.push({ target: c.target, id: c.id, reason: "unknown_target" });
      continue;
    }
    if (!UUID.test(String(c.id ?? ""))) {
      rejected.push({ target: c.target, id: String(c.id ?? ""), reason: "malformed_id" });
      continue;
    }
    byTarget.set(target, (byTarget.get(target) ?? new Set()).add(c.id));
  }

  const resolved = new Map<string, any>();
  for (const [target, ids] of byTarget) {
    const { data } = await ctx.supabase
      .from(TARGET_TABLE[target])
      .select(SELECT[target] ?? "id")
      .eq("organization_id", ctx.organizationId)
      .in("id", [...ids]);
    for (const row of (data ?? []) as any[]) resolved.set(`${target}:${row.id}`, row);
  }

  const seen = new Set<string>();
  for (const c of candidates) {
    const target = c.target as CitationTarget;
    if (!TARGETS.has(target) || !UUID.test(String(c.id ?? ""))) continue;
    const key = `${target}:${c.id}`;
    const row = resolved.get(key);
    if (!row) {
      rejected.push({ target: c.target, id: c.id, reason: "not_found_in_organization" });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({
      target,
      id: c.id,
      label: labelFor(target, row, c.label ?? c.id.slice(0, 8)),
      contractId: (row.contract_id as string | null) ?? null,
      href: hrefFor(target, row),
    });
  }
  return { valid, rejected };
}
