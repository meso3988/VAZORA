import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { OfficerFeed } from "@/components/app/officer-feed";
import { Kpi, Mono, PageHeader, Panel, Ring, Table, Td, Th } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { DEMO_TODAY } from "@/data/mock/organization";
import { claimReadiness } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { daysBetween, formatMoney, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/app/dashboard">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.dashboard" });
  return { title: t("title") };
}

export default async function DashboardPage(props: PageProps<"/[locale]/app/dashboard">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const f = await getFormatter();
  const { session, orgId, db } = await requireTenant();

  const [contracts, obligations, claims, events] = await Promise.all([
    db.contracts.list(orgId),
    db.obligations.list(orgId),
    db.claims.list(orgId),
    db.agent.listEvents(orgId, { limit: 6 }),
  ]);

  const active = contracts.filter((c) => c.status !== "draft");
  const due = active.reduce((a, c) => a + c.health.obligationsDueThisMonth, 0);
  const overdue = active.reduce((a, c) => a + c.health.obligationsOverdue, 0);
  const totalObl = active.reduce((a, c) => a + c.health.obligationsTotal, 0) || 1;
  const coverage = active.reduce((a, c) => a + c.health.evidenceCoverage * c.health.obligationsTotal, 0) / totalObl;
  const exposureByCurrency = active.reduce<Record<string, number>>((acc, c) => {
    acc[c.currency] = (acc[c.currency] ?? 0) + c.health.riskExposure;
    return acc;
  }, {});
  const preparing = claims.filter((c) => c.status === "preparing" || c.status === "ready");
  const nextClaim = [...preparing].sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0];
  const titles = Object.fromEntries(contracts.map((c) => [c.id, lt(c.title, locale)]));

  const upcoming = obligations
    .filter((o) => {
      const days = daysBetween(DEMO_TODAY, o.dueDate);
      return o.status !== "verified" && days >= 0 && days <= 30;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  const firstName = session.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={t("dashboard.greeting", { name: firstName })}
        subtitle={t("dashboard.asOf", { date: f.dateTime(new Date(DEMO_TODAY), "medium") })}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("dashboard.kpis.contracts")} value={active.length} />
        <Kpi label={t("dashboard.kpis.obligationsDue")} value={due} />
        <Kpi label={t("dashboard.kpis.overdue")} value={overdue} tone={overdue ? "missing" : undefined} />
        <Kpi label={t("dashboard.kpis.coverage")} value={f.number(coverage, "percent")} tone={coverage >= 0.85 ? "verified" : "partial"} />
        <Kpi label={t("dashboard.kpis.exposure")} value={
            <Mono className="text-2xl">
              {Object.entries(exposureByCurrency)
                .map(([currency, amount]) => formatMoney(amount, locale, currency, { compact: true }))
                .join(" · ") || "—"}
            </Mono>
          } tone="at_risk" />
        <Kpi
          label={t("dashboard.kpis.readiness")}
          value={nextClaim ? f.number(claimReadiness(nextClaim), "percent") : "—"}
          tone={nextClaim && claimReadiness(nextClaim) >= 0.9 ? "verified" : "partial"}
          hint={nextClaim ? t("claims.claim", { number: nextClaim.number }) : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          title={t("dashboard.attention")}
          hint={t("dashboard.attentionHint")}
          action={
            <Link href="/app/agent" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
              {t("nav.officer")} <ArrowRight size={12} className="rtl:-scale-x-100" />
            </Link>
          }
        >
          <OfficerFeed events={events} contractTitles={titles} />
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title={t("dashboard.claims")}>
            <ul className="divide-y divide-line">
              {preparing.map((cl) => {
                const r = claimReadiness(cl);
                return (
                  <li key={cl.id}>
                    <Link href={`/app/contracts/${cl.contractId}/claims`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-fg/3">
                      <Ring value={r} size={48} stroke={4} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">{t("claims.claim", { number: cl.number })} · {titles[cl.contractId]}</span>
                        <span className="text-xs text-muted">{lt(cl.period, locale)} · {t("claims.target", { date: f.dateTime(new Date(cl.targetDate), "short") })}</span>
                      </div>
                      <Mono className="text-sm">{formatMoney(cl.amount, locale, cl.currency, { compact: true })}</Mono>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel
        title={t("dashboard.portfolio")}
        action={
          <Link href="/app/contracts" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
            {t("nav.contracts")} <ArrowRight size={12} className="rtl:-scale-x-100" />
          </Link>
        }
      >
        <Table>
          <thead className="bg-fg/2">
            <tr>
              <Th>{t("contracts.columns.contract")}</Th>
              <Th>{t("contracts.columns.status")}</Th>
              <Th>{t("contracts.columns.obligations")}</Th>
              <Th>{t("contracts.columns.coverage")}</Th>
              <Th>{t("contracts.columns.exposure")}</Th>
              <Th>{t("contracts.columns.readiness")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {active.map((c) => (
              <tr key={c.id} className="hover:bg-fg/3">
                <Td>
                  <Link href={`/app/contracts/${c.id}`} className="flex flex-col">
                    <span className="font-medium">{lt(c.title, locale)}</span>
                    <span className="text-xs text-muted"><Mono>{c.reference}</Mono> · {lt(c.client, locale)}</span>
                  </Link>
                </Td>
                <Td><StatusPill status={c.status} subtle /></Td>
                <Td>
                  <span className="flex flex-col text-xs">
                    <span><Mono className="text-sm text-fg">{c.health.obligationsTotal}</Mono></span>
                    <span className="text-muted">
                      {t("contracts.due", { count: c.health.obligationsDueThisMonth })}
                      {c.health.obligationsOverdue > 0 && <span className="text-missing"> · {t("contracts.overdue", { count: c.health.obligationsOverdue })}</span>}
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

      <Panel title={t("dashboard.upcoming")}>
        <Table>
          <thead className="bg-fg/2">
            <tr>
              <Th>{t("obligations.columns.clause")}</Th>
              <Th>{t("obligations.columns.requirement")}</Th>
              <Th>{t("obligations.columns.owner")}</Th>
              <Th>{t("obligations.columns.due")}</Th>
              <Th>{t("obligations.columns.status")}</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {upcoming.map((o) => (
              <tr key={o.id} className="hover:bg-fg/3">
                <Td><Mono>{o.clauseRef}</Mono></Td>
                <Td>
                  <Link href={`/app/contracts/${o.contractId}/obligations`} className="flex flex-col">
                    <span className="max-w-[48ch] truncate">{lt(o.requirement, locale)}</span>
                    <span className="text-xs text-muted">{titles[o.contractId]}</span>
                  </Link>
                </Td>
                <Td className="text-muted">{o.ownerName}</Td>
                <Td><Mono className="text-sm">{f.dateTime(new Date(o.dueDate), "short")}</Mono></Td>
                <Td><StatusPill status={o.status} subtle /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
