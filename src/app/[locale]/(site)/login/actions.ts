"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { isLiveMode } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

const APP_NEXT = /^\/(en|ar)\/app(\/|$)/;
const MAX_NEXT_LENGTH = 512;

function resolveLocale(raw: FormDataEntryValue | null) {
  const value = String(raw ?? "");
  return hasLocale(routing.locales, value) ? value : routing.defaultLocale;
}

function resolveTarget(next: FormDataEntryValue | null) {
  const value = String(next ?? "").slice(0, MAX_NEXT_LENGTH);
  return APP_NEXT.test(value) ? value.replace(/^\/(en|ar)/, "") : "/app/dashboard";
}

export async function enterDemo(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  await auth.signInDemo();
  redirect({ href: resolveTarget(formData.get("next")), locale });
}

export async function signIn(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!isLiveMode()) {
    redirect({ href: "/login?error=config", locale });
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect({ href: "/login?error=credentials", locale });
  }
  redirect({ href: resolveTarget(formData.get("next")), locale });
}

export async function signUp(formData: FormData) {
  const locale = resolveLocale(formData.get("locale"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "").trim();

  if (!isLiveMode()) {
    redirect({ href: "/login?error=config", locale });
  }

  if (password.length < 8) {
    redirect({ href: "/login?error=weakPassword", locale });
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    redirect({ href: "/login?error=signup", locale });
  }
  // When email confirmation is required the user has no session yet.
  if (!data.session) {
    redirect({ href: "/login?notice=confirmEmail", locale });
  }
  redirect({ href: "/onboarding", locale });
}
