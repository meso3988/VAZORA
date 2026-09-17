import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  ChapterHeading,
  ClaimReadiness,
  FinalCta,
  Lifecycle,
  Officer,
  Shift,
} from "@/components/site/home/sections";
import { WorkspacePreview } from "@/components/site/workspace-preview";
import { ButtonLink } from "@/components/ui/button";
import { ChapterFrame, ChapterLabel } from "@/components/ui/surface";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(
  props: PageProps<"/[locale]/contract-intelligence">,
): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "ci" });
  return { title: t("eyebrow"), description: t("subtitle") };
}

export default async function ContractIntelligencePage(
  props: PageProps<"/[locale]/contract-intelligence">,
) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("ci");
  const m = await getTranslations("mineral.ci");
  const who = t.raw("who.items") as string[];
  const faq = t.raw("faq.items") as { q: string; a: string }[];
  return (
    <>
      <section className="product-hero">
        <ChapterFrame className="product-frame">
          <ChapterLabel label={t("eyebrow")} />
          <h1 className="m-display">
            {m("title")}
            <span>{m("accent")}</span>
          </h1>
          <div className="product-intro">
            <p>{m("body")}</p>
            <div>
              <ButtonLink href="/demo">
                {t("primary")}
                <ArrowUpRight size={15} className="rtl:-scale-x-100" />
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary">
                {t("secondary")}
              </ButtonLink>
            </div>
          </div>
        </ChapterFrame>
      </section>
      <Lifecycle />
      <div className="container-x">
        <div className="product-audience">
          <p className="m-eyebrow">{t("who.eyebrow")}</p>
          <ul>
            {who.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
      <Shift />
      <Officer />
      <ClaimReadiness />
      <section className="product-workspace">
        <ChapterFrame className="workspace-frame">
          <ChapterHeading
            eyebrow={t("workspace.eyebrow")}
            title={m("workspace")}
            body={m("workspaceBody")}
          />
          <ButtonLink href="/login" variant="secondary">
            {t("workspace.cta")}
            <ArrowUpRight size={15} className="rtl:-scale-x-100" />
          </ButtonLink>
          <details>
            <summary>{t("workspace.title")}</summary>
            <div role="region" aria-label={t("workspace.title")} tabIndex={0}>
              <WorkspacePreview />
            </div>
          </details>
        </ChapterFrame>
      </section>
      <section className="mineral-faq">
        <ChapterFrame className="faq-frame">
          <ChapterLabel label={t("faq.eyebrow")} />
          {faq.map((item) => (
            <details key={item.q}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </ChapterFrame>
      </section>
      <FinalCta />
    </>
  );
}
