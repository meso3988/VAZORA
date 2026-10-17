import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { OfficerActionView } from "@/domain/officer";

/**
 * Checked reader for the officer work queue. /app/tasks, the contract
 * officer tab and the overview feed all read the same officer_actions rows
 * the conversation proposes against — one record, three surfaces.
 *
 * Failure is explicit ({ok:false}); a caller must never render an
 * unavailable read as an empty queue.
 */

export const OFFICER_ACTION_READ_LIMIT = 100;

export type OfficerQueueRead =
  | { ok: true; actions: OfficerActionView[]; truncated: boolean }
  | { ok: false };

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function mapOfficerActionRow(row: any): OfficerActionView {
  return {
    id: row.id,
    contractId: row.contract_id,
    obligationId: row.obligation_id,
    conversationId: row.conversation_id,
    actionType: row.action_type,
    arguments: row.arguments ?? {},
    reason: row.reason,
    citations: row.citations ?? [],
    riskLevel: row.risk_level,
    requiresApproval: row.requires_approval,
    status: row.status,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    executedAt: row.executed_at,
    executionResult: row.execution_result,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export async function listOfficerActions(
  supabase: SupabaseClient,
  organizationId: string,
  opts: { contractId?: string; statuses?: string[]; limit?: number } = {},
): Promise<OfficerQueueRead> {
  const limit = Math.min(opts.limit ?? OFFICER_ACTION_READ_LIMIT, OFFICER_ACTION_READ_LIMIT);
  try {
    let q = supabase
      .from("officer_actions")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit + 1);
    if (opts.contractId) q = q.eq("contract_id", opts.contractId);
    if (opts.statuses?.length) q = q.in("status", opts.statuses);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return { ok: false };
    const truncated = data.length > limit;
    return { ok: true, truncated, actions: (truncated ? data.slice(0, limit) : data).map(mapOfficerActionRow) };
  } catch {
    return { ok: false };
  }
}
