import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Reveal } from "@/components/motion/reveal";
import { WorkspacePreview } from "@/components/site/workspace-preview";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow, SectionHeading } from "@/components/ui/surface";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/contract-intelligence">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "ci" });
  return { title: t("eyebrow"), description: t("subtitle") };
}

export default async function ContractIntelligencePage(props: PageProps<"/[locale]/contract-intelligence">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("ci");
  const who = t.raw("who.items") as string[];
  const caps = t.raw("capabilities.items") as { title: string; body: string }[];
  const faq = t.raw("faq.items") as { q: string; a: string }[];

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_65%)]" />
        <div className="container-x relative flex flex-col gap-8 pt-16 pb-20 lg:pt-28 lg:pb-24">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="display max-w-[16ch] text-balance text-[2.5rem] font-medium sm:text-5xl lg:text-[3.75rem]">
            {t("title")}
          </h1>
          <p className="max-w-[60ch] text-lg leading-relaxed text-muted">{t("subtitle")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/demo" size="lg">{t("primary")}</ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">{t("secondary")}</ButtonLink>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-elevated/40">
        <div className="container-x grid grid-cols-1 gap-10 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:gap-20">
          <Reveal>
            <SectionHeading eyebrow={t("who.eyebrow")} title={t("who.title")} />
          </Reveal>
          <Reveal delay={0.1}>
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
              {who.map((w) => (
                <li key={w} className="bg-bg px-5 py-4 text-sm">{w}</li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="container-x flex flex-col gap-12 py-24">
          <Reveal>
            <Eyebrow>{t("capabilities.eyebrow")}</Eyebrow>
          </Reveal>
          <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {caps.map((c, i) => (
              <Reveal key={c.title} delay={i * 0.05} className="flex flex-col gap-3 bg-bg p-6">
                <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-lg font-medium">{c.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{c.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-elevated/40">
        <div className="container-x flex flex-col gap-12 py-24">
          <Reveal>
            <SectionHeading eyebrow={t("workspace.eyebrow")} title={t("workspace.title")} body={t("workspace.body")} />
          </Reveal>
          <Reveal delay={0.1}>
            <WorkspacePreview />
          </Reveal>
          <Reveal>
            <ButtonLink href="/login" variant="secondary">
              {t("workspace.cta")}
              <ArrowRight size={16} className="rtl:-scale-x-100" />
            </ButtonLink>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="container-x grid grid-cols-1 gap-10 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-20">
          <Reveal>
            <Eyebrow>{t("faq.eyebrow")}</Eyebrow>
          </Reveal>
          <dl className="divide-y divide-line">
            {faq.map((f) => (
              <Reveal key={f.q} className="grid grid-cols-1 gap-2 py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-8">
                <dt className="text-base font-medium">{f.q}</dt>
                <dd className="text-sm leading-relaxed text-muted">{f.a}</dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
