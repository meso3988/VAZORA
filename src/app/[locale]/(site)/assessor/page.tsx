import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { ThreadField } from "@/components/brand/threads";
import { Reveal } from "@/components/motion/reveal";
import { AssessorEcosystem } from "@/components/site/assessor-ecosystem";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/surface";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/assessor">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "assessor" });
  return { title: t("eyebrow"), description: t("subtitle") };
}

export default async function AssessorPage(props: PageProps<"/[locale]/assessor">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("assessor");
  const steps = t.raw("how.steps") as { title: string; body: string }[];
  const tracks = t.raw("tracks.items") as { name: string; body: string }[];

  return (
    <>
      <section className="relative overflow-hidden">
        <ThreadField className="pointer-events-none absolute -top-10 end-0 hidden h-[130%] w-[50%] opacity-50 lg:block" />
        <div className="container-x relative flex flex-col gap-8 pt-16 pb-20 lg:pt-28 lg:pb-24">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <span className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted">{t("badge")}</span>
          </div>
          <h1 className="display statement max-w-[18ch] text-balance text-[2.375rem] sm:text-[3rem] lg:text-[3.5rem]">
            {t("title")}
          </h1>
          <p className="measure text-[1.0625rem] leading-relaxed text-muted sm:text-lg">{t("subtitle")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/demo" size="lg">{t("primary")}</ButtonLink>
            <ButtonLink href="/contract-intelligence" variant="secondary" size="lg">{t("secondary")}</ButtonLink>
          </div>
        </div>
      </section>

      <section className="bg-subtle">
        <div className="container-x flex flex-col gap-10 py-24">
          <Reveal><Eyebrow>{t("how.eyebrow")}</Eyebrow></Reveal>
          <ol className="grid grid-cols-1 gap-x-10 md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.08} className="flex flex-col gap-3 border-t border-line-strong/60 py-6">
                <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-lg font-medium">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-canvas">
        <div className="container-x flex flex-col gap-12 py-24">
          <Reveal><Eyebrow>{t("tracks.eyebrow")}</Eyebrow></Reveal>
          <Reveal>
            <AssessorEcosystem className="mx-auto w-full max-w-4xl" />
          </Reveal>
          <ul className="grid grid-cols-1 gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
            {tracks.map((tr, i) => (
              <Reveal key={tr.name} delay={i * 0.04} className="flex flex-col gap-1.5 border-t border-line-strong/60 py-5">
                <span className="text-base font-medium">{tr.name}</span>
                <span className="text-sm text-muted">{tr.body}</span>
              </Reveal>
            ))}
          </ul>
          <p className="max-w-[70ch] text-sm text-faint">{t("note")}</p>
        </div>
      </section>
    </>
  );
}
