import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AssessorEcosystem } from "@/components/site/assessor-ecosystem";
import {
  FinalCta,
  OneEngine,
  ProviderVision,
} from "@/components/site/home/sections";
import { ButtonLink } from "@/components/ui/button";
import { ChapterFrame, ChapterLabel } from "@/components/ui/surface";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(
  props: PageProps<"/[locale]/assessor">,
): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "assessor" });
  return { title: t("eyebrow"), description: t("subtitle") };
}

export default async function AssessorPage(
  props: PageProps<"/[locale]/assessor">,
) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("assessor");
  const m = await getTranslations("mineral.assessor");
  return (
    <>
      <section className="product-hero">
        <ChapterFrame className="product-frame">
          <div className="flex flex-wrap items-center gap-4">
            <ChapterLabel label={t("eyebrow")} />
            <span className="border-s border-line-strong ps-4 text-xs text-muted">
              {t("badge")}
            </span>
          </div>
          <h1 className="m-display">{m("title")}</h1>
          <div className="product-intro">
            <p>{m("body")}</p>
            <div>
              <ButtonLink href="/demo">{t("primary")}</ButtonLink>
              <ButtonLink href="/contract-intelligence" variant="secondary">
                {t("secondary")}
              </ButtonLink>
            </div>
          </div>
        </ChapterFrame>
      </section>
      <section className="m-chapter assessor-chapter" id="assessment-field">
        <ChapterFrame>
          <AssessorEcosystem />
          <ProviderVision />
        </ChapterFrame>
      </section>
      <OneEngine />
      <FinalCta />
    </>
  );
}
