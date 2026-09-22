"use client";

import { useEffect } from "react";

import { markOfficerReviewed } from "@/app/[locale]/app/agent/actions";
import type { AppLocale } from "@/i18n/routing";

/**
 * Invisible beacon: fires once the Command Center has actually mounted in the
 * browser, which is the earliest honest moment "the user reviewed this" can be
 * claimed. Rendering nothing keeps it out of the layout entirely.
 */
export function ReviewBeacon({ locale }: { locale: AppLocale }) {
  useEffect(() => {
    void markOfficerReviewed(locale);
  }, [locale]);
  return null;
}
