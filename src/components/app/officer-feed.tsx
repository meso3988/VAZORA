import { AlertTriangle, CalendarClock, CircleCheck, FileWarning, Receipt, ShieldAlert } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { Empty } from "@/components/app/primitives";
import type { AgentEvent, AgentEventKind } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { cn, lt } from "@/lib/utils";

const KIND: Record<AgentEventKind, { icon: typeof AlertTriangle; className: string }> = {
  attention: { icon: AlertTriangle, className: "text-missing" },
  due_soon: { icon: CalendarClock, className: "text-partial" },
  evidence_gap: { icon: FileWarning, className: "text-missing" },
  claim_readiness: { icon: Receipt, className: "text-at-risk" },
  risk: { icon: ShieldAlert, className: "text-at-risk" },
  verified: { icon: CircleCheck, className: "text-verified" },
};

export async function OfficerFeed({
  events,
  contractTitles,
  showContract = true,
}: {
  events: AgentEvent[];
  contractTitles?: Record<string, string>;
  showContract?: boolean;
}) {
  const t = await getTranslations("app.officer");
  const f = await getFormatter();
  const locale = await getLocale();
  if (!events.length) return <Empty>{t("openItems", { count: 0 })}</Empty>;

  return (
    <ol className="divide-y divide-line">
      {events.map((e) => {
        const { icon: Icon, className } = KIND[e.kind];
        const href = e.contractId ? (`/app/contracts/${e.contractId}` as const) : ("/app/agent" as const);
        return (
          <li key={e.id}>
            <Link href={href} className="flex gap-3 px-5 py-3.5 transition-colors hover:bg-fg/3">
              <span className={cn("mt-0.5 shrink-0", className)}><Icon size={16} strokeWidth={1.75} /></span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                  <span className={cn("font-medium", className)}>{t(`kinds.${e.kind}`)}</span>
                  {e.priority === 1 && <span className="rounded-sm bg-missing/10 px-1.5 text-missing">{t("priority", { level: 1 })}</span>}
                  {showContract && e.contractId && contractTitles?.[e.contractId] && (
                    <span className="max-w-full truncate">· {contractTitles[e.contractId]}</span>
                  )}
                  <span className="ms-auto whitespace-nowrap font-mono tabular">{f.dateTime(new Date(e.createdAt), "short")}</span>
                </div>
                <p className="text-sm leading-snug">{lt(e.message, locale)}</p>
                {e.detail && <p className="text-xs leading-relaxed text-muted">{lt(e.detail, locale)}</p>}
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
