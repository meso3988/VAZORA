import { ArrowDown, ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { SignatureAnimation } from "@/components/site/signature-animation";
import { ButtonLink } from "@/components/ui/button";
import { ChapterFrame, ChapterLabel } from "@/components/ui/surface";

export function Hero() {
  const t = useTranslations("mineral.hero");
  const nav = useTranslations("nav");
  return (
    <section className="mineral-hero" id="contract-enters">
      <ChapterFrame className="hero-frame">
        <SignatureAnimation introduction={<div className="hero-editorial">
          <ChapterLabel label={t("eyebrow")} />
          <h1 className="m-display">
            <span>{t("title")}</span>
            <span className="hero-title-accent">{t("accent")}</span>
          </h1>
          <div className="hero-introduction">
            <p>{t("body")}</p>
            <div className="hero-links">
              <ButtonLink href="/demo">
                {nav("bookDemo")}
                <ArrowUpRight size={15} className="rtl:-scale-x-100" />
              </ButtonLink>
              <a href="#proof-chain" className="m-text-link">
                {t("watch")}
                <ArrowDown size={14} />
              </a>
            </div>
          </div>
        </div>} />
      </ChapterFrame>
    </section>
  );
}
