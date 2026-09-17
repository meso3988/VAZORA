"use server";

import { hasLocale } from "next-intl";

import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { createSupabaseServer } from "@/lib/supabase/server";

const NAME_MAX = 120;

/**
 * Organization bootstrap. The organization insert carries created_by = auth
 * user, and the owner membership is created next — both pass RLS with the
 * caller's JWT, matching the bootstrap branch of the members_insert policy.
 * organization_id is never read from client input here.
 */
export async function createOrganization(formData: FormData) {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  const name = String(formData.get("name") ?? "").trim().slice(0, NAME_MAX);

  if (name.length < 2) {
    redirect({ href: "/onboarding?error=create", locale });
  }

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect({ href: "/login", locale });
    throw new Error("unreachable"); // redirect() never returns
  }
  const userId = user.id;

  const slug = `${name
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "org"}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .insert({ name, slug, created_by: userId })
    .select("id")
    .single();

  if (orgError || !org) {
    redirect({ href: "/onboarding?error=create", locale });
    throw new Error("unreachable"); // redirect() never returns
  }
  const orgId = org.id as string;

  const { error: memberError } = await supabase
    .from("organization_members")
    .insert({ organization_id: orgId, user_id: userId, role: "owner" });

  let error = memberError;

  if (!error) {
    // Activity trail, scoped to the new tenant.
    const { error: logError } = await supabase.from("activity_log").insert({
      organization_id: orgId,
      actor_user_id: userId,
      event_type: "organization.created",
      entity_type: "organization",
      entity_id: orgId,
      metadata: { name },
    });
    error = logError;
  }

  if (error) {
    redirect({ href: "/onboarding?error=create", locale });
  }
  redirect({ href: "/app/dashboard", locale });
}
