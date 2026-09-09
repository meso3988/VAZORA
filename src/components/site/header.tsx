"use client";

import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Wordmark } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { ButtonLink } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Href = "/contract-intelligence" | "/assessor";

type Group = {
  key: "products" | "platform";
  label: string;
  items: { href: Href; label: string; hint: string }[];
};

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

  const groups: Group[] = [
    {
      key: "products",
      label: t("products"),
      items: [
        { href: "/contract-intelligence", label: t("contractIntelligence"), hint: t("contractIntelligenceHint") },
        { href: "/assessor", label: t("assessor"), hint: t("assessorHint") },
      ],
    },
    {
      key: "platform",
      label: t("platform"),
      items: [
        { href: "/contract-intelligence", label: t("platformItems.evidence"), hint: t("platformItems.evidenceHint") },
        { href: "/contract-intelligence", label: t("platformItems.officer"), hint: t("platformItems.officerHint") },
        { href: "/contract-intelligence", label: t("platformItems.claims"), hint: t("platformItems.claimsHint") },
      ],
    },
  ];

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-colors duration-300",
        scrolled || open ? "border-line bg-bg/90 backdrop-blur-md" : "border-transparent bg-transparent",
      )}
    >
      <div className="container-x flex h-16 items-center justify-between gap-6">
        <Link href="/" aria-label="VAZORA" className="rounded-sm">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label={t("products")}>
          {groups.map((g) => (
            <div key={g.key} className="group relative">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted transition-colors group-hover:text-fg group-focus-within:text-fg"
              >
                {g.label}
                <ChevronDown size={14} className="transition-transform group-hover:rotate-180" />
              </button>
              <div className="invisible absolute top-full pt-2 opacity-0 transition-[opacity,visibility] duration-200 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 start-0">
                <ul className="surface-float w-[22rem] p-2">
                  {g.items.map((it) => (
                    <li key={it.label}>
                      <Link
                        href={it.href}
                        className="flex flex-col gap-0.5 rounded-md px-3 py-2.5 transition-colors hover:bg-subtle"
                      >
                        <span className="text-sm font-medium text-fg">{it.label}</span>
                        <span className="text-xs leading-relaxed text-muted">{it.hint}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
          <Link
            href="/demo"
            className={cn(
              "rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-fg",
              pathname === "/demo" && "text-fg",
            )}
          >
            {t("company")}
          </Link>
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <LanguageSwitcher variant="text" />
          <ButtonLink href="/login" variant="ghost" size="sm">
            {t("login")}
          </ButtonLink>
          <ButtonLink href="/demo" size="sm">
            {t("bookDemo")}
          </ButtonLink>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher variant="text" />
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t("close") : t("menu")}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex size-9 items-center justify-center rounded-md border border-line text-fg"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-x-0 top-16 bottom-0 z-40 overflow-y-auto border-t border-line bg-bg md:hidden">
          <div className="container-x flex flex-col gap-8 py-8">
            {groups.map((g) => (
              <div key={g.key} className="flex flex-col gap-1">
                <p className="eyebrow mb-2">{g.label}</p>
                {g.items.map((it) => (
                  <Link
                    key={it.label}
                    href={it.href}
                    className="flex items-start justify-between gap-4 border-b border-line py-3"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-base font-medium text-fg">{it.label}</span>
                      <span className="text-sm text-muted">{it.hint}</span>
                    </span>
                    <ArrowUpRight size={18} className="mt-1 shrink-0 text-faint rtl:-scale-x-100" />
                  </Link>
                ))}
              </div>
            ))}
            <div className="flex flex-col gap-3">
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
