import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { DemoForm } from "@/components/site/demo-form";
import { Eyebrow } from "@/components/ui/surface";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/demo">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "demo" });
  return { title: t("eyebrow"), description: t("body") };
}

export default async function DemoPage(props: PageProps<"/[locale]/demo">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("demo");

  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_top,black_10%,transparent_60%)]" />
      <div className="container-x relative grid grid-cols-1 gap-12 pt-16 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-20 lg:pt-24">
        <div className="flex flex-col gap-6">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="display max-w-[16ch] text-balance text-4xl font-medium sm:text-5xl">{t("title")}</h1>
          <p className="max-w-[52ch] text-base leading-relaxed text-muted">{t("body")}</p>
        </div>
        <DemoForm />
      </div>
    </section>
  );
}
