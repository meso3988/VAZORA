import { notFound } from "next/navigation";

import { ContractLoadFailed } from "@/components/app/contract-unavailable";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";

import { Mono, Panel } from "@/components/app/primitives";
import { RiskList } from "@/components/app/tables";
import { readContract, requireTenant } from "@/data/context";
import { formatMoney } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export default async function ContractRisks(props: PageProps<"/[locale]/app/contracts/[id]/risks">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.risks");
  const { session, orgId, db } = await requireTenant();
  const read = await readContract(db, orgId, id, session.mode === "demo");
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const contract = read.contract;
  const risks = (await db.risks.list(orgId, { contractId: id })).sort((a, b) => b.exposure - a.exposure);
  const open = risks.filter((r) => r.status !== "closed");
  const exposure = open.reduce((a, r) => a + r.exposure, 0);

  return (
    <Panel
      title={t("title")}
      action={
        <span className="flex flex-col items-end">
          <span className="text-[11px] text-muted">{t("exposure")}</span>
          <Mono className="text-sm text-at-risk">{formatMoney(exposure, await getLocale(), contract.currency)}</Mono>
        </span>
      }
    >
      <RiskList risks={risks} currency={contract.currency} />
    </Panel>
  );
}
