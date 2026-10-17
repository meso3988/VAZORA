import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Clause } from "@/domain/types";

/**
 * Clause set for the contract overview. The operational display baseline is
 * the ACTIVATED analysis run ("approved"). When no approved baseline exists
 * but a newer analysis awaits review, its clauses may be shown — but callers
 * receive basis="ready_for_review" so the UI must label them as an
 * unapproved extraction, never as the working baseline.
 *
 * A failed read returns {ok:false} — a dropped baseline query never falls
 * back to an unapproved run silently.
 */

export type ClauseBasis = "approved" | "ready_for_review";

export type ClauseListResult =
  | { ok: true; clauses: Clause[]; basis: ClauseBasis | null }
  | { ok: false };

type ClauseRow = {
  id: string;
  clause_number: string | null;
  heading: string | null;
  text: string;
  page_number: number | null;
};

export async function listContractClauses(
  supabase: SupabaseClient,
  organizationId: string,
  contractId: string,
): Promise<ClauseListResult> {
  try {
    const { data: runs, error: runError } = await supabase
      .from("contract_ingestion_runs")
      .select("id, status")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .in("status", ["approved", "ready_for_review"])
      .order("created_at", { ascending: false })
      .limit(50);
    if (runError || !Array.isArray(runs)) return { ok: false };

    // Approved baseline wins over a newer pending-review run — the pending
    // extraction is never a substitute for the operative baseline.
    const approved = runs.find((r) => r.status === "approved");
    const pending = runs.find((r) => r.status === "ready_for_review");
    const run = approved ?? pending;
    if (!run) return { ok: true, clauses: [], basis: null };
    const basis: ClauseBasis = run.status === "approved" ? "approved" : "ready_for_review";

    const { data, error } = await supabase
      .from("contract_clauses")
      .select("id, clause_number, heading, text, page_number, sequence_number")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .eq("ingestion_run_id", run.id)
      .order("sequence_number", { ascending: true })
      .order("id", { ascending: true });
    if (error || !Array.isArray(data)) return { ok: false };
    return {
      ok: true,
      basis,
      clauses: (data as ClauseRow[]).map((c) => ({
        id: c.id,
        contractId,
        ref: c.clause_number ?? "",
        heading: { en: c.heading ?? "", ar: c.heading ?? "" },
        excerpt: { en: c.text, ar: c.text },
        page: c.page_number ?? 0,
      })),
    };
  } catch {
    return { ok: false };
  }
}
