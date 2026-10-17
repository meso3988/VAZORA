import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarDate } from "@/lib/officer/time";

/** One recorded completion of one obligation cycle (migration 0015). */
export type CycleSettlement = {
  id: string;
  obligationId: string;
  cycleDueDate: CalendarDate;
  completedOn: CalendarDate | null;
  note: string;
  evidenceItemId: string | null;
  evidenceVersionId: string | null;
  recordedBy: string;
  recordedAt: string;
  status: "active" | "voided";
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

export type SettlementsRead = { ok: true; byObligation: Map<string, CycleSettlement[]> } | { ok: false };

const READ_LIMIT = 2000;

/**
 * Settlements (active and voided) for the given obligations of one
 * organization. A failed or truncated read is { ok: false } — never "no
 * settlements", which would silently claim nothing was recorded.
 */
export async function readCycleSettlements(
  supabase: SupabaseClient,
  organizationId: string,
  obligationIds: string[],
): Promise<SettlementsRead> {
  if (!obligationIds.length) return { ok: true, byObligation: new Map() };
  try {
    const { data, error } = await supabase
      .from("obligation_cycle_settlements")
      .select("id, obligation_id, cycle_due_date, completed_on, note, evidence_item_id, evidence_version_id, recorded_by, recorded_at, status, voided_by, voided_at, void_reason")
      .eq("organization_id", organizationId)
      .in("obligation_id", obligationIds)
      .order("cycle_due_date", { ascending: true })
      .limit(READ_LIMIT + 1);
    if (error || !Array.isArray(data) || data.length > READ_LIMIT) return { ok: false };
    const byObligation = new Map<string, CycleSettlement[]>();
    for (const r of data as Record<string, string | null>[]) {
      const s: CycleSettlement = {
        id: r.id!, obligationId: r.obligation_id!, cycleDueDate: r.cycle_due_date!, completedOn: r.completed_on,
        note: r.note ?? "", evidenceItemId: r.evidence_item_id, evidenceVersionId: r.evidence_version_id,
        recordedBy: r.recorded_by!, recordedAt: r.recorded_at!, status: r.status === "voided" ? "voided" : "active",
        voidedBy: r.voided_by, voidedAt: r.voided_at, voidReason: r.void_reason,
      };
      byObligation.set(s.obligationId, [...(byObligation.get(s.obligationId) ?? []), s]);
    }
    return { ok: true, byObligation };
  } catch {
    return { ok: false };
  }
}

/** Active settled cycle dates for the schedule; null when the read failed. */
export function settledCyclesOf(read: SettlementsRead, obligationId: string): CalendarDate[] | null {
  if (!read.ok) return null;
  return (read.byObligation.get(obligationId) ?? []).filter((s) => s.status === "active").map((s) => s.cycleDueDate);
}
