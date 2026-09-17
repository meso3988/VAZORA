import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Panel } from "@/components/app/primitives";
import { ObligationsTable } from "@/components/app/tables";
import { requireTenant } from "@/data/context";
import { asLocale } from "@/i18n/params";

export default async function ContractObligations(props: PageProps<"/[locale]/app/contracts/[id]/obligations">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.obligations");
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const obligations = await db.obligations.list(orgId, { contractId: id });

  return (
    <Panel title={t("title")} tone="sky" hint={`${obligations.length} / ${contract.health.obligationsTotal}`}>
      <ObligationsTable obligations={obligations} currency={contract.currency} />
    </Panel>
  );
}
