"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { routing, type AppLocale } from "@/i18n/routing";
import { approveOfficerAction, rejectOfficerAction } from "@/lib/officer/actions";
import { askOfficer, createConversation } from "@/lib/officer/conversation";
import { buildOfficerContext, ensureOfficerProfile } from "@/lib/officer/context";
import { recordMemory } from "@/lib/officer/memory";
import { isValidTimeZone } from "@/lib/officer/time";
import { redirect } from "@/i18n/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Contract Officer server actions.
 *
 * Every entry point rebuilds the Officer context from the SESSION — the
 * organization, the user and the role are never taken from the form. A
 * forged organization id resolves to no context and the action refuses.
 */

async function liveContext(locale: AppLocale) {
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/app", locale });
    throw new Error("unreachable");
  }
  const supabase = await createSupabaseServer();
  await ensureOfficerProfile({ supabase, organizationId: session.organizationId });
  const ctx = await buildOfficerContext({
    supabase,
    organizationId: session.organizationId,
    userId: session.user.id,
    locale,
  });
  if (!ctx) {
    redirect({ href: "/app?error=forbidden", locale });
    throw new Error("unreachable");
  }
  return ctx;
}

function localeOf(formData: FormData): AppLocale {
  const raw = String(formData.get("locale") ?? "");
  return hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
}

/** Start a conversation (organization-wide, or scoped to one contract). */
export async function startOfficerConversation(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64) || null;

  const created = await createConversation(ctx, { contractId, title: null });
  if (!created.ok) {
    redirect({ href: `/app/agent?error=${created.error}`, locale });
    throw new Error("unreachable");
  }
  redirect({ href: `/app/agent?c=${created.conversation.id}`, locale });
}

/** Ask the Officer a question inside an existing conversation. */
export async function askOfficerQuestion(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64);
  const question = String(formData.get("question") ?? "").trim();
  if (!conversationId || !question) {
    redirect({ href: `/app/agent?c=${conversationId}&error=invalid`, locale });
    throw new Error("unreachable");
  }

  const result = await askOfficer(ctx, { conversationId, question });
  if (!result.ok) {
    redirect({ href: `/app/agent?c=${conversationId}&error=${result.error}`, locale });
    throw new Error("unreachable");
  }
  redirect({ href: `/app/agent?c=${conversationId}`, locale });
}

/** Approve a proposed action — the server re-authorizes before anything runs. */
export async function approveOfficerActionForm(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const actionId = String(formData.get("actionId") ?? "").slice(0, 64);
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64);

  const result = await approveOfficerAction(ctx, actionId);
  const back = `/app/agent${conversationId ? `?c=${conversationId}` : ""}`;
  redirect({
    href: result.ok ? `${back}${conversationId ? "&" : "?"}approved=${actionId}`
                    : `${back}${conversationId ? "&" : "?"}error=${encodeURIComponent(result.error)}`,
    locale,
  });
}

export async function rejectOfficerActionForm(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const actionId = String(formData.get("actionId") ?? "").slice(0, 64);
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 1000) || "rejected by reviewer";

  const result = await rejectOfficerAction(ctx, actionId, reason);
  const back = `/app/agent${conversationId ? `?c=${conversationId}` : ""}`;
  redirect({
    href: result.ok ? `${back}${conversationId ? "&" : "?"}rejected=${actionId}`
                    : `${back}${conversationId ? "&" : "?"}error=${encodeURIComponent(result.error)}`,
    locale,
  });
}

/**
 * Record an organizational fact the user explicitly confirmed. Only an
 * authorized human can create confirmed memory; nothing the model says
 * reaches this path.
 */
export async function recordOfficerMemory(formData: FormData) {
  const locale = localeOf(formData);
  const ctx = await liveContext(locale);
  const content = String(formData.get("content") ?? "").trim();
  const conversationId = String(formData.get("conversationId") ?? "").slice(0, 64) || null;
  const contractId = String(formData.get("contractId") ?? "").slice(0, 64) || null;
  if (!content) {
    redirect({ href: `/app/agent?c=${conversationId ?? ""}&error=invalid`, locale });
    throw new Error("unreachable");
  }
  const result = await recordMemory(ctx, {
    content, origin: "user_confirmed", kind: "fact",
    contractId, conversationId,
  });
  redirect({
    href: `/app/agent?c=${conversationId ?? ""}&${result.ok ? "remembered=1" : `error=${result.error}`}`,
    locale,
  });
}

/**
 * Set the organization timezone deliberately. Until this happens the
 * workspace prompts, rather than silently answering "today" in UTC.
 */
export async function setOrganizationTimezone(formData: FormData) {
  const locale = localeOf(formData);
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    redirect({ href: "/app", locale });
    throw new Error("unreachable");
  }
  const timezone = String(formData.get("timezone") ?? "").trim();
  const back = String(formData.get("returnTo") ?? "/app/agent");
  if (!isValidTimeZone(timezone)) {
    redirect({ href: `${back}?error=invalid_timezone`, locale });
    throw new Error("unreachable");
  }
  const supabase = await createSupabaseServer();
  const { error } = await supabase
    .from("organizations")
    .update({ timezone, timezone_set_at: new Date().toISOString() })
    .eq("id", session.organizationId);
  redirect({ href: `${back}?${error ? `error=${error.message}` : "timezone=set"}`, locale });
}
