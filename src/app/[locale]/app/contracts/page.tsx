import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Mono, PageHeader, Panel, Ring, Table, Td, Th } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { ButtonLink } from "@/components/ui/button";
import { requireTenant } from "@/data/context";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/app/contracts">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.contracts" });
  return { title: t("title") };
}

export default async function ContractsPage(props: PageProps<"/[locale]/app/contracts">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.contracts");
  const s = await getTranslations("sector");
  const f = await getFormatter();
  const { orgId, db } = await requireTenant();
  const contracts = await db.contracts.list(orgId);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("count", { count: contracts.length })}
        actions={
          <ButtonLink href="/app" size="sm">
            <Plus size={14} /> {t("newContract")}
          </ButtonLink>
        }
      />
      <Panel tone="graphite" title={t("listTitle")} hint={t("count", { count: contracts.length })}>
        <Table className="min-w-[880px]">
          <thead className="bg-fg/2">
            <tr>
              <Th>{t("columns.contract")}</Th>
              <Th>{t("columns.client")}</Th>
              <Th>{t("columns.status")}</Th>
              <Th>{t("columns.value")}</Th>
              <Th>{t("columns.obligations")}</Th>
              <Th>{t("columns.coverage")}</Th>
              <Th>{t("columns.exposure")}</Th>
              <Th>{t("columns.readiness")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {contracts.map((c) => (
              <tr key={c.id} className="hover:bg-fg/3">
                <Td>
                  <Link href={`/app/contracts/${c.id}`} className="flex flex-col">
                    <span className="font-medium">{lt(c.title, locale)}</span>
                    <span className="text-xs text-muted"><Mono>{c.reference}</Mono> · {s(c.sector)}</span>
                  </Link>
                </Td>
                <Td className="text-muted">{lt(c.client, locale)}</Td>
                <Td><StatusPill status={c.status} subtle /></Td>
                <Td><Mono className="text-sm">{formatMoney(c.value, locale, c.currency, { compact: true })}</Mono></Td>
                <Td>
                  <span className="flex flex-col text-xs">
                    <Mono className="text-sm text-fg">{c.health.obligationsTotal}</Mono>
                    <span className="text-muted">
                      {t("due", { count: c.health.obligationsDueThisMonth })}
                      {c.health.obligationsOverdue > 0 && <span className="text-missing"> · {t("overdue", { count: c.health.obligationsOverdue })}</span>}
                    </span>
                  </span>
                </Td>
                <Td><Mono className="text-sm">{f.number(c.health.evidenceCoverage, "percent")}</Mono></Td>
                <Td><Mono className={c.health.riskExposure ? "text-sm text-at-risk" : "text-sm text-faint"}>{c.health.riskExposure ? formatMoney(c.health.riskExposure, locale, c.currency, { compact: true }) : "—"}</Mono></Td>
                <Td><Ring value={c.health.claimReadiness} size={40} stroke={3.5} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
