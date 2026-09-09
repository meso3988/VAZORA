import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { SignatureAnimation } from "@/components/site/signature-animation";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/surface";

export function Hero() {
  const t = useTranslations("home.hero");
  const pillars = t.raw("pillars") as string[];

  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] opacity-40" />
      <div className="container-x relative grid grid-cols-1 items-center gap-12 pt-14 pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-24 lg:pb-28">
        <div className="flex flex-col gap-7">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="display max-w-[16ch] text-balance text-[2.5rem] font-medium sm:text-5xl lg:text-[3.75rem]">
            {t("title")}
          </h1>
          <p className="max-w-[54ch] text-lg leading-relaxed text-muted">{t("subtitle")}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/demo" size="lg">
              {t("primary")}
            </ButtonLink>
            <ButtonLink href="/contract-intelligence" variant="secondary" size="lg">
              {t("secondary")}
              <ArrowRight size={16} className="rtl:-scale-x-100" />
            </ButtonLink>
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {pillars.map((p) => (
              <li key={p} className="flex items-center gap-2 text-xs font-medium text-muted">
                <span aria-hidden className="size-1 rounded-full bg-accent" />
                <span className="uppercase tracking-[0.12em] rtl:normal-case rtl:tracking-normal">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute -inset-8 rounded-full bg-accent/10 blur-3xl" />
          <SignatureAnimation className="relative" />
        </div>
      </div>
    </section>
  );
}
