"use client";

import { useTranslations } from "next-intl";

import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const TABS = ["overview", "obligations", "evidence", "risks", "claims", "activity", "officer"] as const;

export function ContractTabs({ id }: { id: string }) {
  const t = useTranslations("app.contract.tabs");
  const c = useTranslations("app.contract");
  const pathname = usePathname();
  const base = `/app/contracts/${id}`;

  return (
    <nav aria-label={c("sections")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {TABS.map((tab) => {
          const href = tab === "overview" ? base : `${base}/${tab}`;
          const active = tab === "overview" ? pathname === base : pathname.startsWith(href);
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
