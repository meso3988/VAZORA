import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ClauseTrace } from "@/components/app/clause-trace";
import { ContractLifecycle } from "@/components/app/contract-lifecycle";
import { IngestionControls } from "@/components/app/ingestion-controls";
import { IntakeTimeline } from "@/components/app/intake-timeline";
import { OfficerFeed } from "@/components/app/officer-feed";
import { DocumentPanel } from "@/components/app/document-panel";
import { Kpi, Mono, Panel, Ring, StackedBar } from "@/components/app/primitives";
import { StatusDot, statusTone, toneDot } from "@/components/ui/status";
import { auth } from "@/data/auth/provider";
import { requireTenant } from "@/data/context";
import { DEMO_PIPELINE } from "@/data/mock/pipeline";
import { claimReadiness, countBy, type ObligationStatus } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt, validDate } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

const STATUS_ORDER: ObligationStatus[] = ["verified", "partial", "missing", "overdue", "at_risk", "pending"];

async function getLatestIngestionRun(orgId: string, contractId: string) {
  const { createSupabaseServer } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("contract_ingestion_runs")
    .select("id, status, error_code")
    .eq("organization_id", orgId)
    .eq("contract_id", contractId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { count } = await supabase
    .from("contract_obligations")
    .select("id", { count: "exact", head: true })
    .eq("ingestion_run_id", data.id);
  return { id: data.id as string, status: data.status as string, error_code: data.error_code as string | null, obligations: count ?? 0 };
}

async function getIngestionSummary(orgId: string, contractId: string) {
  const { createSupabaseServer } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("contract_obligations")
    .select("review_status, payment_linked, financial_condition, external_dependency, frequency")
    .eq("organization_id", orgId)
    .eq("contract_id", contractId);
  const rows = data ?? [];
  return {
    obligations: rows.length,
    needsReview: rows.filter((o) => o.review_status === "needs_review" || o.review_status === "conflict_requires_review").length,
    conflictCount: rows.filter((o) => o.review_status === "conflict_requires_review").length,
    paymentLinked: rows.filter((o) => o.payment_linked === true).length,
    financial: rows.filter((o) => o.financial_condition !== null).length,
    externalDeps: rows.filter((o) => o.external_dependency !== null).length,
    recurring: rows.filter((o) => o.frequency !== null).length,
  };
}

export default async function ContractOverview(props: PageProps<"/[locale]/app/contracts/[id]">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const st = await getTranslations("status");
  const c = await getTranslations("common");
  const sev = await getTranslations("severity");
  const f = await getFormatter();
  const sp = await props.searchParams;
  const uploadState = typeof sp.uploaded === "string" ? "uploaded" : typeof sp.error === "string" ? sp.error : undefined;
  const analysisState = typeof sp.analysis === "string" ? sp.analysis : undefined;
  const { orgId, db } = await requireTenant();

  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();

  const session = await auth.getSession();
  const isLive = session?.mode === "live";

  const [obligations, clauses, evidence, risks, claims, actions, events, activity, documents, latestRun, obligationStats] = await Promise.all([
    db.obligations.list(orgId, { contractId: id }),
    db.contracts.listClauses(orgId, id),
    db.evidence.list(orgId, { contractId: id }),
    db.risks.list(orgId, { contractId: id }),
    db.claims.list(orgId, { contractId: id }),
    db.actions.list(orgId, { contractId: id }),
    db.agent.listEvents(orgId, { contractId: id, limit: 5 }),
    db.activity.list(orgId, { contractId: id, limit: 6 }),
    db.documents.list(orgId, id),
    isLive ? getLatestIngestionRun(orgId, id) : Promise.resolve(null),
    isLive ? getIngestionSummary(orgId, id) : Promise.resolve(null),
  ]);

  const h = contract.health;
  const pipeline = DEMO_PIPELINE.find((run) => run.contractId === id);
  const byStatus = countBy(obligations, (o) => o.status);
  const nextClaim = claims
    .filter((c) => c.status === "preparing" || c.status === "ready")
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0];
  const openRisks = risks.filter((r) => r.status !== "closed").sort((a, b) => b.exposure - a.exposure);

  // Trace the obligation the Officer is most concerned about (missing first, then partial).
  const traced =
    obligations.find((o) => o.status === "missing") ?? obligations.find((o) => o.status === "partial") ?? obligations[0];
  const tracedClause = traced ? clauses.find((c) => c.id === traced.clauseId) : undefined;

  return (
    <>
      <ContractLifecycle contract={contract} nextClaim={nextClaim} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label={t("obligations.title")} value={h.obligationsTotal} hint={t("contracts.due", { count: h.obligationsDueThisMonth })} />
        <Kpi label={t("dashboard.kpis.overdue")} value={h.obligationsOverdue} tone={h.obligationsOverdue ? "missing" : undefined} />
        <Kpi label={t("dashboard.kpis.coverage")} value={f.number(h.evidenceCoverage, "percent")} tone={h.evidenceCoverage >= 0.85 ? "verified" : "partial"} />
        <Kpi label={t("contract.openRisks")} value={h.risksOpen} tone={h.risksOpen ? "at_risk" : undefined} />
        <Kpi label={t("dashboard.kpis.exposure")} value={<Mono className="text-2xl">{formatMoney(h.riskExposure, locale, contract.currency, { compact: true })}</Mono>} tone="at_risk" />
        <Kpi label={t("dashboard.kpis.readiness")} value={f.number(h.claimReadiness, "percent")} tone={h.claimReadiness >= 0.9 ? "verified" : "partial"} hint={nextClaim ? t("claims.claim", { number: nextClaim.number }) : undefined} />
      </div>

      <Panel title={t("contract.clauseTrace")} tone="sky" hint={t("contract.clauseTraceHint")}>
        <div className="p-4">
          {traced && tracedClause ? (
            <ClauseTrace clause={tracedClause} obligation={traced} evidence={evidence.filter((e) => e.obligationId === traced.id)} />
          ) : null}
        </div>
      </Panel>

      <DocumentPanel
        contractId={id}
        locale={locale}
        documents={documents}
        canUpload={isLive}
        error={uploadState}
        labels={{
          title: t("documents.title"),
          hint: t("documents.hint"),
          upload: t("documents.upload"),
          empty: t("documents.empty"),
          open: t("documents.open"),
          uploaded: t("documents.uploaded"),
          demoReadonly: t("documents.demoReadonly"),
          errors: {
            noFile: t("documents.errors.noFile"),
            tooLarge: t("documents.errors.tooLarge"),
            type: t("documents.errors.type"),
            upload: t("documents.errors.upload"),
          },
        }}
      />

      {isLive && analysisState && (
        <p className="rounded-md border border-line bg-elevated px-4 py-2.5 text-xs text-muted">
          {analysisState === "unconfigured"
            ? t("ingestion.unconfigured")
            : analysisState === "nodocs"
              ? t("ingestion.needDocuments")
              : analysisState === "fail"
                ? t("ingestion.failed")
                : analysisState === "ok"
                  ? t("ingestion.readyHint")
                  : t("ingestion.unavailable")}
        </p>
      )}

      {isLive && (
        <IngestionControls
          contractId={id}
          locale={locale}
          hasDocuments={documents.length > 0}
          canRun={isLive}
          currentRun={latestRun}
          analysis={obligationStats}
          labels={{
            title: t("ingestion.title"),
            unavailable: t("ingestion.unavailable"),
            needDocuments: t("ingestion.needDocuments"),
            analyze: t("ingestion.analyze"),
            lastCounts: "",
            running: t("ingestion.running"),
            stages: t("ingestion.stages"),
            failed: t("ingestion.failed"),
            total: t("ingestion.total"),
            recurring: t("ingestion.recurring"),
            payment: t("ingestion.payment"),
            financial: t("ingestion.financial"),
            external: t("ingestion.external"),
            needsReview: t("ingestion.needsReview"),
            readyHint: t("ingestion.readyHint"),
          }}
        />
      )}

      {pipeline && <IntakeTimeline pipeline={pipeline} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={t("contract.obligationsByStatus")} tone="emerald" hint={t("contract.healthHint")}>
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

        <Panel title={t("contract.openRisks")} tone="rose" action={<Link href={`/app/contracts/${id}/risks`} className="text-xs text-rose-100/90 hover:text-white">{c("viewAll")}</Link>}>
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
        <Panel title={t("contract.officerFeed")} tone="emerald" action={<Link href={`/app/contracts/${id}/officer`} className="text-xs text-emerald-100/90 hover:text-white">{c("viewAll")}</Link>}>
          <OfficerFeed events={events} showContract={false} />
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={t("contract.actions")} tone="amber">
            <ul className="divide-y divide-line">
              {actions.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <StatusDot tone={a.status === "done" ? "verified" : a.status === "in_progress" ? "partial" : "pending"} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{lt(a.title, locale)}</span>
                    <span className="text-xs text-muted">{a.ownerName}</span>
                  </div>
                  <Mono className="text-muted">{validDate(a.dueDate) ? f.dateTime(validDate(a.dueDate)!, "short") : "—"}</Mono>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title={t("contract.recentActivity")} tone="graphite" action={<Link href={`/app/contracts/${id}/activity`} className="text-xs text-neutral-200/90 hover:text-white">{c("viewAll")}</Link>}>
            <ul className="divide-y divide-line">
              {activity.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 px-5 py-3">
                  <span className="text-sm">
                    <span className="font-medium">{a.actor}</span> {lt(a.action, locale)}
                    {a.target && <> <Mono>{a.target}</Mono></>}
                  </span>
                  <span className="text-xs text-muted">{validDate(a.at) ? f.dateTime(validDate(a.at)!, "medium") : "—"}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
