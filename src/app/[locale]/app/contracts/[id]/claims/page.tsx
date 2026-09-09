import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Empty, Panel } from "@/components/app/primitives";
import { ClaimCard } from "@/components/app/tables";
import { requireTenant } from "@/data/context";
import { asLocale } from "@/i18n/params";

export default async function ContractClaims(props: PageProps<"/[locale]/app/contracts/[id]/claims">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.claims");
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const claims = (await db.claims.list(orgId, { contractId: id })).sort((a, b) => b.number - a.number);

  return (
    <>
      {claims.length === 0 && (
        <Panel title={t("title")} hint={t("subtitle")}>
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
