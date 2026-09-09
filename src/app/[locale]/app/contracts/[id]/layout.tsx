import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ContractTabs } from "@/components/app/contract-tabs";
import { Mono, PageHeader } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export default async function ContractLayout(props: LayoutProps<"/[locale]/app/contracts/[id]">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const s = await getTranslations("sector");
  const f = await getFormatter();
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();

  return (
    <>
      <PageHeader
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/app/contracts" className="hover:text-fg">{t("nav.contracts")}</Link>
            <span aria-hidden>/</span>
            <Mono>{contract.reference}</Mono>
          </span>
        }
        title={lt(contract.title, locale)}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{lt(contract.client, locale)}</span>
            <span aria-hidden>·</span>
            <span>{s(contract.sector)}</span>
            <span aria-hidden>·</span>
            <Mono className="text-xs">{formatMoney(contract.value, locale, contract.currency, { compact: true })}</Mono>
            <span aria-hidden>·</span>
            <span>
              {t("contract.period", {
                start: f.dateTime(new Date(contract.startDate), "medium"),
                end: f.dateTime(new Date(contract.endDate), "medium"),
              })}
            </span>
          </span>
        }
        actions={<StatusPill status={contract.status} />}
      />
      <ContractTabs id={contract.id} />
      {props.children}
    </>
  );
}
