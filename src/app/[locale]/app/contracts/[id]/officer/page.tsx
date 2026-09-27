import { notFound } from "next/navigation";

import { ContractLoadFailed, DataLoadFailed } from "@/components/app/contract-unavailable";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { approveOfficerActionForm, rejectOfficerActionForm } from "@/app/[locale]/app/agent/actions";
import { OfficerActionCard } from "@/components/app/officer/action-card";
import { OfficerFeed } from "@/components/app/officer-feed";
import { OfficerAsk } from "@/components/app/officer-ask";
import { Mono, Panel } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { readAgentEvents, readContract, requireTenant } from "@/data/context";
import { listOfficerActions } from "@/data/supabase/officer-queue";
import { asLocale } from "@/i18n/params";
import { roleHasCapability } from "@/lib/officer/authority";
import { buildOfficerContext } from "@/lib/officer/context";
import { createSupabaseServer } from "@/lib/supabase/server";
import { lt } from "@/lib/utils";

export default async function ContractOfficer(props: PageProps<"/[locale]/app/contracts/[id]/officer">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.officer");
  const { session, orgId, db } = await requireTenant();
  const isDemo = session.mode === "demo";
  const read = await readContract(db, orgId, id, isDemo);
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();

  const eventsRead = await readAgentEvents(db, orgId, isDemo, { contractId: id });
  const events = eventsRead.ok ? eventsRead.events : null;
  const open = events?.filter((e) => e.kind !== "verified").length ?? 0;

  // Action state for this contract — the same officer_actions the
  // conversation and /app/tasks read, scoped here. Demo keeps fixtures.
  let actionCards: import("@/domain/officer").OfficerActionView[] | null = null;
  let actionsTruncated = false;
  let canApprove = false;
  let demoActions: import("@/domain/types").ActionItem[] = [];
  if (isDemo) {
    demoActions = await db.actions.list(orgId, { contractId: id });
  } else {
    const supabase = await createSupabaseServer();
    const [ctx, queue] = await Promise.all([
      buildOfficerContext({ supabase, organizationId: orgId, userId: session.user.id, locale }),
      listOfficerActions(supabase, orgId, { contractId: id, limit: 25 }),
    ]);
    canApprove = !!ctx && roleHasCapability(ctx.role, "officer.action.approve");
    actionCards = queue.ok ? queue.actions : null;
    actionsTruncated = queue.ok && queue.truncated;
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel title={t("briefing")} tone="emerald" hint={t("openItems", { count: open })}>
          {events === null ? (
            <div className="p-4"><DataLoadFailed message="dataLoadFailed" /></div>
          ) : (
            <OfficerFeed events={events} showContract={false} />
          )}
        </Panel>

        <Panel title={t("contractActions")} tone="amber"
          action={isDemo
            ? <Mono className="text-[11px] text-faint">{demoActions.length}</Mono>
            : actionCards && <Mono className="text-[11px] text-faint">{actionCards.length}{actionsTruncated ? "+" : ""}</Mono>}
        >
          {isDemo ? (
            demoActions.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{t("noContractActions")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {demoActions.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <StatusPill status={a.status === "done" ? "verified" : a.status === "in_progress" ? "partial" : "pending"} subtle />
                    <span className="min-w-0 flex-1 truncate text-sm">{lt(a.title, locale)}</span>
                    <span className="text-xs text-muted">{a.ownerName}</span>
                  </li>
                ))}
              </ul>
            )
          ) : actionCards === null ? (
            <div className="p-4"><DataLoadFailed message="dataLoadFailed" /></div>
          ) : actionCards.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">{t("noContractActions")}</p>
          ) : (
            <ul className="flex flex-col gap-3 p-4">
              {actionCards.map((a) => (
                <li key={a.id}>
                  <OfficerActionCard
                    action={a}
                    conversationId={a.conversationId ?? ""}
                    approveAction={approveOfficerActionForm}
                    rejectAction={rejectOfficerActionForm}
                    locale={locale}
                    canApprove={canApprove}
                    returnTo={`/app/contracts/${id}/officer`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <OfficerAsk contractId={id} demo={isDemo} locale={locale} />
    </div>
  );
}
