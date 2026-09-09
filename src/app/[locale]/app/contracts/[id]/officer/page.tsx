import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OfficerFeed } from "@/components/app/officer-feed";
import { OfficerAsk } from "@/components/app/officer-ask";
import { Panel } from "@/components/app/primitives";
import { requireTenant } from "@/data/context";
import { asLocale } from "@/i18n/params";

export default async function ContractOfficer(props: PageProps<"/[locale]/app/contracts/[id]/officer">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.officer");
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const events = await db.agent.listEvents(orgId, { contractId: id });
  const open = events.filter((e) => e.kind !== "verified").length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title={t("briefing")} hint={t("openItems", { count: open })}>
        <OfficerFeed events={events} showContract={false} />
      </Panel>
      <OfficerAsk />
    </div>
  );
}
