import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { locale as rootLocale } from "next/root-params";

import { routing } from "./routing";

export default getRequestConfig(async ({ locale }) => {
  const candidate = locale ?? (await rootLocale());
  const resolved = hasLocale(routing.locales, candidate)
    ? candidate
    : routing.defaultLocale;

  return {
    locale: resolved,
    timeZone: "Asia/Riyadh",
    messages: (await import(`../messages/${resolved}.json`)).default,
    formats: {
      number: {
        integer: { maximumFractionDigits: 0, numberingSystem: "latn" },
        percent: { style: "percent", maximumFractionDigits: 0, numberingSystem: "latn" },
        compact: { notation: "compact", maximumFractionDigits: 1, numberingSystem: "latn" },
      },
      dateTime: {
        short: { day: "numeric", month: "short", numberingSystem: "latn" },
        medium: { day: "numeric", month: "short", year: "numeric", numberingSystem: "latn" },
      },
    },
  };
});
