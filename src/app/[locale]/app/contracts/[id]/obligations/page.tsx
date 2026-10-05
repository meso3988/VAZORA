import { notFound } from "next/navigation";

import { ContractLoadFailed, DataLoadFailed } from "@/components/app/contract-unavailable";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Panel } from "@/components/app/primitives";
import { ObligationsTable } from "@/components/app/tables";
import { readContract, readObligationList, requireTenant } from "@/data/context";
import { readObligationStates, withStates } from "@/data/obligation-states";
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
  const isDemo = session.mode === "demo";
  const obligations = await readObligationList(db, orgId, isDemo, { contractId: id });
  if (!obligations.ok) return <DataLoadFailed message="dataLoadFailed" />;
  const states = await readObligationStates({ isDemo, obligations: obligations.obligations, orgId, contractId: id, contract: { startDate: contract.startDate, endDate: contract.endDate }, userId: session.user.id, locale });

  // Demo fixtures list a sample of an illustrative total; a live list is the
  // complete read, so its own length is the only honest count.
  const shown = obligations.obligations.length;
  return (
    <Panel title={t("title")} tone="sky" hint={contract.health ? `${shown} / ${contract.health.obligationsTotal}` : String(shown)}>
      <ObligationsTable obligations={withStates(obligations.obligations, states)} currency={contract.currency} />
    </Panel>
  );
}
