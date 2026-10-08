import "server-only";

import { readCycleSettlements, settledCyclesOf, type SettlementsRead } from "@/data/supabase/cycle-settlements";
import { getContractEvidenceMatrix } from "@/data/supabase/evidence-detail";
import { obligationStates, type ObligationState } from "@/domain/obligation-state";
import type { Obligation } from "@/domain/types";
import { buildOfficerContext } from "@/lib/officer/context";
import { usesCycleSettlements } from "@/lib/officer/schedule";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Live obligation states for one contract, from the existing evidence matrix
 * (effective verification, gaps, discrepancies) and the organization clock.
 * Demo sessions return null — their fixtures carry an illustrative status.
 */
export async function readObligationStates(opts: {
  isDemo: boolean;
  obligations: Obligation[];
  orgId: string;
  contractId: string;
  /** contract period: the schedule start for recurring rules */
  contract: { startDate?: string | null; endDate?: string | null };
  userId: string;
  locale: string;
}): Promise<ObligationStatesRead | null> {
  if (opts.isDemo) return null;
  let today: string | null = null;
  let matrix: Awaited<ReturnType<typeof getContractEvidenceMatrix>> = { ok: false };
  let settlements: SettlementsRead = { ok: false };
  const recurring = opts.obligations
    .filter((o) => usesCycleSettlements({ dueDateNormalized: o.dueDate || null, dueRuleNormalized: o.dueRuleNormalized }))
    .map((o) => o.id);
  try {
    const supabase = await createSupabaseServer();
    const [ctx, read, settled] = await Promise.all([
      buildOfficerContext({ supabase, organizationId: opts.orgId, userId: opts.userId, locale: opts.locale }),
      getContractEvidenceMatrix(opts.orgId, opts.contractId, supabase),
      readCycleSettlements(supabase, opts.orgId, recurring),
    ]);
    today = ctx?.clock.today ?? null;
    matrix = read;
    settlements = settled;
  } catch {
    // all stay in their failure state: deadline unknown, evidence unavailable,
    // settlements unknown
  }
  return {
    states: obligationStates(opts.obligations, matrix.ok ? matrix.rows : null, today, opts.contract, (id) => settledCyclesOf(settlements, id)),
    settlements,
    today,
  };
}

export type ObligationStatesRead = {
  states: Map<string, ObligationState>;
  /** cycle completion records of the recurring obligations (0015) */
  settlements: SettlementsRead;
  /** organization-local date, or null when the clock could not be resolved */
  today: string | null;
};

/** Attach live states (when present) without touching demo fixtures. */
export const withStates = (obligations: Obligation[], read: ObligationStatesRead | null): Obligation[] =>
  read ? obligations.map((o) => ({ ...o, state: read.states.get(o.id) })) : obligations;
