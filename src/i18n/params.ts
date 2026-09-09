import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";

import { routing, type AppLocale } from "./routing";

/** Narrows the `[locale]` route param (typed `string` by Next) to a supported locale. */
export function asLocale(raw: string): AppLocale {
  if (!hasLocale(routing.locales, raw)) notFound();
  return raw;
}
