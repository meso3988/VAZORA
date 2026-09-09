import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Reveal } from "@/components/motion/reveal";
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
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_65%)]" />
        <div className="container-x relative flex flex-col gap-8 pt-16 pb-20 lg:pt-28 lg:pb-24">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <span className="rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted">{t("badge")}</span>
          </div>
          <h1 className="display max-w-[18ch] text-balance text-[2.5rem] font-medium sm:text-5xl lg:text-[3.75rem]">
            {t("title")}
          </h1>
          <p className="max-w-[60ch] text-lg leading-relaxed text-muted">{t("subtitle")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/demo" size="lg">{t("primary")}</ButtonLink>
            <ButtonLink href="/contract-intelligence" variant="secondary" size="lg">{t("secondary")}</ButtonLink>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-elevated/40">
        <div className="container-x flex flex-col gap-10 py-24">
          <Reveal><Eyebrow>{t("how.eyebrow")}</Eyebrow></Reveal>
          <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
            {steps.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.08} className="flex flex-col gap-3 bg-bg p-6">
                <span className="font-mono text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-lg font-medium">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="container-x flex flex-col gap-10 py-24">
          <Reveal><Eyebrow>{t("tracks.eyebrow")}</Eyebrow></Reveal>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tracks.map((tr, i) => (
              <Reveal key={tr.name} delay={i * 0.04}>
                <li className="flex h-full flex-col gap-2 rounded-md border border-line bg-elevated p-5">
                  <span className="text-base font-medium">{tr.name}</span>
                  <span className="text-sm text-muted">{tr.body}</span>
                </li>
              </Reveal>
            ))}
          </ul>
          <p className="max-w-[70ch] text-sm text-faint">{t("note")}</p>
        </div>
      </section>
    </>
  );
}
