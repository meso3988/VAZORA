import { Clock, MessageSquarePlus } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import {
  acknowledgeOfficerObservation,
  approveOfficerActionForm,
  askOfficerQuestion,
  explainOfficerObservation,
  proposeObservationFollowUp,
  rejectOfficerActionForm,
  runOfficerSweep,
  setOrganizationTimezone,
  startOfficerConversation,
} from "@/app/[locale]/app/agent/actions";
import { CommandCenter } from "@/components/app/officer/command-center";
import { OfficerThread } from "@/components/app/officer/thread";
import { TodayBriefPanel } from "@/components/app/officer/today-brief";
import { Empty, Mono, PageHeader, Panel } from "@/components/app/primitives";
import { auth } from "@/data/auth/provider";
import type { OfficerTier } from "@/data/mock/queues";
import { DEMO_OFFICER_ITEMS } from "@/data/mock/queues";
import type { OfficerActionView, OfficerMessageView } from "@/domain/officer";
import { roleHasCapability } from "@/lib/officer/authority";
import { buildTodayBrief, renderBriefNarrative } from "@/lib/officer/brief";
import { getConversation, listConversations } from "@/lib/officer/conversation";
import { buildOfficerContext, ensureOfficerProfile } from "@/lib/officer/context";
import { listObservations, markReviewed } from "@/lib/officer/observations";
import { officerProviderConfigured } from "@/lib/officer/provider";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { asLocale } from "@/i18n/params";
import { cn, lt } from "@/lib/utils";

// Register adapters so provider configuration is detectable on the page.
import "@/lib/officer/providers/anthropic";
import "@/lib/officer/providers/openai-compat";

export async function generateMetadata(props: PageProps<"/[locale]/app/agent">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.officer" });
  return { title: t("title") };
}

/** A short, defensible IANA list; the officer accepts any valid zone. */
const TIMEZONES = [
  "UTC", "Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Kuwait", "Asia/Bahrain",
  "Africa/Cairo", "Europe/London", "Europe/Paris", "Europe/Istanbul",
  "Asia/Karachi", "Asia/Kolkata", "Asia/Singapore", "America/New_York", "America/Los_Angeles",
];

export default async function AgentPage(props: PageProps<"/[locale]/app/agent">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const {
    c: conversationParam, error, approved, rejected,
    swept, created, resolved, acknowledged, proposed,
  } = await props.searchParams;
  const t = await getTranslations("app.officer");
  const session = await auth.getSession();

  // DEMO MODE ONLY: illustrative officer fixtures never mix into a real
  // tenant workspace. Real tenants get the grounded Officer below.
  if (session?.mode !== "live" || !session.organizationId) {
    return <DemoOfficer locale={locale} />;
  }

  const supabase = await createSupabaseServer();
  await ensureOfficerProfile({ supabase, organizationId: session.organizationId });
  const ctx = await buildOfficerContext({
    supabase, organizationId: session.organizationId, userId: session.user.id, locale,
  });
  if (!ctx) return <DemoOfficer locale={locale} />;

  const { data: org } = await supabase
    .from("organizations").select("timezone, timezone_set_at")
    .eq("id", session.organizationId).maybeSingle();
  const timezoneConfigured = !!org?.timezone_set_at;

  const conversations = await listConversations(ctx);
  const activeId = typeof conversationParam === "string" ? conversationParam : conversations[0]?.id ?? null;
  const loaded = activeId ? await getConversation(ctx, activeId) : null;

  let actions: OfficerActionView[] = [];
  if (loaded) {
    const ids = loaded.messages.flatMap((m) => m.proposedActionIds);
    if (ids.length) {
      const { data } = await supabase
        .from("officer_actions").select("*")
        .eq("organization_id", ctx.organizationId).in("id", ids);
      actions = (data ?? []).map(mapAction);
    }
  }

  const canApprove = roleHasCapability(ctx.role, "officer.action.approve");
  const providerConfigured = officerProviderConfigured();

  // Proactive monitoring — deterministic brief first; the narrative is one
  // bounded model pass over it and is optional by design.
  const brief = await buildTodayBrief(ctx);
  const resolvedSince = brief.since;
  const observations = await listObservations(ctx, { includeResolvedSince: resolvedSince });
  const { data: lastSweep } = await supabase
    .from("officer_sweep_runs")
    .select("started_at, completed_at, status")
    .eq("organization_id", ctx.organizationId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const narrative = await renderBriefNarrative(ctx, brief, { displayName: null });
  // Reading the Command Center IS the review — the watermark must be real.
  await markReviewed(ctx);

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>{t("subtitle")}</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Clock size={12} strokeWidth={1.75} aria-hidden />
              {ctx.clock.today} · {ctx.clock.localTime} <Mono>{ctx.clock.timeZone}</Mono>
            </span>
          </span>
        }
        actions={
          <form action={startOfficerConversation}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-xs font-medium text-fg transition-colors hover:bg-fg/5">
              <MessageSquarePlus size={13} strokeWidth={1.75} aria-hidden />
              {t("newConversation")}
            </button>
          </form>
        }
      />

      {/* One-time honest prompt — never leave a real organization silently on UTC */}
      {!timezoneConfigured && (
        <section className="flex flex-col gap-2 rounded-md border border-partial/40 bg-partial/5 px-4 py-3" role="status">
          <p className="text-xs font-medium">{t("timezone.prompt")}</p>
          <p className="text-[11px] leading-relaxed text-muted">{t("timezone.why", { current: org?.timezone ?? "UTC" })}</p>
          <form action={setOrganizationTimezone} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="returnTo" value="/app/agent" />
            <select
              name="timezone"
              defaultValue={org?.timezone ?? "UTC"}
              aria-label={t("timezone.label")}
              className="h-7 rounded-md border border-line bg-bg px-2 text-xs text-fg"
            >
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <button type="submit" className="inline-flex h-7 items-center rounded-sm border border-line bg-fg px-2.5 text-xs font-medium text-bg hover:bg-fg/90">
              {t("timezone.save")}
            </button>
          </form>
        </section>
      )}

      {typeof error === "string" && error && (
        <p className="rounded-md border border-missing/40 bg-missing/5 px-4 py-3 text-xs text-missing" role="alert">
          {t("errorNotice", { code: decodeURIComponent(error) })}
        </p>
      )}
      {(typeof approved === "string" && approved) || (typeof rejected === "string" && rejected) ? (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {approved ? t("action.approvedNotice") : t("action.rejectedNotice")}
        </p>
      ) : null}
      {typeof swept === "string" && swept && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {t("center.sweptNotice", {
            status: swept,
            created: typeof created === "string" ? created : "0",
            resolved: typeof resolved === "string" ? resolved : "0",
          })}
        </p>
      )}
      {typeof acknowledged === "string" && acknowledged && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {t("center.acknowledgedNotice")}
        </p>
      )}
      {typeof proposed === "string" && proposed && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {t("center.proposedNotice")}
        </p>
      )}

      {!providerConfigured && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {t("providerMissingNotice")}
        </p>
      )}

      {/* ===== Today Brief — deterministic counts, optional narrative ===== */}
      <Panel title={t("brief.title")} tone="amber">
        <TodayBriefPanel
          brief={brief}
          narrative={narrative.text}
          displayName={null}
          locale={locale}
          sweepAction={runOfficerSweep}
          lastSweepAt={(lastSweep?.completed_at as string | null) ?? (lastSweep?.started_at as string | null) ?? null}
          sweepStatus={(lastSweep?.status as string | null) ?? null}
        />
      </Panel>

      {/* ===== Command Center — the working surface ===== */}
      <Panel
        title={t("center.title")}
        tone={brief.counts.critical > 0 ? "rose" : observations.length ? "emerald" : "graphite"}
        hint={t("center.hint", { count: observations.filter((o) => o.status !== "resolved").length })}
      >
        <CommandCenter
          observations={observations}
          locale={locale}
          acknowledgeAction={acknowledgeOfficerObservation}
          explainAction={explainOfficerObservation}
          proposeFollowUpAction={proposeObservationFollowUp}
        />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        {/* conversation list */}
        <Panel title={t("conversations")} tone="graphite" className="order-2 lg:order-1">
          {conversations.length === 0 ? (
            <Empty>{t("noConversations")}</Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {conversations.map((conv) => (
                <li key={conv.id}>
                  <Link
                    href={`/app/agent?c=${conv.id}`}
                    className={cn(
                      "flex flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-fg/3",
                      conv.id === activeId && "bg-fg/5",
                    )}
                    aria-current={conv.id === activeId ? "true" : undefined}
                  >
                    <span className="truncate text-xs font-medium">{conv.title ?? t("untitled")}</span>
                    <span className="text-[10px] text-faint">
                      {conv.scope === "contract" ? t("scopeContract") : t("scopeOrganization")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* conversation thread */}
        <Panel title={t("conversation")} tone="emerald" className="order-1 lg:order-2">
          {loaded ? (
            <OfficerThread
              messages={loaded.messages as OfficerMessageView[]}
              actions={actions}
              conversationId={loaded.conversation.id}
              locale={locale}
              canApprove={canApprove}
              askAction={askOfficerQuestion}
              approveAction={approveOfficerActionForm}
              rejectAction={rejectOfficerActionForm}
              providerConfigured={providerConfigured}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
              <p className="text-sm text-muted">{t("startPrompt")}</p>
              <form action={startOfficerConversation}>
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-fg px-3 text-xs font-medium text-bg hover:bg-fg/90">
                  <MessageSquarePlus size={13} strokeWidth={1.75} aria-hidden />
                  {t("newConversation")}
                </button>
              </form>
            </div>
          )}
        </Panel>
      </div>

    </>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapAction(row: any): OfficerActionView {
  return {
    id: row.id,
    contractId: row.contract_id,
    obligationId: row.obligation_id,
    conversationId: row.conversation_id,
    actionType: row.action_type,
    arguments: row.arguments ?? {},
    reason: row.reason,
    citations: row.citations ?? [],
    riskLevel: row.risk_level,
    requiresApproval: row.requires_approval,
    status: row.status,
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    rejectedBy: row.rejected_by,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    executedAt: row.executed_at,
    executionResult: row.execution_result,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

const TIERS: { key: OfficerTier; accent: string }[] = [
  { key: "critical", accent: "text-missing" },
  { key: "today", accent: "text-partial" },
  { key: "thisWeek", accent: "text-fg" },
  { key: "monitoring", accent: "text-muted" },
];

/** Illustrative fixtures — demo sessions only, never a real tenant. */
async function DemoOfficer({ locale }: { locale: string }) {
  const t = await getTranslations("app.officer");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Panel title={t("command")} tone="emerald" hint={t("demoFixtures")}>
        <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-2">
          {TIERS.map(({ key, accent }) => {
            const items = DEMO_OFFICER_ITEMS.filter((i) => i.tier === key);
            return (
              <section key={key} className="flex flex-col bg-bg">
                <header className="flex items-center gap-2 border-b border-line px-5 py-3">
                  <span className={cn("text-[11px] font-semibold uppercase tracking-wide", accent)}>
                    {t(`tiers.${key}`)}
                  </span>
                  <span className="ms-auto font-mono text-[10px] text-faint">{items.length}</span>
                </header>
                <ul className="flex flex-col">
                  {items.map((item) => (
                    <li key={item.id} className="border-b border-line px-5 py-4 last:border-b-0">
                      <div className="flex items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span dir="ltr" className="font-mono text-xs text-muted">{item.ref}</span>
                            <span className="text-sm font-medium">{lt(item.title, locale)}</span>
                          </div>
                          <dl className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed">
                            <div><dt className="inline font-medium text-muted">{t("happened")}: </dt><dd className="inline text-muted">{lt(item.happened, locale)}</dd></div>
                            <div><dt className="inline font-medium text-muted">{t("matters")}: </dt><dd className="inline text-muted">{lt(item.matters, locale)}</dd></div>
                            <div><dt className="inline font-medium text-verified">{t("recommends")}: </dt><dd className="inline text-fg">{lt(item.recommends, locale)}</dd></div>
                            {item.exposure && <div><dt className="inline font-medium text-at-risk">{t("exposure")}: </dt><dd className="inline text-at-risk">{lt(item.exposure, locale)}</dd></div>}
                            {item.dueIn && <div><dt className="inline font-medium text-muted">{t("dueIn")}: </dt><dd className="inline text-partial">{lt(item.dueIn, locale)}</dd></div>}
                          </dl>
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <Link href={item.href} className="font-medium text-fg hover:underline">{locale === "ar" ? "استجب الآن" : "Act now"}</Link>
                            <Link href={item.sourceHref} className="text-muted hover:text-fg hover:underline">→ {t("source")}</Link>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
