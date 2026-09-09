import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { LocalizedText } from "@/domain/types";
import type { AppLocale } from "@/i18n/routing";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Resolve bilingual domain text for the active locale. */
export function lt(text: LocalizedText, locale: string): string {
  return text[locale as AppLocale] ?? text.en;
}

export function formatMoney(
  amount: number,
  locale: string,
  currency = "SAR",
  options: { compact?: boolean } = {},
): string {
  const tag = locale === "ar" ? "ar-SA-u-nu-latn" : "en-US";
  return new Intl.NumberFormat(tag, {
    style: "currency",
    currency,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
    ...(options.compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
  })
    .format(amount)
    .replace(/SAR/, locale === "ar" ? "ر.س" : "SAR");
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  return Math.round((b - a) / 86_400_000);
}
