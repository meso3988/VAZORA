import "server-only";

import { DEMO_TODAY } from "@/data/mock/organization";
import { readLiveContractIndicators } from "@/data/supabase/contract-indicators";
import { demoIndicators, liveIndicatorsInState, type ContractIndicators } from "@/domain/indicators";
import type { Contract } from "@/domain/types";
import { buildOfficerContext } from "@/lib/officer/context";
import { createSupabaseServer } from "@/lib/supabase/server";

export type ContractIndicatorsRead = {
  /** the organization's local date, or null when it could not be resolved */
  today: string | null;
  byContract: Map<string, ContractIndicators>;
};

/**
 * Indicators for the contracts a page already read. Demo sessions keep their
 * illustrative fixture figures; live sessions count from the database in the
 * organization's own clock (the same clock the Officer uses).
 */
export async function readContractIndicators(opts: {
  isDemo: boolean;
  contracts: Contract[];
  orgId: string;
  userId: string;
  locale: string;
}): Promise<ContractIndicatorsRead> {
  const { contracts } = opts;
  if (opts.isDemo) {
    return {
      today: DEMO_TODAY,
      byContract: new Map(contracts.map((c) => [c.id, c.health ? demoIndicators(c.health) : liveIndicatorsInState("unavailable")])),
    };
  }
  const unavailable = { today: null, byContract: new Map(contracts.map((c) => [c.id, liveIndicatorsInState("unavailable")])) };
  try {
    const supabase = await createSupabaseServer();
    const ctx = await buildOfficerContext({ supabase, organizationId: opts.orgId, userId: opts.userId, locale: opts.locale });
    if (!ctx) return unavailable;
    const byContract = await readLiveContractIndicators(supabase, opts.orgId, contracts.map((c) => ({ id: c.id, startDate: c.startDate, endDate: c.endDate })), ctx.clock);
    return { today: ctx.clock.today, byContract };
  } catch {
    return unavailable;
  }
}
