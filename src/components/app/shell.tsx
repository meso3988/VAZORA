"use client";

import {
  Bot,
  ClipboardList,
  FileCheck2,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { signOut } from "@/app/[locale]/app/actions";
import { Wordmark } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { DemoBadge } from "@/components/ui/surface";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type NavHref = "/app/dashboard" | "/app/contracts" | "/app/evidence" | "/app/claims" | "/app/agent" | "/app/tasks";

const NAV: { href: NavHref; key: "dashboard" | "contracts" | "evidence" | "claims" | "officer" | "tasks"; icon: typeof LayoutDashboard }[] = [
  { href: "/app/dashboard", key: "dashboard", icon: LayoutDashboard },
  { href: "/app/contracts", key: "contracts", icon: FolderKanban },
  { href: "/app/evidence", key: "evidence", icon: FileCheck2 },
  { href: "/app/claims", key: "claims", icon: Receipt },
  { href: "/app/agent", key: "officer", icon: Bot },
  { href: "/app/tasks", key: "tasks", icon: ClipboardList },
];

export function AppShell({
  user,
  organizationName,
  demo,
  children,
}: {
  user: { name: string; email: string };
  organizationName: string;
  demo: boolean;
  children: ReactNode;
}) {
  const t = useTranslations("app.nav");
  const c = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map(({ href, key, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-9 items-center gap-3 rounded-sm px-3 text-sm transition-colors",
              active ? "bg-fg/6 font-medium text-fg" : "text-muted hover:bg-fg/4 hover:text-fg",
            )}
          >
            <Icon size={16} className="shrink-0" strokeWidth={1.75} />
            <span className="truncate">{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );

  const account = (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-col gap-0.5 px-3">
        <span className="truncate text-sm font-medium">{user.name}</span>
        <span className="truncate text-xs text-muted" dir="ltr">{user.email}</span>
      </div>
      <div className="flex items-center justify-between px-3">
        <LanguageSwitcher variant="text" />
        <form action={signOut}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            className="flex h-8 items-center gap-2 rounded-sm px-2 text-xs text-muted hover:bg-fg/4 hover:text-fg"
          >
            <LogOut size={14} className="rtl:-scale-x-100" />
            {t("signOut")}
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div data-theme="light" className="vazora-app min-h-dvh bg-bg text-fg lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-e border-line bg-elevated p-4 lg:flex">
        <div className="flex items-center justify-between px-2 pt-1">
          <Link href="/app/dashboard" aria-label="VAZORA"><Wordmark /></Link>
          {demo && <DemoBadge label={t("demoBadge")} hint={c("demoDataHint")} />}
        </div>
        <div className="px-3">
          <span className="eyebrow text-[10px]">{t("organization")}</span>
          <p className="mt-1 truncate text-sm font-medium">{organizationName}</p>
        </div>
        {nav}
        {account}
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? t("close") : t("menu")}
            aria-expanded={open}
            className="flex size-9 items-center justify-center rounded-sm text-muted hover:bg-fg/5 lg:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link href="/app/dashboard" className="lg:hidden" aria-label="VAZORA"><Wordmark /></Link>
          <div className="ms-auto flex items-center gap-3">
            {demo && <span className="lg:hidden"><DemoBadge label={t("demoBadge")} /></span>}
            <LanguageSwitcher />
          </div>
        </header>

        {open && (
          <div className="fixed inset-x-0 top-14 bottom-0 z-20 flex flex-col gap-6 overflow-y-auto border-t border-line bg-bg p-4 lg:hidden">
            <div className="px-3">
              <span className="eyebrow text-[10px]">{t("organization")}</span>
              <p className="mt-1 text-sm font-medium">{organizationName}</p>
            </div>
            {nav}
            {account}
          </div>
        )}

        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
