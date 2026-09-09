"use client";

import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";

import { usePathname, useRouter } from "@/i18n/navigation";
import { localeMeta, locales, type AppLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * Switches locale in place: same pathname, same dynamic params, same query —
 * so a user on /en/app/contracts/ctr_x?tab=risks lands on /ar/app/contracts/ctr_x?tab=risks.
 */
export function LanguageSwitcher({
  className,
  variant = "segmented",
}: {
  className?: string;
  variant?: "segmented" | "text";
}) {
  const t = useTranslations("common");
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [pending, startTransition] = useTransition();

  function switchTo(next: AppLocale) {
    if (next === locale) return;
    const query = Object.fromEntries(new URLSearchParams(window.location.search).entries());
    startTransition(() => {
      router.replace(
        // @ts-expect-error pathname/params are runtime-derived for the current route
        { pathname, params, query },
        { locale: next },
      );
    });
  }

  if (variant === "text") {
    const other = locales.find((l) => l !== locale)!;
    return (
      <button
        type="button"
        onClick={() => switchTo(other)}
        disabled={pending}
        className={cn(
          "text-sm text-muted transition-colors hover:text-fg disabled:opacity-60",
          className,
        )}
        lang={other}
      >
        {t("switchTo")}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn(
        "inline-flex h-8 items-stretch rounded-sm border border-line text-xs font-medium",
        pending && "opacity-60",
        className,
      )}
    >
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={l === locale}
          onClick={() => switchTo(l)}
          className={cn(
            "px-2.5 font-mono transition-colors first:rounded-s-[3px] last:rounded-e-[3px]",
            l === locale ? "bg-fg text-bg" : "text-muted hover:text-fg",
          )}
        >
          {localeMeta[l].short}
        </button>
      ))}
    </div>
  );
}
