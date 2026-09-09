import { useTranslations } from "next-intl";

import { Mark } from "@/components/brand/logo";
import { ThreadField } from "@/components/brand/threads";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Link } from "@/i18n/navigation";

export function SiteFooter() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const common = useTranslations("common");

  const columns = [
    {
      title: t("products"),
      items: [
        { label: nav("contractIntelligence"), href: "/contract-intelligence" as const },
        { label: nav("assessor"), href: "/assessor" as const },
      ],
    },
    {
      title: t("platform"),
      items: [
        { label: t("evidenceIntelligence"), href: "/contract-intelligence" as const },
        { label: t("aiOfficer"), href: "/contract-intelligence" as const },
        { label: t("claimReadiness"), href: "/contract-intelligence" as const },
      ],
    },
    {
      title: t("company"),
      items: [
        { label: nav("bookDemo"), href: "/demo" as const },
        { label: nav("login"), href: "/login" as const },
      ],
    },
  ];

  return (
    <footer data-theme="dark" className="relative overflow-hidden bg-bg text-fg">
      <ThreadField className="absolute inset-y-0 start-0 hidden h-full w-[62%] opacity-70 sm:block" />
      <div className="container-x relative">
        <div className="flex flex-col items-start gap-6 pt-24 pb-16 sm:items-center sm:text-center">
          <Mark size={30} className="text-fg" />
          <p className="text-[13px] font-semibold tracking-[0.28em]" style={{ fontFamily: "var(--font-latin)" }}>
            VAZORA
          </p>
          <p className="eyebrow !text-muted">{common("tagline")}</p>
          <p className="display statement max-w-[20ch] text-balance text-[2rem] sm:text-[2.75rem]">{t("closing")}</p>
        </div>

        <div className="grid grid-cols-2 gap-10 border-t border-line py-12 sm:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
          <p className="col-span-2 max-w-[36ch] text-sm leading-relaxed text-muted sm:col-span-1">{t("blurb")}</p>
          {columns.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <p className="text-xs font-medium text-fg">{col.title}</p>
              <ul className="flex flex-col gap-2">
                {col.items.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href} className="text-sm text-muted transition-colors hover:text-fg">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-4 border-t border-line py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
          <p>{t("rights", { year: 2026 })}</p>
          <div className="flex items-center gap-5">
            <span>{t("location")}</span>
            <LanguageSwitcher variant="text" />
          </div>
        </div>
      </div>
    </footer>
  );
}
