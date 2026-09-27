import { notFound } from "next/navigation";

import { ContractLoadFailed } from "@/components/app/contract-unavailable";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OfficerFeed } from "@/components/app/officer-feed";
import { OfficerAsk } from "@/components/app/officer-ask";
import { Panel } from "@/components/app/primitives";
import { readContract, requireTenant } from "@/data/context";
import { asLocale } from "@/i18n/params";

export default async function ContractOfficer(props: PageProps<"/[locale]/app/contracts/[id]/officer">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.officer");
  const { session, orgId, db } = await requireTenant();
  const read = await readContract(db, orgId, id, session.mode === "demo");
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const events = await db.agent.listEvents(orgId, { contractId: id });
  const open = events.filter((e) => e.kind !== "verified").length;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <Panel title={t("briefing")} tone="emerald" hint={t("openItems", { count: open })}>
        <OfficerFeed events={events} showContract={false} />
      </Panel>
      <OfficerAsk />
    </div>
  );
}
