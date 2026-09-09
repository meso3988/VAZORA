"use server";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

const APP_NEXT = /^\/(en|ar)\/app(\/|$)/;

export async function enterDemo(formData: FormData) {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;
  const next = String(formData.get("next") ?? "");

  await auth.signInDemo();

  // Strip the locale prefix; `redirect` re-applies the active locale.
  const target = APP_NEXT.test(next) ? next.replace(/^\/(en|ar)/, "") : "/app/dashboard";
  redirect({ href: target, locale });
}
