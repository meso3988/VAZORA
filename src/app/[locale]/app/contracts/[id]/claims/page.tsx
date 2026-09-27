import { notFound } from "next/navigation";

import { ContractLoadFailed } from "@/components/app/contract-unavailable";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Empty, Panel } from "@/components/app/primitives";
import { ClaimCard } from "@/components/app/tables";
import { readContract, requireTenant } from "@/data/context";
import { asLocale } from "@/i18n/params";

export default async function ContractClaims(props: PageProps<"/[locale]/app/contracts/[id]/claims">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.claims");
  const { session, orgId, db } = await requireTenant();
  const read = await readContract(db, orgId, id, session.mode === "demo");
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const claims = (await db.claims.list(orgId, { contractId: id })).sort((a, b) => b.number - a.number);

  return (
    <>
      {claims.length === 0 && (
        <Panel title={t("title")} tone="rose" hint={t("subtitle")}>
          <Empty>{t("empty")}</Empty>
        </Panel>
      )}
      {claims.map((c, i) => (
        <Panel key={c.id} title={i === 0 ? t("title") : undefined} hint={i === 0 ? t("subtitle") : undefined}>
          <ClaimCard claim={c} />
        </Panel>
      ))}
    </>
  );
}
