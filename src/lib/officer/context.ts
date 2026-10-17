import "server-only";

import type { AnyRole } from "@/lib/officer/authority";
import { buildClock, type OfficerClock } from "@/lib/officer/time";

export type SupabaseLike = Awaited<ReturnType<typeof import("@/lib/supabase/server").createSupabaseServer>>;

/**
 * The authenticated execution context every Officer tool runs inside.
 *
 * SECURITY: organizationId, userId and role are derived from the server
 * session and the database — never from model output, never from a request
 * body. A tool argument can select WHICH contract inside the caller's own
 * organization, and nothing wider; RLS is the second, independent gate.
 */
export type OfficerContext = {
  supabase: SupabaseLike;
  organizationId: string;
  userId: string;
  role: AnyRole;
  /** already-resolved local clock — the model never computes dates */
  clock: OfficerClock;
  locale: string;
  /** organization display name, for natural phrasing */
  organizationName: string;
  officer: {
    displayName: string;
    preferredLanguage: "auto" | "en" | "ar";
    tone: string;
    enabled: boolean;
  };
};

const DEFAULT_OFFICER = {
  displayName: "VAZORA Contract Officer",
  preferredLanguage: "auto" as const,
  tone: "professional",
  enabled: true,
};

/**
 * Build the Officer context for the authenticated caller.
 *
 * Returns null when the caller is not a member of the organization — the
 * membership row is the authority, so a forged organizationId resolves to
 * "no role" and every tool refuses.
 */
export async function buildOfficerContext(opts: {
  supabase: SupabaseLike;
  organizationId: string;
  userId: string;
  locale: string;
  now?: Date;
}): Promise<OfficerContext | null> {
  const { supabase, organizationId, userId, locale } = opts;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!membership) return null;

  const [{ data: org }, { data: profile }] = await Promise.all([
    supabase.from("organizations").select("name, timezone").eq("id", organizationId).maybeSingle(),
    supabase
      .from("officer_profiles")
      .select("display_name, preferred_language, timezone, tone, enabled")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (!org) return null;

  // Officer timezone overrides the organization clock only when explicitly set.
  const timeZone = (profile?.timezone as string | null) ?? (org.timezone as string | null);

  return {
    supabase,
    organizationId,
    userId,
    role: membership.role as AnyRole,
    clock: buildClock(opts.now ?? new Date(), timeZone),
    locale,
    organizationName: (org.name as string) ?? "",
    officer: profile
      ? {
          displayName: (profile.display_name as string) ?? DEFAULT_OFFICER.displayName,
          preferredLanguage: (profile.preferred_language as "auto" | "en" | "ar") ?? "auto",
          tone: (profile.tone as string) ?? DEFAULT_OFFICER.tone,
          enabled: (profile.enabled as boolean) ?? true,
        }
      : DEFAULT_OFFICER,
  };
}

/**
 * Ensure the organization has an Officer profile. Idempotent; safe to call
 * on first Officer use. Returns false when RLS refuses (non-member).
 */
export async function ensureOfficerProfile(opts: {
  supabase: SupabaseLike;
  organizationId: string;
}): Promise<boolean> {
  const { supabase, organizationId } = opts;
  const { data: existing } = await supabase
    .from("officer_profiles")
    .select("id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) return true;
  const { error } = await supabase
    .from("officer_profiles")
    .insert({ organization_id: organizationId });
  return !error;
}
