import "server-only";

import type { OfficerActionStatus } from "@/domain/officer";
import { authorizeAction, classifyAction } from "@/lib/officer/authority";
import type { OfficerContext } from "@/lib/officer/context";

/**
 * Officer action lifecycle.
 *
 *   suggested / waiting_for_approval → approved → executing → completed
 *                                    ↘ rejected            ↘ failed
 *
 * NEVER TRUST AN APPROVAL BUTTON. Approval re-runs the authority check
 * server-side against the approver's current role, then execution re-checks
 * again before touching anything. Phase 4A executes only SAFE_INTERNAL_WRITE
 * bookkeeping; every business mutation stops at "approved" and is recorded
 * as awaiting a Phase 4B/4C executor, so nothing changes silently.
 */

export type ActionOutcome<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const TERMINAL: OfficerActionStatus[] = ["completed", "rejected", "failed", "cancelled"];

const OPEN: OfficerActionStatus[] = ["suggested", "waiting_for_approval"];

/** Legal transitions — anything else is refused rather than silently applied. */
const TRANSITIONS: Record<OfficerActionStatus, OfficerActionStatus[]> = {
  suggested: ["waiting_for_approval", "approved", "rejected", "cancelled"],
  waiting_for_approval: ["approved", "rejected", "cancelled"],
  approved: ["executing", "completed", "failed", "cancelled"],
  executing: ["completed", "failed"],
  completed: [],
  rejected: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: OfficerActionStatus, to: OfficerActionStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Re-validate a proposal against CURRENT state at approval time.
 *
 * A proposal is a snapshot of an argument the Officer made earlier. If the
 * world moved underneath it — the obligation vanished, the proposed assignee
 * left the organization, the contract changed hands — approving it blindly
 * would apply a stale decision. We stop and require a fresh review instead.
 */
type RevalidationInput = {
  action_type: string;
  contract_id: string | null;
  obligation_id: string | null;
  arguments: Record<string, unknown>;
};

/** Narrow an untyped action row to exactly what revalidation reads. */
function toRevalidationInput(row: Record<string, unknown>): RevalidationInput {
  return {
    action_type: String(row.action_type ?? ""),
    contract_id: (row.contract_id as string | null) ?? null,
    obligation_id: (row.obligation_id as string | null) ?? null,
    arguments: (row.arguments as Record<string, unknown> | null) ?? {},
  };
}

async function revalidateAction(
  ctx: OfficerContext,
  action: RevalidationInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (action.contract_id) {
    const { data } = await ctx.supabase
      .from("contracts").select("id")
      .eq("organization_id", ctx.organizationId).eq("id", action.contract_id).maybeSingle();
    if (!data) return { ok: false, error: "state_changed: contract_no_longer_available" };
  }
  if (action.obligation_id) {
    const { data } = await ctx.supabase
      .from("contract_obligations").select("id, review_status, activation_status")
      .eq("organization_id", ctx.organizationId).eq("id", action.obligation_id).maybeSingle();
    if (!data) return { ok: false, error: "state_changed: obligation_no_longer_available" };
    if (action.action_type.startsWith("obligation.") &&
        (data.review_status !== "approved" || data.activation_status !== "active")) {
      return { ok: false, error: "state_changed: obligation_no_longer_operational" };
    }
  }
  const assignee = action.arguments?.assigneeUserId;
  if (typeof assignee === "string") {
    const { data } = await ctx.supabase
      .from("organization_members").select("user_id")
      .eq("organization_id", ctx.organizationId).eq("user_id", assignee).maybeSingle();
    if (!data) return { ok: false, error: "state_changed: assignee_no_longer_a_member" };
  }
  return { ok: true };
}

async function loadAction(ctx: OfficerContext, actionId: string) {
  const { data } = await ctx.supabase
    .from("officer_actions")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("id", actionId)
    .maybeSingle();
  return data ?? null;
}

async function log(ctx: OfficerContext, eventType: string, actionId: string, metadata: Record<string, unknown>) {
  await ctx.supabase.from("activity_log").insert({
    organization_id: ctx.organizationId,
    actor_user_id: ctx.userId,
    event_type: eventType,
    entity_type: "officer_action",
    entity_id: actionId,
    metadata,
  });
}

/**
 * Approve a proposal, then execute it if Phase 4A supports its execution.
 *
 * Re-authorizes the CURRENT caller against the action type — an approval
 * request drafted while a user held a role is worthless if that role was
 * removed in the meantime.
 */
export async function approveOfficerAction(
  ctx: OfficerContext,
  actionId: string,
): Promise<ActionOutcome<{ status: OfficerActionStatus; executed: boolean }>> {
  const action = await loadAction(ctx, actionId);
  if (!action) return { ok: false, error: "not_found" };
  if (!OPEN.includes(action.status as OfficerActionStatus)) {
    return { ok: false, error: `not_open: ${action.status}` };
  }

  const auth = authorizeAction(ctx.role, action.action_type as string);
  if (!auth.allowed) return { ok: false, error: `unauthorized: ${auth.reason}` };

  // Never trust a previously generated approval payload: re-check the world.
  const fresh = await revalidateAction(ctx, toRevalidationInput(action));
  if (!fresh.ok) return { ok: false, error: fresh.error };

  const approvedAt = new Date().toISOString();
  const { error: approveErr, data: approved } = await ctx.supabase
    .from("officer_actions")
    .update({ status: "approved", approved_by: ctx.userId, approved_at: approvedAt })
    .eq("id", actionId)
    .eq("organization_id", ctx.organizationId)
    .in("status", OPEN)
    .select("id")
    .maybeSingle();
  if (approveErr) return { ok: false, error: approveErr.message };
  // Lost race (someone else decided first) — refuse rather than double-apply.
  if (!approved) return { ok: false, error: "already_decided" };

  await log(ctx, "officer.action_approved", actionId, {
    action_type: action.action_type,
    risk_level: action.risk_level,
    contract_id: action.contract_id,
  });

  const result = await executeApprovedAction(ctx, actionId);
  return result.ok
    ? { ok: true, data: { status: result.data.status, executed: result.data.executed } }
    : { ok: false, error: result.error };
}

export async function rejectOfficerAction(
  ctx: OfficerContext,
  actionId: string,
  reason: string,
): Promise<ActionOutcome<{ status: OfficerActionStatus }>> {
  const action = await loadAction(ctx, actionId);
  if (!action) return { ok: false, error: "not_found" };
  if (!OPEN.includes(action.status as OfficerActionStatus)) {
    return { ok: false, error: `not_open: ${action.status}` };
  }
  const auth = authorizeAction(ctx.role, action.action_type as string);
  if (!auth.allowed) return { ok: false, error: `unauthorized: ${auth.reason}` };

  const { data, error } = await ctx.supabase
    .from("officer_actions")
    .update({
      status: "rejected", rejected_by: ctx.userId,
      rejected_at: new Date().toISOString(), rejection_reason: reason.slice(0, 1000),
    })
    .eq("id", actionId)
    .eq("organization_id", ctx.organizationId)
    .in("status", OPEN)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "already_decided" };

  await log(ctx, "officer.action_rejected", actionId, { action_type: action.action_type });
  return { ok: true, data: { status: "rejected" } };
}

/**
 * Execute an approved action.
 *
 * Phase 4A executes ONLY internal bookkeeping. Approved business mutations
 * are held at "approved" with an explicit note — the officer must never
 * quietly change a contract, obligation, evidence result or gap, and never
 * contacts an external party.
 */
export async function executeApprovedAction(
  ctx: OfficerContext,
  actionId: string,
): Promise<ActionOutcome<{ status: OfficerActionStatus; executed: boolean }>> {
  const action = await loadAction(ctx, actionId);
  if (!action) return { ok: false, error: "not_found" };
  if (action.status !== "approved") return { ok: false, error: `not_approved: ${action.status}` };

  // Third check: authority again, immediately before any effect.
  const auth = authorizeAction(ctx.role, action.action_type as string);
  if (!auth.allowed) return { ok: false, error: `unauthorized: ${auth.reason}` };

  const stillValid = await revalidateAction(ctx, toRevalidationInput(action));
  if (!stillValid.ok) return { ok: false, error: stillValid.error };

  const internal = classifyAction(action.action_type as string) === "SAFE_INTERNAL_WRITE";
  if (!internal) {
    await ctx.supabase
      .from("officer_actions")
      .update({
        execution_result: {
          executed: false,
          held: "approved_but_not_executed_in_phase_4a",
          note: "Business mutations and external communication require the Phase 4B/4C executor.",
        },
      })
      .eq("id", actionId)
      .eq("organization_id", ctx.organizationId);
    return { ok: true, data: { status: "approved", executed: false } };
  }

  const { data: claimed } = await ctx.supabase
    .from("officer_actions")
    .update({ status: "executing" })
    .eq("id", actionId)
    .eq("organization_id", ctx.organizationId)
    .eq("status", "approved")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "already_executing" };

  const executedAt = new Date().toISOString();
  const { error } = await ctx.supabase
    .from("officer_actions")
    .update({
      status: "completed",
      executed_at: executedAt,
      execution_result: { executed: true, kind: action.action_type, recorded_at: executedAt },
    })
    .eq("id", actionId)
    .eq("organization_id", ctx.organizationId);
  if (error) {
    await ctx.supabase
      .from("officer_actions")
      .update({ status: "failed", error_message: error.message.slice(0, 400) })
      .eq("id", actionId)
      .eq("organization_id", ctx.organizationId);
    return { ok: false, error: error.message };
  }

  await log(ctx, "officer.action_executed", actionId, {
    action_type: action.action_type,
    contract_id: action.contract_id,
  });
  return { ok: true, data: { status: "completed", executed: true } };
}

export { TERMINAL as TERMINAL_ACTION_STATES, OPEN as OPEN_ACTION_STATES };
