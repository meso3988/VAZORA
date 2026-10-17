import "server-only";

import type { OfficerMemoryOrigin, OfficerMemoryView } from "@/domain/officer";
import { roleHasCapability } from "@/lib/officer/authority";
import type { OfficerContext } from "@/lib/officer/context";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Controlled Officer memory.
 *
 * Raw chat history is NOT memory. Only deliberate, attributed items are
 * retained, and MODEL SPECULATION IS NEVER STORED AS FACT: an inference can
 * be recorded for context but stays `unconfirmed` until a human confirms it
 * (the DB enforces this too).
 *
 * Memory sits at layer 4 of the truth hierarchy — below approved system
 * state, human decisions and structured organization data. It may add
 * context ("the client signature is expected tomorrow"); it may never
 * contradict what the contract and evidence records say.
 */

function mapMemory(row: any): OfficerMemoryView {
  return {
    id: row.id,
    scope: row.scope,
    contractId: row.contract_id,
    subjectUserId: row.subject_user_id,
    kind: row.kind,
    content: row.content,
    origin: row.origin,
    state: row.state,
    confidence: row.confidence,
    authorUserId: row.author_user_id,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export type MemoryOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Record a memory item.
 *
 * `user_confirmed` / `human_note` require the caller to hold
 * officer.memory.write. `model_inference` is always stored unconfirmed,
 * whatever the caller asks for.
 */
export async function recordMemory(
  ctx: OfficerContext,
  input: {
    content: string;
    kind?: "fact" | "preference" | "promise" | "note";
    origin: OfficerMemoryOrigin;
    scope?: "organization" | "contract" | "user";
    contractId?: string | null;
    subjectUserId?: string | null;
    conversationId?: string | null;
    messageId?: string | null;
    confidence?: number | null;
    expiresAt?: string | null;
  },
): Promise<MemoryOutcome<OfficerMemoryView>> {
  const content = input.content.trim();
  if (!content) return { ok: false, error: "empty_content" };

  const humanAuthored = input.origin === "user_confirmed" || input.origin === "human_note";
  if (humanAuthored && !roleHasCapability(ctx.role, "officer.memory.write")) {
    return { ok: false, error: "unauthorized" };
  }

  const scope = input.scope ?? (input.contractId ? "contract" : "organization");
  if (scope === "contract" && !input.contractId) return { ok: false, error: "contract_scope_requires_contract" };
  if (scope === "user" && !input.subjectUserId) return { ok: false, error: "user_scope_requires_subject" };

  if (input.contractId) {
    const { data: contract } = await ctx.supabase
      .from("contracts").select("id")
      .eq("organization_id", ctx.organizationId).eq("id", input.contractId).maybeSingle();
    if (!contract) return { ok: false, error: "contract_not_found_in_organization" };
  }

  // A human statement the user made in conversation is confirmed on the spot;
  // anything the model concluded on its own is not.
  const state = input.origin === "model_inference" ? "unconfirmed" : "confirmed";

  const { data, error } = await ctx.supabase
    .from("officer_memory")
    .insert({
      organization_id: ctx.organizationId,
      scope,
      contract_id: input.contractId ?? null,
      subject_user_id: input.subjectUserId ?? null,
      kind: input.kind ?? "fact",
      content: content.slice(0, 4000),
      origin: input.origin,
      state,
      confidence: input.confidence ?? null,
      source_conversation_id: input.conversationId ?? null,
      source_message_id: input.messageId ?? null,
      author_user_id: humanAuthored ? ctx.userId : null,
      confirmed_by: state === "confirmed" ? ctx.userId : null,
      confirmed_at: state === "confirmed" ? new Date().toISOString() : null,
      expires_at: input.expiresAt ?? null,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };
  return { ok: true, data: mapMemory(data) };
}

/** Promote an unconfirmed item to confirmed — an authorized human decision. */
export async function confirmMemory(ctx: OfficerContext, memoryId: string): Promise<MemoryOutcome<true>> {
  if (!roleHasCapability(ctx.role, "officer.memory.write")) return { ok: false, error: "unauthorized" };
  const { data, error } = await ctx.supabase
    .from("officer_memory")
    .update({ state: "confirmed", confirmed_by: ctx.userId, confirmed_at: new Date().toISOString() })
    .eq("id", memoryId)
    .eq("organization_id", ctx.organizationId)
    .eq("state", "unconfirmed")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found_or_not_unconfirmed" };
  return { ok: true, data: true };
}

/** Retire a memory item. Invalidated context must never be treated as truth. */
export async function invalidateMemory(ctx: OfficerContext, memoryId: string): Promise<MemoryOutcome<true>> {
  if (!roleHasCapability(ctx.role, "officer.memory.write")) return { ok: false, error: "unauthorized" };
  const { data, error } = await ctx.supabase
    .from("officer_memory")
    .update({ state: "invalidated", invalidated_at: new Date().toISOString() })
    .eq("id", memoryId)
    .eq("organization_id", ctx.organizationId)
    .neq("state", "invalidated")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, data: true };
}

/**
 * Memory the Officer may rely on: confirmed, not invalidated, not expired,
 * and in scope. Unconfirmed inference is deliberately excluded from the
 * grounded context — it can be surfaced to a human for confirmation, but it
 * never becomes an operational premise.
 */
export async function loadUsableMemory(
  ctx: OfficerContext,
  opts: { contractId?: string | null } = {},
): Promise<OfficerMemoryView[]> {
  const nowIso = new Date().toISOString();
  const { data } = await ctx.supabase
    .from("officer_memory")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("state", "confirmed")
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? [])
    .filter((m: any) => !m.expires_at || m.expires_at > nowIso)
    .filter((m: any) =>
      m.scope === "organization" ||
      (m.scope === "contract" && opts.contractId && m.contract_id === opts.contractId) ||
      (m.scope === "user" && m.subject_user_id === ctx.userId))
    .map(mapMemory);
}
