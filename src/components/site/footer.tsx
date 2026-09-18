import { useTranslations } from "next-intl";

import { EvidenceEnvironment } from "@/components/brand/evidence-environment";
import { BrandLettering } from "@/components/brand/logo";
import { EvidenceConvergence } from "@/components/brand/threads";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { Link } from "@/i18n/navigation";

export function SiteFooter() {
  const t = useTranslations("footer");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const source = useTranslations("mineral.hero");
  const columns = [
    {
      title: t("products"),
      items: [
        { label: nav("contractIntelligence"), href: "/contract-intelligence" },
        { label: nav("assessor"), href: "/assessor" },
      ],
    },
    {
      title: t("platform"),
      items: [
        { label: t("evidenceIntelligence"), href: "/#evidence-engine" },
        { label: t("aiOfficer"), href: "/contract-intelligence#officer" },
        {
          label: t("claimReadiness"),
          href: "/contract-intelligence#claim-readiness",
        },
      ],
    },
    {
      title: t("company"),
      items: [
        { label: nav("bookDemo"), href: "/demo" },
        { label: nav("login"), href: "/login" },
      ],
    },
  ];
  return (
    <footer data-theme="dark" className="mineral-footer">
      <EvidenceEnvironment
        className="closing-environment"
        tone="graphite"
        state="verified"
        source={{
          reference: "RTA-OM-2026-014",
          clause: "8.4",
          excerpt: source("clauseText"),
          evidence: "Signed_Acceptance.pdf",
        }}
      />
      <div className="container-x">
        <div className="footer-convergence">
          <EvidenceConvergence state="verified" compact />
          <div className="footer-brand" dir="ltr">
            <BrandLettering />
            <span className="sr-only">VAZORA</span>
          </div>
          <p>{common("tagline")}</p>
          <p>{t("closing")}</p>
        </div>
        <div className="footer-links">
          <p>{t("blurb")}</p>
          {columns.map((column) => (
            <div key={column.title}>
              <h3>{column.title}</h3>
              <ul>
                {column.items.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer-bottom">
          <p>{t("rights", { year: 2026 })}</p>
          <div>
            <span>{t("location")}</span>
            <LanguageSwitcher variant="text" />
          </div>
        </div>
      </div>
    </footer>
  );
}
