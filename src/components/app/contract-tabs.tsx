"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = ["overview", "obligations", "evidence", "risks", "claims", "activity", "officer"] as const;
const DEFERRED_TABS: readonly string[] = ["risks", "claims"];

/** `deferred`: live tenants — risks and claims are not part of this release. */
export function ContractTabs({ id, deferred = false }: { id: string; deferred?: boolean }) {
  const t = useTranslations("app.contract.tabs");
  const c = useTranslations("app.contract");
  const d = useTranslations("app.deferred");
  const pathname = usePathname();
  const base = `/app/contracts/${id}`;

  return (
    <nav aria-label={c("sections")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map((tab) => {
          const href = tab === "overview" ? base : `${base}/${tab}`;
          const active = tab === "overview" ? pathname === base : pathname.startsWith(href);
          if (deferred && DEFERRED_TABS.includes(tab)) {
            return (
              <li key={tab}>
                <span
                  data-deferred={tab}
                  aria-disabled="true"
                  title={d("badge")}
                  className={cn(
                    "-mb-px flex h-10 cursor-default items-center gap-1.5 border-b-2 px-3 text-sm text-faint",
                    active ? "border-line-strong" : "border-transparent",
                  )}
                >
                  {t(tab)}
                  <span className="rounded-sm border border-line px-1 py-px text-[10px] leading-none">{d("badge")}</span>
                </span>
              </li>
            );
          }
          return (
            <li key={tab}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex h-10 items-center border-b-2 px-3 text-sm transition-colors",
                  active ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg",
                )}
              >
                {t(tab)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
