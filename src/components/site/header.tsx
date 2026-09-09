"use client";

import { ArrowUpRight, Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { ButtonLink } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  const links = [
    { href: "/contract-intelligence" as const, label: t("contractIntelligence"), hint: t("contractIntelligenceHint") },
    { href: "/assessor" as const, label: t("assessor"), hint: t("assessorHint") },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled || open ? "border-line bg-bg/85 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="container-x flex h-16 items-center justify-between gap-6">
        <Link href="/" aria-label="VAZORA" className="rounded-sm">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label={t("products")}>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                "rounded-sm px-3 py-2 text-sm text-muted transition-colors hover:text-fg",
                pathname === l.href && "text-fg",
              )}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <LanguageSwitcher />
          <ButtonLink href="/login" variant="ghost" size="sm">
            {t("login")}
          </ButtonLink>
          <ButtonLink href="/demo" size="sm">
            {t("bookDemo")}
          </ButtonLink>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher />
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t("close") : t("menu")}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-sm border border-line text-fg"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-line bg-bg md:hidden">
          <div className="container-x flex flex-col gap-2 py-6">
            <p className="eyebrow mb-2">{t("products")}</p>
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-start justify-between gap-4 rounded-md border border-line p-4 transition-colors hover:border-line-strong"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-base font-medium text-fg">{l.label}</span>
                  <span className="text-sm text-muted">{l.hint}</span>
                </span>
                <ArrowUpRight size={18} className="mt-0.5 shrink-0 text-faint rtl:-scale-x-100" />
              </Link>
            ))}
            <div className="mt-6 flex flex-col gap-3">
              <ButtonLink href="/demo" size="lg">
                {t("bookDemo")}
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" size="lg">
                {t("login")}
              </ButtonLink>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
