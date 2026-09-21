import "server-only";

import type { OfficerConversationView, OfficerMessageView } from "@/domain/officer";
import { converseWithOfficer, type OfficerAnswer } from "@/lib/officer/converse";
import type { OfficerContext } from "@/lib/officer/context";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Conversation persistence for the Contract Officer.
 *
 * Messages are stored structurally (text + citations + tool invocations +
 * proposed actions), never as a markdown blob, so the same records can drive
 * the workspace UI today and a realtime voice interface later.
 */

function mapConversation(row: any): OfficerConversationView {
  return {
    id: row.id,
    scope: row.scope,
    contractId: row.contract_id,
    title: row.title,
    createdBy: row.created_by,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
  };
}

function mapMessage(row: any): OfficerMessageView {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    citations: (row.citations ?? []) as OfficerMessageView["citations"],
    toolInvocations: (row.tool_invocations ?? []) as OfficerMessageView["toolInvocations"],
    proposedActionIds: (row.proposed_action_ids ?? []) as string[],
    authorUserId: row.author_user_id,
    provider: row.provider,
    model: row.model,
    createdAt: row.created_at,
  };
}

export async function listConversations(
  ctx: OfficerContext,
  opts: { contractId?: string | null } = {},
): Promise<OfficerConversationView[]> {
  let q = ctx.supabase
    .from("officer_conversations")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(50);
  if (opts.contractId) q = q.eq("contract_id", opts.contractId);
  const { data } = await q;
  return (data ?? []).map(mapConversation);
}

export async function getConversation(
  ctx: OfficerContext,
  conversationId: string,
): Promise<{ conversation: OfficerConversationView; messages: OfficerMessageView[] } | null> {
  const { data: conv } = await ctx.supabase
    .from("officer_conversations")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;
  const { data: msgs } = await ctx.supabase
    .from("officer_messages")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return { conversation: mapConversation(conv), messages: (msgs ?? []).map(mapMessage) };
}

/**
 * Create a conversation. A contract-scoped conversation must name a contract
 * in the caller's organization — the scope is resolved server-side and never
 * taken from model output.
 */
export async function createConversation(
  ctx: OfficerContext,
  opts: { contractId?: string | null; title?: string | null },
): Promise<{ ok: true; conversation: OfficerConversationView } | { ok: false; error: string }> {
  if (opts.contractId) {
    const { data: contract } = await ctx.supabase
      .from("contracts").select("id")
      .eq("organization_id", ctx.organizationId).eq("id", opts.contractId).maybeSingle();
    if (!contract) return { ok: false, error: "contract_not_found_in_organization" };
  }
  const { data, error } = await ctx.supabase
    .from("officer_conversations")
    .insert({
      organization_id: ctx.organizationId,
      scope: opts.contractId ? "contract" : "organization",
      contract_id: opts.contractId ?? null,
      title: opts.title?.slice(0, 200) ?? null,
      created_by: ctx.userId,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "insert_failed" };
  return { ok: true, conversation: mapConversation(data) };
}

export type AskOutcome =
  | { ok: true; answer: OfficerAnswer; userMessageId: string; assistantMessageId: string }
  | { ok: false; error: string };

/**
 * Persist the user's question, run one grounded turn, persist the structured
 * answer. The contract scope handed to the model comes from the conversation
 * row — never from anything the model said.
 */
export async function askOfficer(
  ctx: OfficerContext,
  opts: { conversationId: string; question: string },
): Promise<AskOutcome> {
  const question = opts.question.trim().slice(0, 4000);
  if (!question) return { ok: false, error: "empty_question" };

  const loaded = await getConversation(ctx, opts.conversationId);
  if (!loaded) return { ok: false, error: "conversation_not_found" };

  let contractScope: { id: string; number: string; title: string } | null = null;
  if (loaded.conversation.contractId) {
    const { data: contract } = await ctx.supabase
      .from("contracts").select("id, contract_number, title")
      .eq("organization_id", ctx.organizationId)
      .eq("id", loaded.conversation.contractId)
      .maybeSingle();
    if (!contract) return { ok: false, error: "contract_scope_unavailable" };
    contractScope = { id: contract.id as string, number: contract.contract_number as string, title: contract.title as string };
  }

  const { data: userMsg, error: userErr } = await ctx.supabase
    .from("officer_messages")
    .insert({
      organization_id: ctx.organizationId,
      conversation_id: opts.conversationId,
      role: "user",
      content: question,
      author_user_id: ctx.userId,
    })
    .select("id")
    .single();
  if (userErr || !userMsg) return { ok: false, error: userErr?.message ?? "user_message_failed" };

  const history = loaded.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const result = await converseWithOfficer({
    ctx, question, history, contractScope, conversationId: opts.conversationId,
  });
  if (!result.ok) {
    // The failure is recorded honestly rather than hidden behind a retry.
    await ctx.supabase.from("officer_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", opts.conversationId).eq("organization_id", ctx.organizationId);
    return { ok: false, error: result.error };
  }

  const a = result.answer;
  const { data: assistantMsg, error: asstErr } = await ctx.supabase
    .from("officer_messages")
    .insert({
      organization_id: ctx.organizationId,
      conversation_id: opts.conversationId,
      role: "assistant",
      content: a.text,
      citations: a.citations,
      tool_invocations: a.toolInvocations,
      proposed_action_ids: a.proposedActionIds,
      provider: a.provider,
      model: a.model,
      usage_tokens_input: a.usage.inputTokens,
      usage_tokens_output: a.usage.outputTokens,
    })
    .select("id")
    .single();
  if (asstErr || !assistantMsg) return { ok: false, error: asstErr?.message ?? "assistant_message_failed" };

  await ctx.supabase
    .from("officer_conversations")
    .update({
      last_message_at: new Date().toISOString(),
      ...(loaded.conversation.title ? {} : { title: question.slice(0, 80) }),
    })
    .eq("id", opts.conversationId)
    .eq("organization_id", ctx.organizationId);

  return { ok: true, answer: a, userMessageId: userMsg.id as string, assistantMessageId: assistantMsg.id as string };
}

/** Actions proposed in this conversation, for rendering approval cards. */
export async function listConversationActions(ctx: OfficerContext, conversationId: string) {
  const { data } = await ctx.supabase
    .from("officer_actions")
    .select("*")
    .eq("organization_id", ctx.organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
