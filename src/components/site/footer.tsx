import { useTranslations } from "next-intl";

import { Wordmark } from "@/components/brand/logo";
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
    <footer className="border-t border-line">
      <div className="container-x grid grid-cols-1 gap-12 py-16 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
        <div className="flex flex-col gap-5">
          <Wordmark />
          <p className="max-w-[32ch] text-sm leading-relaxed text-muted">{t("blurb")}</p>
          <p className="eyebrow">{common("tagline")}</p>
        </div>
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
      <div className="border-t border-line">
        <div className="container-x flex flex-col gap-4 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
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
