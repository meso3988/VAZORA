import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { approveOfficerActionForm, rejectOfficerActionForm } from "@/app/[locale]/app/agent/actions";
import { OfficerActionCard } from "@/components/app/officer/action-card";
import { ContractLoadFailed, DataLoadFailed } from "@/components/app/contract-unavailable";
import { Mono, PageHeader, Panel } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { readContractList, requireTenant } from "@/data/context";
import { DEMO_TODAY } from "@/data/mock/organization";
import type { ActionItem } from "@/domain/types";
import type { OfficerActionView } from "@/domain/officer";
import { Link } from "@/i18n/navigation";
import { asLocale } from "@/i18n/params";
import { listOfficerActions } from "@/data/supabase/officer-queue";
import { roleHasCapability } from "@/lib/officer/authority";
import { buildOfficerContext } from "@/lib/officer/context";
import { createSupabaseServer } from "@/lib/supabase/server";
import { daysBetween, lt, validDate } from "@/lib/utils";

export async function generateMetadata(props: PageProps<"/[locale]/app/tasks">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.tasks" });
  return { title: t("title") };
}

export default async function TasksPage(props: PageProps<"/[locale]/app/tasks">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.tasks");
  const f = await getFormatter();
  const { session, orgId, db } = await requireTenant();
  const read = await readContractList(db, orgId, session.mode === "demo");
  const titles = read.ok ? Object.fromEntries(read.contracts.map((c) => [c.id, lt(c.title, locale)])) : {};

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {!read.ok && <ContractLoadFailed />}
      {session.mode === "demo" ? (
        <DemoQueues db={db} orgId={orgId} titles={titles} locale={locale} t={t} f={f} />
      ) : (
        <LiveQueue orgId={orgId} userId={session.user.id} titles={titles} contractsLoaded={read.ok} locale={locale} t={t} />
      )}
    </>
  );
}

/**
 * Live mode: the same officer_actions the Officer conversation proposes —
 * one record, surfaced here as the approval/work queue. Nothing is copied
 * into a parallel task system; approve/reject reuse the existing server
 * actions, and the server re-authorizes the decision.
 */
async function LiveQueue({
  orgId,
  userId,
  titles,
  contractsLoaded,
  locale,
  t,
}: {
  orgId: string;
  userId: string;
  titles: Record<string, string>;
  contractsLoaded: boolean;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  const supabase = await createSupabaseServer();
  const [ctx, queue] = await Promise.all([
    buildOfficerContext({ supabase, organizationId: orgId, userId, locale }),
    listOfficerActions(supabase, orgId),
  ]);
  if (!queue.ok) {
    return <DataLoadFailed message="dataLoadFailed" />;
  }
  const canApprove = !!ctx && roleHasCapability(ctx.role, "officer.action.approve");

  const groups: { key: string; tone: "amber" | "emerald" | "graphite" | "rose"; items: OfficerActionView[] }[] = [
    { key: "waiting", tone: "amber", items: queue.actions.filter((a) => a.status === "waiting_for_approval") },
    { key: "held", tone: "graphite", items: queue.actions.filter((a) => a.status === "approved" || a.status === "executing") },
    { key: "completed", tone: "emerald", items: queue.actions.filter((a) => a.status === "completed") },
    { key: "closed", tone: "rose", items: queue.actions.filter((a) => a.status === "rejected" || a.status === "failed" || a.status === "cancelled") },
    { key: "suggested", tone: "graphite", items: queue.actions.filter((a) => a.status === "suggested") },
  ];

  return (
    <>
      {queue.truncated && (
        <p role="status" className="rounded-sm border border-line bg-bg px-4 py-2.5 text-xs text-muted">
          {t("truncated")}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {groups.map(({ key, tone, items }) => (
          <Panel key={key} title={t(`groups.${key}`)} tone={tone}
            action={<Mono className="text-[11px] text-faint">{items.length}</Mono>}
          >
            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{t("empty")}</p>
            ) : (
              <ul className="flex flex-col gap-3 p-4">
                {items.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1.5">
                    {a.contractId && contractsLoaded && titles[a.contractId] && (
                      <Link href={`/app/contracts/${a.contractId}`} className="text-[11px] text-muted hover:text-fg">
                        {titles[a.contractId]}
                      </Link>
                    )}
                    <OfficerActionCard
                      action={a}
                      conversationId={a.conversationId ?? ""}
                      approveAction={approveOfficerActionForm}
                      rejectAction={rejectOfficerActionForm}
                      locale={locale}
                      canApprove={canApprove}
                      returnTo="/app/tasks"
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}

/** Demo mode: unchanged in-memory fixtures — never a live-tenant fallback. */
async function DemoQueues({
  db,
  orgId,
  titles,
  locale,
  t,
  f,
}: {
  db: Parameters<typeof readContractList>[0];
  orgId: string;
  titles: Record<string, string>;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
  f: Awaited<ReturnType<typeof getFormatter>>;
}) {
  const actions = await db.actions.list(orgId);
  const mine = actions.filter((a: ActionItem) => a.ownerName && a.status !== "done");
  const groups: { key: "mine" | "overdue" | "waitingOnClient" | "done"; items: ActionItem[] }[] = [
    { key: "mine", items: mine },
    { key: "overdue", items: mine.filter((a) => daysBetween(DEMO_TODAY, a.dueDate) < 0 || daysBetween(DEMO_TODAY, a.dueDate) <= 3) },
    { key: "waitingOnClient", items: mine.filter((a) => a.title.en.toLowerCase().includes("client") || a.title.en.toLowerCase().includes("employer")) },
    { key: "done", items: actions.filter((a) => a.status === "done") },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {groups.map(({ key, items }) => (
        <Panel key={key} title={t(`groups.${key}`)} tone={key === "mine" ? "amber" : key === "overdue" ? "rose" : key === "waitingOnClient" ? "sky" : "emerald"}
          action={<Mono className="text-[11px] text-faint">{items.length}</Mono>}
        >
          {items.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">{t("empty")}</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 px-5 py-3">
                  <div className="flex items-center gap-2">
                    <StatusPill status={a.status === "done" ? "verified" : a.status === "in_progress" ? "partial" : "pending"} subtle />
                    <span className="flex-1 truncate text-sm">{lt(a.title, locale)}</span>
                    <Mono className="text-[11px] text-muted">{validDate(a.dueDate) ? f.dateTime(validDate(a.dueDate)!, "short") : "—"}</Mono>
                  </div>
                  <span className="ps-7 text-xs text-muted">
                    {a.ownerName}{titles[a.contractId ?? ""] ? <> · {titles[a.contractId ?? ""]}</> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ))}
    </div>
  );
}
