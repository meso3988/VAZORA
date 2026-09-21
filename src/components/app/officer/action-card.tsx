import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Mono } from "@/components/app/primitives";
import type { OfficerActionView } from "@/domain/officer";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * A proposed action, rendered from VALIDATED structured data — never from
 * model prose. The card states what is recommended, why, what it is based
 * on, and who must approve it. VAZORA proposes; a human decides.
 */
export async function OfficerActionCard({
  action,
  conversationId,
  approveAction,
  rejectAction,
  locale,
  canApprove,
}: {
  action: OfficerActionView;
  conversationId: string;
  approveAction?: (formData: FormData) => void | Promise<void>;
  rejectAction?: (formData: FormData) => void | Promise<void>;
  locale: string;
  canApprove: boolean;
}) {
  const t = await getTranslations("app.officer.action");
  const f = await getFormatter();
  const open = action.status === "suggested" || action.status === "waiting_for_approval";
  const tone =
    action.status === "completed" || action.status === "approved" ? "border-verified/40 bg-verified/5"
    : action.status === "rejected" || action.status === "failed" ? "border-missing/40 bg-missing/5"
    : "border-partial/40 bg-partial/5";

  return (
    <article className={cn("flex flex-col gap-3 rounded-md border p-4", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          <ShieldCheck size={13} strokeWidth={1.75} aria-hidden />
          {t("recommends")}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-faint">
          <Mono>{action.actionType}</Mono>
          {action.requiresApproval && <span className="rounded-sm bg-fg/10 px-1.5 py-0.5 text-fg">{t("approvalRequired")}</span>}
          <span className="rounded-sm bg-fg/5 px-1.5 py-0.5">{t(`status.${action.status}`)}</span>
        </span>
      </div>

      <p className="text-sm font-medium">
        {typeof action.arguments?.title === "string" ? action.arguments.title
          : typeof action.arguments?.summary === "string" ? action.arguments.summary
          : action.actionType}
      </p>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium tracking-wide text-muted">{t("reason")}</span>
        <p className="text-xs leading-relaxed text-muted">{action.reason}</p>
      </div>

      {action.citations.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-muted">{t("sources")}</span>
          <ul className="flex flex-wrap gap-1.5">
            {action.citations.map((c) => (
              <li key={`${c.target}:${c.id}`}>
                {c.href ? (
                  <Link href={c.href} className="inline-flex items-center rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-fg hover:bg-fg/5">
                    {c.label}
                  </Link>
                ) : (
                  <span className="inline-flex items-center rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-muted">
                    {c.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {action.status === "approved" && !action.executedAt && (
        <p className="flex items-start gap-1.5 rounded-sm border border-line/60 bg-bg/60 p-2 text-[11px] leading-relaxed text-muted">
          <AlertTriangle size={12} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-partial" />
          {t("approvedNotExecuted")}
        </p>
      )}

      {(action.approvedBy || action.rejectedBy) && (
        <p className="text-[11px] text-faint">
          {action.approvedBy
            ? <>{t("approvedBy")} <Mono>{action.approvedBy.slice(0, 8)}</Mono>{action.approvedAt && <> · {f.dateTime(new Date(action.approvedAt), "medium")}</>}</>
            : <>{t("rejectedBy")} <Mono>{action.rejectedBy?.slice(0, 8)}</Mono>{action.rejectionReason && <> · {action.rejectionReason}</>}</>}
        </p>
      )}

      {open && approveAction && rejectAction && (
        canApprove ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <form action={approveAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="actionId" value={action.id} />
              <input type="hidden" name="conversationId" value={conversationId} />
              <button type="submit" className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-fg px-2.5 text-xs font-medium text-bg transition-colors hover:bg-fg/90">
                <Check size={12} strokeWidth={2} aria-hidden />
                {t("approve")}
              </button>
            </form>
            <form action={rejectAction} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="actionId" value={action.id} />
              <input type="hidden" name="conversationId" value={conversationId} />
              <input
                name="reason"
                maxLength={1000}
                placeholder={t("rejectReason")}
                className="h-7 w-44 rounded-sm border border-line bg-bg px-2 text-xs text-fg placeholder:text-faint"
              />
              <button type="submit" className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-elevated px-2.5 text-xs font-medium text-fg transition-colors hover:bg-fg/5">
                <X size={12} strokeWidth={2} aria-hidden />
                {t("reject")}
              </button>
            </form>
          </div>
        ) : (
          <p className="border-t border-line/60 pt-3 text-[11px] text-faint">{t("noApprovalRight")}</p>
        )
      )}
    </article>
  );
}
