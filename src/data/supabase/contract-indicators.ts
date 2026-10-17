import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  liveIndicatorsFromRows,
  liveIndicatorsInState,
  type ContractIndicators,
  type IndicatorContract,
  type OperationalObligationRow,
} from "@/domain/indicators";
import { readCycleSettlements, settledCyclesOf } from "@/data/supabase/cycle-settlements";
import { usesCycleSettlements } from "@/lib/officer/schedule";
import type { CalendarDate } from "@/lib/officer/time";

export const INDICATOR_READ_LIMIT = 1000;

/**
 * Live contract indicators from the operational obligations of the caller's
 * organization (approved + active — the Officer's definition). A failed read
 * marks every count unavailable and a truncated read marks them incomplete:
 * neither is ever reported as zero.
 */
export async function readLiveContractIndicators(
  supabase: SupabaseClient,
  organizationId: string,
  contracts: IndicatorContract[],
  clock: { today: CalendarDate; endOfMonth: CalendarDate },
): Promise<Map<string, ContractIndicators>> {
  const contractIds = contracts.map((c) => c.id);
  const all = (state: "unavailable" | "incomplete") =>
    new Map(contractIds.map((id) => [id, liveIndicatorsInState(state)]));
  if (!contractIds.length) return new Map();
  try {
    const { data, error } = await supabase
      .from("contract_obligations")
      .select("id, contract_id, due_date_normalized, due_rule_normalized, frequency")
      .eq("organization_id", organizationId)
      .eq("review_status", "approved")
      .eq("activation_status", "active")
      .in("contract_id", contractIds)
      .limit(INDICATOR_READ_LIMIT + 1);
    if (error || !Array.isArray(data)) return all("unavailable");
    if (data.length > INDICATOR_READ_LIMIT) return all("incomplete");
    const rows = data as OperationalObligationRow[];
    const recurring = rows.filter((r) => usesCycleSettlements({ dueDateNormalized: r.due_date_normalized, dueRuleNormalized: r.due_rule_normalized })).map((r) => r.id!);
    const settlements = await readCycleSettlements(supabase, organizationId, recurring);
    return liveIndicatorsFromRows(contracts, rows, clock, (id) => settledCyclesOf(settlements, id));
  } catch {
    return all("unavailable");
  }
}
