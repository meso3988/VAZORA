import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EvidenceConvergence } from "@/components/brand/threads";
import { DemoForm } from "@/components/site/demo-form";
import { ChapterFrame, ChapterLabel } from "@/components/ui/surface";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(
  props: PageProps<"/[locale]/demo">,
): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "demo" });
  return { title: t("eyebrow"), description: t("body") };
}

export default async function DemoPage(props: PageProps<"/[locale]/demo">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("demo");
  const m = await getTranslations("mineral.demoPage");
  return (
    <section className="demo-chapter">
      <ChapterFrame className="demo-layout">
        <div>
          <ChapterLabel label={t("eyebrow")} />
          <h1 className="m-display">{m("title")}</h1>
          <p className="demo-copy">{m("body")}</p>
          <EvidenceConvergence state="partial" />
          <p className="demo-boundary">{m("note")}</p>
        </div>
        <div>
          <div className="demo-form-title">
            <h2>{m("formTitle")}</h2>
            <p>{m("formHint")}</p>
          </div>
          <DemoForm />
        </div>
      </ChapterFrame>
    </section>
  );
}
