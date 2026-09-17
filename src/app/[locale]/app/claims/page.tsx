import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader, Panel } from "@/components/app/primitives";
import { ClaimCard } from "@/components/app/tables";
import { requireTenant } from "@/data/context";
import { claimReadiness } from "@/domain/types";
import { lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/app/claims">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.claims" });
  return { title: t("title") };
}

export default async function ClaimsPage(props: PageProps<"/[locale]/app/claims">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.claims");
  const { orgId, db } = await requireTenant();
  const [claims, contracts] = await Promise.all([db.claims.list(orgId), db.contracts.list(orgId)]);
  const titles = Object.fromEntries(contracts.map((c) => [c.id, lt(c.title, locale)]));
  const sorted = [...claims].sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {sorted.map((c) => (
        <Panel key={c.id} tone={claimReadiness(c) >= 0.9 ? "emerald" : claimReadiness(c) >= 0.5 ? "amber" : "rose"}>
          <ClaimCard claim={c} contractTitle={titles[c.contractId]} />
        </Panel>
      ))}
    </>
  );
}
