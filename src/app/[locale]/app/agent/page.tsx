import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OfficerAsk } from "@/components/app/officer-ask";
import { OfficerFeed } from "@/components/app/officer-feed";
import { PageHeader, Panel } from "@/components/app/primitives";
import { requireTenant } from "@/data/context";
import { lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/app/agent">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.officer" });
  return { title: t("title") };
}

export default async function AgentPage(props: PageProps<"/[locale]/app/agent">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.officer");
  const { orgId, db } = await requireTenant();
  const [events, contracts] = await Promise.all([db.agent.listEvents(orgId), db.contracts.list(orgId)]);
  const titles = Object.fromEntries(contracts.map((c) => [c.id, lt(c.title, locale)]));
  const open = events.filter((e) => e.kind !== "verified").length;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title={t("briefing")} hint={t("openItems", { count: open })}>
          <OfficerFeed events={events} contractTitles={titles} />
        </Panel>
        <OfficerAsk />
      </div>
    </>
  );
}
