import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { ThreadField } from "@/components/brand/threads";
import { ButtonLink } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/surface";
import { SignatureAnimation } from "@/components/site/signature-animation";

export function Hero() {
  const t = useTranslations("home.hero");
  const pillars = t.raw("pillars") as string[];

  return (
    <section className="relative overflow-hidden">
      <ThreadField className="pointer-events-none absolute -top-16 end-0 hidden h-[120%] w-[58%] opacity-60 lg:block" />
      <div className="container-x relative grid grid-cols-1 items-center gap-12 pt-16 pb-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:pt-24 lg:pb-28">
        <div className="flex flex-col gap-7">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="display statement max-w-[16ch] text-balance text-[2.375rem] sm:text-[3rem] lg:text-[3.5rem]">
            {t("title")}
          </h1>
          <p className="measure text-[1.0625rem] leading-relaxed text-muted sm:text-lg">{t("subtitle")}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink href="/demo" size="lg">
              {t("primary")}
            </ButtonLink>
            <ButtonLink href="/contract-intelligence" variant="secondary" size="lg">
              {t("secondary")}
              <ArrowRight size={16} className="rtl:-scale-x-100" />
            </ButtonLink>
          </div>
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2 text-xs text-faint">
            {pillars.map((p, i) => (
              <li key={p} className="flex items-center gap-3">
                <span className="text-fg/80">{p}</span>
                {i < pillars.length - 1 && <span className="h-px w-5 bg-thread" aria-hidden />}
              </li>
            ))}
          </ol>
        </div>
        <SignatureAnimation className="relative" />
      </div>
    </section>
  );
}
