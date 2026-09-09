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
  const flow = t.raw("flow") as string[];

  return (
    <section className="relative overflow-hidden">
      <div className="container-x relative grid grid-cols-1 gap-12 pt-16 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-20 lg:pt-24">
        <div className="flex flex-col gap-10">
          <div className="flex flex-col gap-6">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="display statement max-w-[16ch] text-balance text-[2.25rem] sm:text-[2.75rem]">{t("title")}</h1>
            <p className="measure text-base leading-relaxed text-muted">{t("body")}</p>
          </div>
          <div className="flex flex-col gap-4">
            <span className="text-xs text-faint">{t("flowEyebrow")}</span>
            <ol className="grid grid-cols-1 gap-x-6 sm:grid-cols-[repeat(5,minmax(0,1fr))]">
              {flow.map((step, i) => (
                <li key={step} className="flex gap-3 border-t border-accent/50 py-3 sm:flex-col sm:gap-2">
                  <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-sm leading-snug">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <DemoForm />
      </div>
    </section>
  );
}
