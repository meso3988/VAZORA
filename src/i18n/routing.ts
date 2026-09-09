import { defineRouting } from "next-intl/routing";

export const locales = ["en", "ar"] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
});

export const localeMeta: Record<
  AppLocale,
  { label: string; short: string; dir: "ltr" | "rtl"; intl: string }
> = {
  en: { label: "English", short: "EN", dir: "ltr", intl: "en-US" },
  ar: { label: "العربية", short: "AR", dir: "rtl", intl: "ar-SA" },
};
