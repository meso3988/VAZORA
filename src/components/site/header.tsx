"use client";

import { ArrowUpRight, ChevronDown, Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Wordmark } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { ButtonLink } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Group = {
  key: "products" | "platform";
  label: string;
  items: { href: string; label: string; hint: string }[];
};

export function SiteHeader() {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const ref = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
    setActive(null);
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setActive(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (open) {
          setOpen(false);
          menuButton.current?.focus();
        }
        if (active) {
          ref.current
            ?.querySelector<HTMLButtonElement>(`[data-nav="${active}"]`)
            ?.focus();
          setActive(null);
        }
      }
      if (event.key === "Tab" && open) {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled])",
          ) ?? [],
        ).filter((el) => el.getClientRects().length > 0);
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const previous = document.documentElement.style.overflow;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>("main, footer"),
    );
    const inert = background.map((el) => el.inert);
    document.documentElement.style.overflow = "hidden";
    background.forEach((el) => {
      el.inert = true;
    });
    const desktop = window.matchMedia("(min-width: 1024px)");
    const resize = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", resize);
    return () => {
      document.documentElement.style.overflow = previous;
      background.forEach((el, i) => {
        el.inert = inert[i];
      });
      desktop.removeEventListener("change", resize);
    };
  }, [open]);

  const groups: Group[] = [
    {
      key: "products",
      label: t("products"),
      items: [
        {
          href: "/contract-intelligence",
          label: t("contractIntelligence"),
          hint: t("contractIntelligenceHint"),
        },
        { href: "/assessor", label: t("assessor"), hint: t("assessorHint") },
      ],
    },
    {
      key: "platform",
      label: t("platform"),
      items: [
        {
          href: "/#evidence-engine",
          label: t("platformItems.evidence"),
          hint: t("platformItems.evidenceHint"),
        },
        {
          href: "/contract-intelligence#officer",
          label: t("platformItems.officer"),
          hint: t("platformItems.officerHint"),
        },
        {
          href: "/contract-intelligence#claim-readiness",
          label: t("platformItems.claims"),
          hint: t("platformItems.claimsHint"),
        },
      ],
    },
  ];
  const close = () => {
    setOpen(false);
    setActive(null);
  };
  return (
    <header
      ref={ref}
      className="mineral-header sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur-md"
    >
      <div className="container-x flex h-[76px] items-center justify-between gap-6">
        <Link href="/" aria-label="VAZORA" onClick={close}>
          <Wordmark sculpted />
        </Link>
        <nav
          className="hidden items-center gap-2 lg:flex"
          aria-label={t("products")}
        >
          {groups.map((group) => (
            <div className="relative" key={group.key}>
              <button
                type="button"
                data-nav={group.key}
                aria-expanded={active === group.key}
                aria-controls={`nav-${group.key}`}
                onClick={() =>
                  setActive(active === group.key ? null : group.key)
                }
                className="flex h-11 items-center gap-2 px-3 text-[13px] text-muted hover:text-fg"
              >
                {group.label}
                <ChevronDown
                  size={12}
                  className={cn(
                    "transition-transform",
                    active === group.key && "rotate-180",
                  )}
                />
              </button>
              {active === group.key && (
                <ul
                  id={`nav-${group.key}`}
                  className="absolute start-0 top-full w-[340px] border border-line-strong bg-elevated p-2 shadow-float"
                >
                  {group.items.map((item) => (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        onClick={close}
                        className="flex flex-col gap-1 px-4 py-4 hover:bg-subtle"
                      >
                        <span className="text-sm font-medium">
                          {item.label}
                        </span>
                        <span className="text-xs leading-relaxed text-muted">
                          {item.hint}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <Link
            href="/#enterprise-trust"
            onClick={close}
            className="px-3 py-3 text-[13px] text-muted hover:text-fg"
          >
            {t("company")}
          </Link>
        </nav>
        <div className="hidden items-center gap-5 lg:flex">
          <LanguageSwitcher variant="text" />
          <Link href="/login" className="text-xs text-muted hover:text-fg">
            {t("login")}
          </Link>
          <ButtonLink href="/demo" size="md">
            {t("bookDemo")}
            <ArrowUpRight size={14} className="rtl:-scale-x-100" />
          </ButtonLink>
        </div>
        <div className="flex items-center gap-5 lg:hidden">
          <LanguageSwitcher variant="text" />
          <button
            ref={menuButton}
            type="button"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={t(open ? "close" : "menu")}
            onClick={() => setOpen((v) => !v)}
            className="flex size-11 items-center justify-center border border-line-strong"
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          aria-label={t("menu")}
          className="fixed inset-x-0 top-[76px] h-[calc(100dvh-76px)] overflow-y-auto border-t border-line bg-bg lg:hidden"
        >
          <div className="container-x flex flex-col gap-7 py-7">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="m-eyebrow mb-3">{group.label}</p>
                {group.items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={close}
                    className="flex items-center justify-between gap-4 border-b border-line py-4"
                  >
                    <span>
                      <span className="block text-base">{item.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted">
                        {item.hint}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={17}
                      className="shrink-0 rtl:-scale-x-100"
                    />
                  </Link>
                ))}
              </div>
            ))}
            <Link href="/#enterprise-trust" onClick={close}>
              {t("company")}
            </Link>
            <div className="flex flex-col gap-3">
              <ButtonLink href="/demo" onClick={close}>
                {t("bookDemo")}
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" onClick={close}>
                {t("login")}
              </ButtonLink>
            </div>
          </div>
        </nav>
      )}
    </header>
  );
}
