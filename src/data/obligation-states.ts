import "server-only";

import { getContractEvidenceMatrix } from "@/data/supabase/evidence-detail";
import { obligationStates, type ObligationState } from "@/domain/obligation-state";
import type { Obligation } from "@/domain/types";
import { buildOfficerContext } from "@/lib/officer/context";
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
  userId: string;
  locale: string;
}): Promise<Map<string, ObligationState> | null> {
  if (opts.isDemo) return null;
  let today: string | null = null;
  let matrix: Awaited<ReturnType<typeof getContractEvidenceMatrix>> = { ok: false };
  try {
    const supabase = await createSupabaseServer();
    const [ctx, read] = await Promise.all([
      buildOfficerContext({ supabase, organizationId: opts.orgId, userId: opts.userId, locale: opts.locale }),
      getContractEvidenceMatrix(opts.orgId, opts.contractId, supabase),
    ]);
    today = ctx?.clock.today ?? null;
    matrix = read;
  } catch {
    // both stay in their failure state: deadline unknown, evidence unavailable
  }
  return obligationStates(opts.obligations, matrix.ok ? matrix.rows : null, today);
}

/** Attach live states (when present) without touching demo fixtures. */
export const withStates = (obligations: Obligation[], states: Map<string, ObligationState> | null): Obligation[] =>
  states ? obligations.map((o) => ({ ...o, state: states.get(o.id) })) : obligations;
