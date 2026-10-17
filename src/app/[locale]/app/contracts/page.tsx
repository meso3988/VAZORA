import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { IndicatorValue, indicatorValue } from "@/components/app/indicator";
import { Mono, PageHeader, Panel, Ring, Table, Td, Th } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { ButtonLink } from "@/components/ui/button";
import { readContractIndicators } from "@/data/contract-indicators";
import { readContractList, requireTenant } from "@/data/context";
import type { ContractIndicators } from "@/domain/indicators";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/app/contracts">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.contracts" });
  return { title: t("title") };
}

const SLOT = "\u0000";
/** Render a translated "{count} …" template with a node in place of the count. */
const slot = (template: string, node: ReactNode) => {
  const [before, after = ""] = template.split(SLOT);
  return <>{before}{node}{after}</>;
};

export default async function ContractsPage(props: PageProps<"/[locale]/app/contracts">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.contracts");
  const ti = await getTranslations("app.indicator");
  const tc = await getTranslations("app.contract");
  const s = await getTranslations("sector");
  const { session, orgId, db } = await requireTenant();
  const isDemo = session.mode === "demo";
  const read = await readContractList(db, orgId, isDemo);
  const contracts = read.contracts;
  const indicators = read.ok && contracts.length
    ? (await readContractIndicators({ isDemo, contracts, orgId, userId: session.user.id, locale })).byContract
    : new Map<string, ContractIndicators>();

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={read.ok ? t("count", { count: contracts.length }) : undefined}
        actions={
          <ButtonLink href="/app/contracts/new" size="sm">
            <Plus size={14} /> {t("newContract")}
          </ButtonLink>
        }
      />
      {!read.ok ? (
        <p role="status" className="rounded-sm border border-line bg-bg px-4 py-3 text-sm text-muted">
          {(await getTranslations("common"))("contractsLoadFailed")}
        </p>
      ) : contracts.length === 0 ? (
        <Panel tone="sky" title={t("empty.title")}>
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <p className="text-sm text-muted">{t("empty.body")}</p>
            <ButtonLink href="/app/contracts/new" size="sm">
              <Plus size={14} /> {t("newContract")}
            </ButtonLink>
          </div>
        </Panel>
      ) : (
        <Panel tone="graphite" title={t("listTitle")} hint={t("count", { count: contracts.length })}>
        <Table className="min-w-[880px]">
          <thead className="bg-fg/2">
            <tr>
              <Th>{t("columns.contract")}</Th>
              <Th>{t("columns.client")}</Th>
              <Th>{t("columns.status")}</Th>
              <Th>{t("columns.value")}</Th>
              <Th>{isDemo ? t("columns.obligations") : ti("activeObligations")}</Th>
              <Th>{t("columns.coverage")}</Th>
              <Th>{t("columns.exposure")}</Th>
              <Th>{t("columns.readiness")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {contracts.map((c) => {
              const ind = indicators.get(c.id);
              const due = indicatorValue(ind?.obligationsDueThisMonth);
              const overdue = indicatorValue(ind?.obligationsOverdue);
              const exposure = indicatorValue(ind?.riskExposure);
              const readiness = indicatorValue(ind?.claimReadiness);
              return (
              <tr key={c.id} className="hover:bg-fg/3">
                <Td>
                  <Link href={`/app/contracts/${c.id}`} className="flex flex-col">
                    <span className="font-medium">{lt(c.title, locale)}</span>
                    <span className="text-xs text-muted"><Mono>{c.reference}</Mono> · {s(c.sector)}</span>
                  </Link>
                </Td>
                <Td className="text-muted">{lt(c.client, locale)}</Td>
                <Td><StatusPill status={c.status} subtle /></Td>
                <Td>
                  {c.value == null
                    ? <span className="text-xs text-muted">{tc("valueUnknown")}</span>
                    : <Mono className="text-sm">{formatMoney(c.value, locale, c.currency, { compact: true })}</Mono>}
                </Td>
                <Td>
                  <span className="flex flex-col text-xs">
                    <Mono className="text-sm text-fg"><IndicatorValue name="obligationsTotal" indicator={ind?.obligationsTotal} short /></Mono>
                    <span className="text-muted">
                      {due != null && <>{slot(t("due", { count: SLOT }), <IndicatorValue name="obligationsDueThisMonth" indicator={ind?.obligationsDueThisMonth} />)} · </>}
                      <span className={overdue ? "text-missing" : undefined}>
                        {overdue != null
                          ? slot(t("overdue", { count: SLOT }), <IndicatorValue name="obligationsOverdue" indicator={ind?.obligationsOverdue} />)
                          : <IndicatorValue name="obligationsOverdue" indicator={ind?.obligationsOverdue} short />}
                      </span>
                    </span>
                  </span>
                </Td>
                <Td><Mono className="text-sm"><IndicatorValue name="evidenceCoverage" indicator={ind?.evidenceCoverage} format="percent" short /></Mono></Td>
                <Td>
                  <Mono className={exposure ? "text-sm text-at-risk" : "text-sm text-faint"}>
                    <IndicatorValue name="riskExposure" indicator={ind?.riskExposure} format={{ money: c.currency }} compact short />
                  </Mono>
                </Td>
                <Td>
                  {readiness != null
                    ? <span data-indicator="claimReadiness" data-state="value"><Ring value={readiness} size={40} stroke={3.5} /></span>
                    : <IndicatorValue name="claimReadiness" indicator={ind?.claimReadiness} short />}
                </Td>
              </tr>
              );
            })}
          </tbody>
        </Table>
        </Panel>
      )}
    </>
  );
}
