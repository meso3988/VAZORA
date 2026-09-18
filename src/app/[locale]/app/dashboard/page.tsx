import { ArrowRight, ShieldCheck, Target, CalendarClock, TrendingUp, Wallet, AlertOctagon, FileWarning, FileCheck2, Ban, Bot } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { OfficerFeed } from "@/components/app/officer-feed";
import { Mono, PageHeader, Panel, Ring, Table, Td, Th } from "@/components/app/primitives";
import { KpiGauge, KpiBars, KpiTrend, KpiHero } from "@/components/app/kpi-graphics";
import { QueueBoard } from "@/components/app/queues";
import { AssignmentReview } from "@/components/app/assignment-review";
import { TodayChips } from "@/components/app/today-chips";
import { StatusPill } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { DEMO_PIPELINE } from "@/data/mock/pipeline";
import { DEMO_ACTION_QUEUE, DEMO_APPROVALS, DEMO_ASSIGNMENTS } from "@/data/mock/queues";
import { claimReadiness } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt } from "@/lib/utils";
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

  const [contracts, claims, events] = await Promise.all([
    db.contracts.list(orgId),
    db.claims.list(orgId),
    db.agent.listEvents(orgId, { limit: 5 }),
  ]);

  const active = contracts.filter((c) => c.status !== "draft");
  const due = active.reduce((a, c) => a + c.health.obligationsDueThisMonth, 0);
  const overdue = active.reduce((a, c) => a + c.health.obligationsOverdue, 0);
  const totalObl = active.reduce((a, c) => a + c.health.obligationsTotal, 0) || 1;
  const coverage = active.reduce((a, c) => a + c.health.evidenceCoverage * c.health.obligationsTotal, 0) / totalObl;
  const exposure = active.reduce((sum, c) => sum + c.health.riskExposure, 0);
  const preparing = claims.filter((c) => c.status === "preparing" || c.status === "ready");
  const blocked = preparing.filter((c) => claimReadiness(c) < 0.95);
  const nextClaim = [...preparing].sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0];
  const titles = Object.fromEntries(contracts.map((c) => [c.id, lt(c.title, locale)]));

  const latestPipeline = DEMO_PIPELINE.find((run) => titles[run.contractId]);
  const stepLabels: Record<string, string> = {
    parsed: t("dashboard.steps.parsed"),
    obligations: t("dashboard.steps.obligations"),
    reviewed: t("dashboard.steps.reviewed"),
    owners: t("dashboard.steps.owners"),
    rules: t("dashboard.steps.rules"),
    activate: t("dashboard.steps.activate"),
  };
  const activationSteps = [
    { key: "parsed", done: true },
    { key: "obligations", done: true },
    { key: "reviewed", done: true },
    { key: "owners", done: null },
    { key: "rules", done: true },
    { key: "activate", done: false },
  ];
  const stepsDone = activationSteps.filter((s) => s.done).length;
  const firstName = session.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={t("dashboard.greeting", { name: firstName })}
        subtitle={t("dashboard.opsSummary", {
          count: DEMO_APPROVALS.length + DEMO_ACTION_QUEUE.length,
          approvals: DEMO_APPROVALS.length,
          actions: DEMO_ACTION_QUEUE.length,
        })}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiGauge label={t("dashboard.kpis.coverage")} value={Math.round(coverage * 100)} display={f.number(coverage, "percent")} tone={coverage >= 0.85 ? "verified" : "partial"} icon={ShieldCheck} />
        <KpiGauge label={t("dashboard.kpis.readiness")} value={Math.round((nextClaim ? claimReadiness(nextClaim) : 0) * 100)} display={nextClaim ? f.number(claimReadiness(nextClaim), "percent") : "—"} tone={nextClaim && claimReadiness(nextClaim) >= 0.9 ? "verified" : "partial"} hint={nextClaim ? t("claims.claim", { number: nextClaim.number }) : undefined} icon={Target} />
        <KpiBars label={t("dashboard.kpis.obligationsDue")} value={Math.min(100, due)} display={due} segments={6} tone="partial" icon={CalendarClock} />
        <KpiTrend label={t("dashboard.kpis.contracts")} display={active.length} points={[2, 3, 3, 4, 4, active.length]} tone="verified" hint={`${active.length}`} icon={TrendingUp} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <KpiHero label={t("dashboard.exposureNow")} display={<Mono className="text-3xl">{formatMoney(exposure, locale, "SAR", { compact: true })}</Mono>} tone="at_risk" icon={Wallet} />
        <KpiHero label={t("dashboard.overdueNow")} display={overdue} tone={overdue ? "missing" : "verified"} icon={AlertOctagon} />
        <KpiHero label={t("dashboard.claimsNeeding")} display={blocked.length} tone={blocked.length ? "partial" : "verified"} icon={FileWarning} />
      </div>

      <TodayChips
        labels={{
          approvals: t("dashboard.approvalQueue"),
          actions: t("dashboard.actionQueue"),
          assignments: t("dashboard.assignments"),
          activation: t("dashboard.activation"),
          progressLabel: t("dashboard.todayProgress"),
        }}
        stats={[
          { key: "approvals", count: DEMO_APPROVALS.length, tone: "amber" },
          { key: "actions", count: DEMO_ACTION_QUEUE.length, tone: "emerald" },
          { key: "assignments", count: DEMO_ASSIGNMENTS.length, tone: "sky" },
          { key: "activation", count: stepsDone, tone: "graphite" },
        ]}
        progress={Math.round((stepsDone / activationSteps.length) * 100)}
      />
      <QueueBoard kind="approval" title={t("dashboard.approvalQueue")} empty={t("dashboard.empty")} items={DEMO_APPROVALS} />
      <QueueBoard kind="action" title={t("dashboard.actionQueue")} empty={t("dashboard.empty")} items={DEMO_ACTION_QUEUE} />
      <AssignmentReview assignments={DEMO_ASSIGNMENTS} total={126} confident={DEMO_ASSIGNMENTS.filter(a => a.confidence === "high").length} />

      {latestPipeline && (
        <Panel
          title={t("dashboard.activation")}
          tone="sky"
          icon={FileCheck2}
          hint={t("dashboard.stepComplete", { done: stepsDone, total: activationSteps.length })}
          action={
            <Mono className="text-[11px] text-faint">{lt(latestPipeline.file, locale)}</Mono>
          }
        >
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6">
            {activationSteps.map((step) => (
              <div key={step.key} className="flex flex-col gap-1.5 bg-bg px-4 py-3.5">
                <span
                  className={
                    step.done === true
                      ? "text-verified"
                      : step.done === null
                        ? "text-partial"
                        : "text-missing"
                  }
                >
                  {step.done === true ? "✓" : step.done === null ? "◐" : "●"}
                </span>
                <span className="text-[11px] font-medium">{stepLabels[step.key]}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-line px-4 py-3">
            <Link
              href={`/app/contracts/${latestPipeline.contractId}`}
              className="flex items-center gap-1.5 text-xs font-medium text-fg hover:underline"
            >
              {t("dashboard.continueActivation")} <ArrowRight size={12} className="rtl:-scale-x-100" />
            </Link>
          </div>
        </Panel>
      )}

      <Panel title={t("dashboard.claimsBlockerTitle")} tone="rose" icon={Ban} action={<Link href="/app/claims" className="flex items-center gap-1 text-xs text-rose-100/90 hover:text-white">{t("nav.claims")} <ArrowRight size={12} className="rtl:-scale-x-100" /></Link>}>
        <ul className="divide-y divide-line">
          {preparing.map((cl) => {
            const blocking = cl.requirements.filter((r) => r.status !== "verified");
            const primary = blocking[0];
            const r = claimReadiness(cl);
            return (
              <li key={cl.id}>
                <Link href={`/app/contracts/${cl.contractId}/claims`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-fg/3">
                  <Ring value={r} size={48} stroke={4} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{t("claims.claim", { number: cl.number })} · {titles[cl.contractId]}</span>
                    <span className="text-xs text-muted">{lt(cl.period, locale)} · {t("claims.target", { date: f.dateTime(new Date(cl.targetDate), "short") })}</span>
                    {primary && (
                      <span className="mt-0.5 text-[11px] text-partial">{lt(primary.label, locale)}{blocking.length > 1 && ` · +${blocking.length - 1}`}</span>
                    )}
                  </div>
                  <Mono className="text-sm">{formatMoney(cl.amount, locale, cl.currency, { compact: true })}</Mono>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        title={t("dashboard.atRisk")}
        tone="amber"
        icon={AlertOctagon}
        action={
          <Link href="/app/contracts" className="flex items-center gap-1 text-xs text-amber-100/90 hover:text-white">
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

      <Panel title={t("dashboard.officerActivity")} tone="emerald" icon={Bot} action={<Link href="/app/agent" className="flex items-center gap-1 text-xs text-emerald-100/90 hover:text-white">{t("nav.officer")} <ArrowRight size={12} className="rtl:-scale-x-100" /></Link>}>
        <OfficerFeed events={events} contractTitles={titles} />
      </Panel>
    </>
  );
}
