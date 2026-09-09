import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ClauseTrace } from "@/components/app/clause-trace";
import { OfficerFeed } from "@/components/app/officer-feed";
import { Kpi, Mono, Panel, Ring, StackedBar } from "@/components/app/primitives";
import { StatusDot, statusTone, toneDot } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { claimReadiness, countBy, type ObligationStatus } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

const STATUS_ORDER: ObligationStatus[] = ["verified", "partial", "missing", "overdue", "at_risk", "pending"];

export default async function ContractOverview(props: PageProps<"/[locale]/app/contracts/[id]">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const st = await getTranslations("status");
  const c = await getTranslations("common");
  const sev = await getTranslations("severity");
  const f = await getFormatter();
  const { orgId, db } = await requireTenant();

  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();

  const [obligations, clauses, evidence, risks, claims, actions, events, activity] = await Promise.all([
    db.obligations.list(orgId, { contractId: id }),
    db.contracts.listClauses(orgId, id),
    db.evidence.list(orgId, { contractId: id }),
    db.risks.list(orgId, { contractId: id }),
    db.claims.list(orgId, { contractId: id }),
    db.actions.list(orgId, { contractId: id }),
    db.agent.listEvents(orgId, { contractId: id, limit: 5 }),
    db.activity.list(orgId, { contractId: id, limit: 6 }),
  ]);

  const h = contract.health;
  const byStatus = countBy(obligations, (o) => o.status);
  const nextClaim = claims.find((c) => c.status === "preparing" || c.status === "ready");
  const openRisks = risks.filter((r) => r.status !== "closed").sort((a, b) => b.exposure - a.exposure);

  // Trace the obligation the Officer is most concerned about (missing first, then partial).
  const traced =
    obligations.find((o) => o.status === "missing") ?? obligations.find((o) => o.status === "partial") ?? obligations[0];
  const tracedClause = traced ? clauses.find((c) => c.id === traced.clauseId) : undefined;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("obligations.title")} value={h.obligationsTotal} hint={t("contracts.due", { count: h.obligationsDueThisMonth })} />
        <Kpi label={t("dashboard.kpis.overdue")} value={h.obligationsOverdue} tone={h.obligationsOverdue ? "missing" : undefined} />
        <Kpi label={t("dashboard.kpis.coverage")} value={f.number(h.evidenceCoverage, "percent")} tone={h.evidenceCoverage >= 0.85 ? "verified" : "partial"} />
        <Kpi label={t("contract.openRisks")} value={h.risksOpen} tone={h.risksOpen ? "at_risk" : undefined} />
        <Kpi label={t("dashboard.kpis.exposure")} value={<Mono className="text-2xl">{formatMoney(h.riskExposure, locale, contract.currency, { compact: true })}</Mono>} tone="at_risk" />
        <Kpi label={t("dashboard.kpis.readiness")} value={f.number(h.claimReadiness, "percent")} tone={h.claimReadiness >= 0.9 ? "verified" : "partial"} hint={nextClaim ? t("claims.claim", { number: nextClaim.number }) : undefined} />
      </div>

      <Panel title={t("contract.clauseTrace")} hint={t("contract.clauseTraceHint")}>
        <div className="p-4">
          {traced && tracedClause ? (
            <ClauseTrace clause={tracedClause} obligation={traced} evidence={evidence.filter((e) => e.obligationId === traced.id)} />
          ) : null}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={t("contract.obligationsByStatus")} hint={t("contract.healthHint")}>
          <div className="p-5">
            <StackedBar
              segments={STATUS_ORDER.filter((s) => byStatus[s]).map((s) => ({
                key: s,
                value: byStatus[s] ?? 0,
                className: toneDot[statusTone[s]],
                label: st(s),
              }))}
            />
          </div>
        </Panel>

        <Panel
          title={t("contract.nextClaim")}
          action={nextClaim && <Link href={`/app/contracts/${id}/claims`} className="text-xs text-muted hover:text-fg">{c("viewAll")}</Link>}
        >
          {nextClaim ? (
            <div className="flex items-center gap-5 p-5">
              <Ring value={claimReadiness(nextClaim)} size={80} stroke={6} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{t("claims.claim", { number: nextClaim.number })} · {lt(nextClaim.period, locale)}</span>
                <Mono className="text-base">{formatMoney(nextClaim.amount, locale, nextClaim.currency)}</Mono>
                <span className="text-xs text-muted">{t("claims.target", { date: f.dateTime(new Date(nextClaim.targetDate), "medium") })}</span>
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {(["verified", "partial", "missing"] as const).map((s) => {
                    const n = nextClaim.requirements.filter((r) => r.status === s).length;
                    return (
                      <li key={s} className="flex items-center gap-1.5">
                        <StatusDot tone={s} /> {st(s)} <span className="font-mono tabular text-fg">{n}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <p className="p-5 text-sm text-muted">—</p>
          )}
        </Panel>

        <Panel title={t("contract.openRisks")} action={<Link href={`/app/contracts/${id}/risks`} className="text-xs text-muted hover:text-fg">{c("viewAll")}</Link>}>
          <ul className="divide-y divide-line">
            {openRisks.slice(0, 3).map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                <StatusDot tone={r.severity === "critical" || r.severity === "high" ? "missing" : "at_risk"} className="mt-1.5" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{lt(r.title, locale)}</span>
                  <span className="text-xs text-muted">
                    {t("risks.linkedClause", { ref: r.clauseRef })} · {sev(r.severity)} · {t("risks.daysToImpact", { days: r.daysToImpact })}
                  </span>
                </div>
                <Mono className="text-sm text-at-risk">{formatMoney(r.exposure, locale, contract.currency, { compact: true })}</Mono>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t("contract.officerFeed")} action={<Link href={`/app/contracts/${id}/officer`} className="text-xs text-muted hover:text-fg">{c("viewAll")}</Link>}>
          <OfficerFeed events={events} showContract={false} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={t("contract.actions")}>
            <ul className="divide-y divide-line">
              {actions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <StatusDot tone={a.status === "done" ? "verified" : a.status === "in_progress" ? "partial" : "pending"} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{lt(a.title, locale)}</span>
                    <span className="text-xs text-muted">{a.ownerName}</span>
                  </div>
                  <Mono className="text-muted">{f.dateTime(new Date(a.dueDate), "short")}</Mono>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t("contract.recentActivity")} action={<Link href={`/app/contracts/${id}/activity`} className="text-xs text-muted hover:text-fg">{c("viewAll")}</Link>}>
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 px-5 py-3">
                  <span className="text-sm">
                    <span className="font-medium">{a.actor}</span> {lt(a.action, locale)}
                    {a.target && <> <Mono>{a.target}</Mono></>}
                  </span>
                  <span className="text-xs text-muted">{f.dateTime(new Date(a.at), "medium")}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
