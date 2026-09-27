import { notFound } from "next/navigation";

import { ContractLoadFailed } from "@/components/app/contract-unavailable";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Panel } from "@/components/app/primitives";
import { ObligationsTable } from "@/components/app/tables";
import { readContract, requireTenant } from "@/data/context";
import { asLocale } from "@/i18n/params";

export default async function ContractObligations(props: PageProps<"/[locale]/app/contracts/[id]/obligations">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.obligations");
  const { session, orgId, db } = await requireTenant();
  const read = await readContract(db, orgId, id, session.mode === "demo");
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const contract = read.contract;
  const obligations = await db.obligations.list(orgId, { contractId: id });

  return (
    <Panel title={t("title")} tone="sky" hint={`${obligations.length} / ${contract.health.obligationsTotal}`}>
      <ObligationsTable obligations={obligations} currency={contract.currency} />
    </Panel>
  );
}
