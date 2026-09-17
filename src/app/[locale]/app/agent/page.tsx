import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader, Panel } from "@/components/app/primitives";
import type { OfficerTier } from "@/data/mock/queues";
import { DEMO_OFFICER_ITEMS } from "@/data/mock/queues";
import { Link } from "@/i18n/navigation";
import { cn, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/app/agent">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.officer" });
  return { title: t("title") };
}

const TIERS: { key: OfficerTier; accent: string }[] = [
  { key: "critical", accent: "text-missing" },
  { key: "today", accent: "text-partial" },
  { key: "thisWeek", accent: "text-fg" },
  { key: "monitoring", accent: "text-muted" },
];

export default async function AgentPage(props: PageProps<"/[locale]/app/agent">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.officer");

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Panel title={t("command")} tone="emerald">
      <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-2">
        {TIERS.map(({ key, accent }) => {
          const items = DEMO_OFFICER_ITEMS.filter((i) => i.tier === key);
          return (
            <section key={key} className="flex flex-col bg-bg">
              <header className="flex items-center gap-2 border-b border-line px-5 py-3">
                <span className={cn("text-[11px] font-semibold uppercase tracking-wide", accent)}>
                  {t(`tiers.${key}`)}
                </span>
                <span className="ms-auto font-mono text-[10px] text-faint">{items.length}</span>
              </header>
              <ul className="flex flex-col">
                {items.map((item) => (
                  <li key={item.id} className="border-b border-line px-5 py-4 last:border-b-0">
                    <div className="flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span dir="ltr" className="font-mono text-xs text-muted">{item.ref}</span>
                          <span className="text-sm font-medium">{lt(item.title, locale)}</span>
                        </div>
                        <dl className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed">
                          <div><dt className="inline font-medium text-muted">{t("happened")}: </dt><dd className="inline text-muted">{lt(item.happened, locale)}</dd></div>
                          <div><dt className="inline font-medium text-muted">{t("matters")}: </dt><dd className="inline text-muted">{lt(item.matters, locale)}</dd></div>
                          <div><dt className="inline font-medium text-verified">{t("recommends")}: </dt><dd className="inline text-fg">{lt(item.recommends, locale)}</dd></div>
                          {item.exposure && <div><dt className="inline font-medium text-at-risk">{t("exposure")}: </dt><dd className="inline text-at-risk">{lt(item.exposure, locale)}</dd></div>}
                          {item.dueIn && <div><dt className="inline font-medium text-muted">{t("dueIn")}: </dt><dd className="inline text-partial">{lt(item.dueIn, locale)}</dd></div>}
                        </dl>
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <Link href={item.href} className="font-medium text-fg hover:underline">{locale === "ar" ? "استجب الآن" : "Act now"}</Link>
                          <Link href={item.sourceHref} className="text-muted hover:text-fg hover:underline">→ {t("source")}</Link>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      </Panel>
    </>
  );
}
