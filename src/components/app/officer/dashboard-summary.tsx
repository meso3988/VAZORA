import { AlertOctagon, ArrowRight, Inbox } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Empty, Mono } from "@/components/app/primitives";
import type { TodayBrief } from "@/lib/officer/brief";
import { Link } from "@/i18n/navigation";

/**
 * Dashboard = executive summary. Command Center = working surface.
 *
 * Deliberately narrow: the three numbers an executive acts on, the few
 * highest-priority items, and a link through to the real workspace. The full
 * Command Center is NOT duplicated here.
 */
export async function OfficerDashboardSummary({ brief }: { brief: TodayBrief }) {
  const t = await getTranslations("app.officer");
  const bt = await getTranslations("app.officer.brief");

  if (brief.quiet) return <Empty>{bt("quiet")}</Empty>;

  return (
    <div className="flex flex-col gap-3 p-5">
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <div className="flex flex-col">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{bt("critical")}</dt>
          <dd className="font-mono text-lg tabular-nums text-missing">{brief.counts.critical}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{bt("today")}</dt>
          <dd className="font-mono text-lg tabular-nums text-partial">{brief.counts.today}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{bt("approvals")}</dt>
          <dd className="font-mono text-lg tabular-nums text-fg">{brief.approvalsWaiting}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{bt("newIssues")}</dt>
          <dd className="font-mono text-lg tabular-nums text-at-risk">{brief.newIssues}</dd>
        </div>
      </dl>

      {brief.highestPriorityItems.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-line pt-3">
          {brief.highestPriorityItems.slice(0, 3).map((i) => (
            <li key={i.observationId} className="flex items-start gap-2 text-xs leading-relaxed">
              <AlertOctagon
                size={12}
                strokeWidth={1.75}
                aria-hidden
                className={`mt-0.5 shrink-0 ${i.severity === "critical" ? "text-missing" : "text-at-risk"}`}
              />
              <span className="min-w-0">
                <span className="font-medium">{i.title}</span>
                {i.detail && <span className="text-muted"> — {i.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs">
        <Link href="/app/agent" className="inline-flex items-center gap-1 font-medium text-fg hover:underline">
          {t("center.title")}
          <ArrowRight size={12} strokeWidth={1.75} aria-hidden className="rtl:-scale-x-100" />
        </Link>
        {brief.approvalsWaiting > 0 && (
          <span className="inline-flex items-center gap-1 text-muted">
            <Inbox size={12} strokeWidth={1.75} aria-hidden />
            {bt("approvals")}: <Mono>{brief.approvalsWaiting}</Mono>
          </span>
        )}
        <span className="text-faint">{brief.asOfDate} · <Mono>{brief.timeZone}</Mono></span>
      </div>
    </div>
  );
}
