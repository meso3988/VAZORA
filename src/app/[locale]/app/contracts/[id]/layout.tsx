import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ContractLoadFailed } from "@/components/app/contract-unavailable";
import { ContractTabs } from "@/components/app/contract-tabs";
import { Mono, PageHeader } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { readContract, requireTenant } from "@/data/context";
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
  const { session, orgId, db } = await requireTenant();
  const read = await readContract(db, orgId, id, session.mode === "demo");
  // A failed read is not a 404: show the localized unavailable state and
  // drop the tabs + children, which would fail identically anyway.
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const contract = read.contract;

  const safeDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? t("contract.dateUnknown") : f.dateTime(d, "medium");
  };

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
              {/* A real contract may have no recorded start/end date. Formatting
                  an invalid Date throws and takes the whole page down, so an
                  unknown date renders as unknown. */}
              {t("contract.period", {
                start: safeDate(contract.startDate),
                end: safeDate(contract.endDate),
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
