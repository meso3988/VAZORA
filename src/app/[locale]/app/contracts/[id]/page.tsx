import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { ClauseTrace } from "@/components/app/clause-trace";
import { ContractLoadFailed, DataLoadFailed } from "@/components/app/contract-unavailable";
import { ContractLifecycle } from "@/components/app/contract-lifecycle";
import { DeferredNotice } from "@/components/app/deferred-notice";
import { IndicatorValue, indicatorNote, indicatorValue } from "@/components/app/indicator";
import { readContractIndicators } from "@/data/contract-indicators";
import { IngestionControls } from "@/components/app/ingestion-controls";
import { IntakeTimeline } from "@/components/app/intake-timeline";
import { OfficerFeed } from "@/components/app/officer-feed";
import { DocumentPanel } from "@/components/app/document-panel";
import { Kpi, Mono, Panel, Ring, StackedBar } from "@/components/app/primitives";
import { StatusDot, statusTone, toneDot } from "@/components/ui/status";
import { auth } from "@/data/auth/provider";
import { readActivityList, readAgentEvents, readClauseList, readContract, readDocumentList, readEvidenceList, readObligationList, requireTenant } from "@/data/context";
import { listOfficerActions } from "@/data/supabase/officer-queue";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DEMO_PIPELINE } from "@/data/mock/pipeline";
import { claimReadiness, countBy, type ObligationStatus } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { formatMoney, lt, validDate } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

const STATUS_ORDER: ObligationStatus[] = ["verified", "partial", "missing", "overdue", "at_risk", "pending"];

// A failed ingestion read reports ok:false — zeroed stats or a "no run yet"
// state must never be derived from a dropped query.
async function getLatestIngestionRun(orgId: string, contractId: string) {
  try {
    const { createSupabaseServer } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase
      .from("contract_ingestion_runs")
      .select("id, status, error_code")
      .eq("organization_id", orgId)
      .eq("contract_id", contractId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false as const };
    if (!data) return { ok: true as const, run: null };
    const { count, error: countError } = await supabase
      .from("contract_obligations")
      .select("id", { count: "exact", head: true })
      .eq("ingestion_run_id", data.id);
    if (countError) return { ok: false as const };
    return { ok: true as const, run: { id: data.id as string, status: data.status as string, error_code: data.error_code as string | null, obligations: count ?? 0 } };
  } catch {
    return { ok: false as const };
  }
}

async function getIngestionSummary(orgId: string, contractId: string) {
  try {
    const { createSupabaseServer } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase
      .from("contract_obligations")
      .select("review_status, payment_linked, financial_condition, external_dependency, frequency")
      .eq("organization_id", orgId)
      .eq("contract_id", contractId);
    if (error || !Array.isArray(data)) return { ok: false as const };
    const rows = data;
    return {
      ok: true as const,
      summary: {
        obligations: rows.length,
        needsReview: rows.filter((o) => o.review_status === "needs_review" || o.review_status === "conflict_requires_review").length,
        conflictCount: rows.filter((o) => o.review_status === "conflict_requires_review").length,
        paymentLinked: rows.filter((o) => o.payment_linked === true).length,
        financial: rows.filter((o) => o.financial_condition !== null).length,
        externalDeps: rows.filter((o) => o.external_dependency !== null).length,
        recurring: rows.filter((o) => o.frequency !== null).length,
      },
    };
  } catch {
    return { ok: false as const };
  }
}

export default async function ContractOverview(props: PageProps<"/[locale]/app/contracts/[id]">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const oa = await getTranslations("app.officer.action");
  const st = await getTranslations("status");
  const c = await getTranslations("common");
  const sev = await getTranslations("severity");
  const f = await getFormatter();
  const sp = await props.searchParams;
  const uploadState = typeof sp.uploaded === "string" ? "uploaded" : typeof sp.error === "string" ? sp.error : undefined;
  const analysisState = typeof sp.analysis === "string" ? sp.analysis : undefined;
  const { orgId, db } = await requireTenant();
  const session = await auth.getSession();
  const isLive = session?.mode === "live";

  const read = await readContract(db, orgId, id, session?.mode === "demo");
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const contract = read.contract;

  const isDemo = session?.mode === "demo";
  const liveQueue = isLive ? createSupabaseServer().then((s) => listOfficerActions(s, orgId, { contractId: id, limit: 6 })) : null;
  const [obligationsRead, clausesRead, evidenceRead, risks, claims, demoActions, eventsRead, activityRead, documentsRead, latestRunRead, summaryRead, actionsRead, indicatorsRead] = await Promise.all([
    readObligationList(db, orgId, isDemo, { contractId: id }),
    readClauseList(db, orgId, id, isDemo),
    readEvidenceList(db, orgId, isDemo, { contractId: id }),
    // Risks and claims are deferred capabilities: only demo fixtures exist.
    isDemo ? db.risks.list(orgId, { contractId: id }) : Promise.resolve([]),
    isDemo ? db.claims.list(orgId, { contractId: id }) : Promise.resolve([]),
    isDemo ? db.actions.list(orgId, { contractId: id }) : Promise.resolve(null),
    readAgentEvents(db, orgId, isDemo, { contractId: id, limit: 5 }),
    readActivityList(db, orgId, isDemo, { contractId: id, limit: 6 }),
    readDocumentList(db, orgId, id, isDemo),
    isLive ? getLatestIngestionRun(orgId, id) : Promise.resolve({ ok: true as const, run: null }),
    isLive ? getIngestionSummary(orgId, id) : Promise.resolve({ ok: true as const, summary: null }),
    liveQueue ?? Promise.resolve(null),
    readContractIndicators({ isDemo, contracts: [contract], orgId, userId: session?.user.id ?? "", locale }),
  ]);
  const obligations = obligationsRead.ok ? obligationsRead.obligations : null;
  const evidence = evidenceRead.ok ? evidenceRead.evidence : null;
  const clauses = clausesRead.ok ? clausesRead.clauses : null;
  const clauseBasis = clausesRead.ok ? clausesRead.basis : null;
  const events = eventsRead.ok ? eventsRead.events : null;
  const activity = activityRead.ok ? activityRead.activity : null;
  const documents = documentsRead.ok ? documentsRead.documents : null;
  const officerActions = actionsRead?.ok ? actionsRead.actions : null;

  const ind = indicatorsRead.byContract.get(id);
  const due = indicatorValue(ind?.obligationsDueThisMonth);
  const overdue = indicatorValue(ind?.obligationsOverdue);
  const coverage = indicatorValue(ind?.evidenceCoverage);
  const risksOpen = indicatorValue(ind?.risksOpen);
  const readiness = indicatorValue(ind?.claimReadiness);
  const pipeline = DEMO_PIPELINE.find((run) => run.contractId === id);
  const byStatus = countBy(obligations ?? [], (o) => o.status);
  const nextClaim = claims
    .filter((c) => c.status === "preparing" || c.status === "ready")
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0];
  const openRisks = risks.filter((r) => r.status !== "closed").sort((a, b) => b.exposure - a.exposure);

  // Trace the obligation the Officer is most concerned about (missing first, then partial).
  const traced = obligations
    ? obligations.find((o) => o.status === "missing") ?? obligations.find((o) => o.status === "partial") ?? obligations[0]
    : undefined;
  const tracedClause = traced && clauses ? clauses.find((c) => c.id === traced.clauseId) : undefined;

  return (
    <>
      <ContractLifecycle contract={contract} nextClaim={nextClaim} indicators={ind} today={indicatorsRead.today} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={isDemo ? t("obligations.title") : t("indicator.activeObligations")}
          value={<IndicatorValue name="obligationsTotal" indicator={ind?.obligationsTotal} />}
          hint={due != null ? t("contracts.due", { count: due }) : await indicatorNote(ind?.obligationsTotal)}
        />
        <Kpi
          label={t("dashboard.kpis.overdue")}
          value={<IndicatorValue name="obligationsOverdue" indicator={ind?.obligationsOverdue} />}
          tone={overdue ? "missing" : undefined}
          hint={await indicatorNote(ind?.obligationsOverdue)}
        />
        <Kpi
          label={t("dashboard.kpis.coverage")}
          value={<IndicatorValue name="evidenceCoverage" indicator={ind?.evidenceCoverage} format="percent" />}
          tone={coverage == null ? undefined : coverage >= 0.85 ? "verified" : "partial"}
          hint={await indicatorNote(ind?.evidenceCoverage)}
        />
        <Kpi
          label={t("contract.openRisks")}
          value={<IndicatorValue name="risksOpen" indicator={ind?.risksOpen} />}
          tone={risksOpen ? "at_risk" : undefined}
          hint={await indicatorNote(ind?.risksOpen)}
        />
        <Kpi
          label={t("dashboard.kpis.exposure")}
          value={<Mono className="text-2xl"><IndicatorValue name="riskExposure" indicator={ind?.riskExposure} format={{ money: contract.currency }} compact /></Mono>}
          tone={indicatorValue(ind?.riskExposure) != null ? "at_risk" : undefined}
          hint={await indicatorNote(ind?.riskExposure)}
        />
        <Kpi
          label={t("dashboard.kpis.readiness")}
          value={<IndicatorValue name="claimReadiness" indicator={ind?.claimReadiness} format="percent" />}
          tone={readiness == null ? undefined : readiness >= 0.9 ? "verified" : "partial"}
          hint={readiness != null && nextClaim ? t("claims.claim", { number: nextClaim.number }) : await indicatorNote(ind?.claimReadiness)}
        />
      </div>

      <Panel title={t("contract.clauseTrace")} tone="sky" hint={t("contract.clauseTraceHint")}>
        <div className="p-4">
          {!obligations || !evidence || !clauses ? (
            <DataLoadFailed message="dataLoadFailed" />
          ) : (
            <>
              {clauseBasis === "ready_for_review" && (
                <p className="mb-3 flex items-start gap-1.5 rounded-sm border border-partial/40 bg-partial/5 p-2 text-[11px] leading-relaxed text-muted" role="status">
                  {t("contract.unapprovedClauses")}
                  <Link href={`/app/contracts/${id}/review`} className="shrink-0 font-medium text-fg hover:underline">{c("viewAll")}</Link>
                </p>
              )}
              {traced && tracedClause && (
                <ClauseTrace clause={tracedClause} obligation={traced} evidence={evidence.filter((e) => e.obligationId === traced.id)} />
              )}
            </>
          )}
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

      {isLive && (!latestRunRead.ok || !summaryRead.ok ? (
        <Panel tone="emerald" title={t("ingestion.title")}>
          <div className="px-5 py-4"><DataLoadFailed message="dataLoadFailed" /></div>
        </Panel>
      ) : (
        <IngestionControls
          contractId={id}
          locale={locale}
          hasDocuments={(documents ?? []).length > 0}
          canRun={isLive}
          currentRun={latestRunRead.run}
          analysis={summaryRead.summary}
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
      ))}

      {pipeline && <IntakeTimeline pipeline={pipeline} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title={t("contract.obligationsByStatus")} tone="emerald" hint={t("contract.healthHint")}>
          <div className="p-5">
            {obligations === null ? (
              <DataLoadFailed message="dataLoadFailed" />
            ) : (
              <StackedBar
                segments={STATUS_ORDER.filter((s) => byStatus[s]).map((s) => ({
                  key: s,
                  value: byStatus[s] ?? 0,
                  className: toneDot[statusTone[s]],
                  label: st(s),
                }))}
              />
            )}
          </div>
        </Panel>

        {!isDemo ? (
          <>
            <Panel title={t("contract.nextClaim")}><DeferredNotice feature="claims" framed={false} /></Panel>
            <Panel title={t("contract.openRisks")} tone="rose"><DeferredNotice feature="risks" framed={false} /></Panel>
          </>
        ) : (<>
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
        </>)}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title={t("contract.officerFeed")} tone="emerald" action={<Link href={`/app/contracts/${id}/officer`} className="text-xs text-emerald-100/90 hover:text-white">{c("viewAll")}</Link>}>
          {events === null ? (
            <div className="p-4"><DataLoadFailed message="dataLoadFailed" /></div>
          ) : (
            <OfficerFeed events={events} showContract={false} />
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title={t("contract.actions")} tone="amber" action={<Link href="/app/tasks" className="text-xs text-amber-100/90 hover:text-white">{c("viewAll")}</Link>}>
            {isDemo ? (
              <ul className="divide-y divide-line">
                {(demoActions ?? []).map((a) => (
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
            ) : officerActions === null ? (
              <div className="p-4"><DataLoadFailed message="dataLoadFailed" /></div>
            ) : officerActions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{t("contract.noActions")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {officerActions.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <StatusDot tone={a.status === "completed" ? "verified" : a.status === "rejected" || a.status === "failed" || a.status === "cancelled" ? "missing" : a.status === "approved" ? "partial" : "pending"} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm">
                        {typeof a.arguments?.summary === "string" && a.arguments.summary ? a.arguments.summary
                          : typeof a.arguments?.title === "string" && a.arguments.title ? a.arguments.title
                          : a.actionType}
                      </span>
                      <span className="text-xs text-muted">
                        {oa.has(`status.${a.status}`) ? oa(`status.${a.status}`) : a.status}
                      </span>
                    </div>
                    <Mono className="text-muted">{validDate(a.createdAt) ? f.dateTime(validDate(a.createdAt)!, "short") : "—"}</Mono>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t("contract.recentActivity")} tone="graphite" action={<Link href={`/app/contracts/${id}/activity`} className="text-xs text-neutral-200/90 hover:text-white">{c("viewAll")}</Link>}>
            {activity === null ? (
              <div className="p-4"><DataLoadFailed message="dataLoadFailed" /></div>
            ) : activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">—</p>
            ) : (
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
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
