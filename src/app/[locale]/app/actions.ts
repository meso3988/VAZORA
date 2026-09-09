"use server";

import { hasLocale } from "next-intl";

import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export async function signOut(formData: FormData) {
  const raw = String(formData.get("locale") ?? "");
  const locale = hasLocale(routing.locales, raw) ? raw : routing.defaultLocale;
  await auth.signOut();
  redirect({ href: "/", locale });
}
