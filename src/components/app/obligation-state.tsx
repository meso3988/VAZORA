import { getFormatter, getTranslations } from "next-intl/server";

import { StatusDot, type StatusTone } from "@/components/ui/status";
import type { ObligationDeadline, ObligationEvidenceState, ObligationState } from "@/domain/obligation-state";
import { cn } from "@/lib/utils";

const EVIDENCE_TONE: Record<ObligationEvidenceState, StatusTone> = {
  verified: "verified",
  partial: "partial",
  missing: "missing",
  awaiting_verification: "partial",
  needs_review: "at_risk",
  no_requirements: "pending",
  unavailable: "pending",
};

const deadlineTone = (d: ObligationDeadline): StatusTone =>
  d.window === "overdue" ? "missing" : d.window === "today" || d.window === "next_3_days" || d.window === "needs_schedule" ? "partial" : "pending";

function Pill({ tone, children, data }: { tone: StatusTone; children: React.ReactNode; data: Record<string, string> }) {
  return (
    <span {...data} className="inline-flex min-h-6 items-center gap-1.5 rounded-sm bg-fg/5 px-2 py-0.5 text-xs font-medium text-muted">
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/** Deadline label for a state (used for the due-date column too). */
export async function deadlineLabel(d: ObligationDeadline): Promise<string> {
  const t = await getTranslations("app.obligationState.deadline");
  if (d.window === "unknown") return t("unknown");
  if (d.window === "needs_schedule") return t("needs_schedule");
  if (d.window === "overdue") return t("overdue", { days: d.daysOverdue ?? 0 });
  if (d.window === "next_3_days" || d.window === "this_week") return t(d.window, { days: d.daysUntilDue ?? 0 });
  return t(d.window);
}

/** Effective evidence state only — what a "verification" slot may show. */
export async function EvidenceStatePill({ state, className }: { state: ObligationState; className?: string }) {
  const t = await getTranslations("app.obligationState");
  const e = state.evidence;
  return (
    <span className={cn("flex flex-col gap-1", className)}>
      <Pill tone={EVIDENCE_TONE[e.state]} data={{ "data-ob-evidence": e.state }}>{t(`evidence.${e.state}`)}</Pill>
      {e.priorStateInForce && <span data-ob-prior-in-force className="text-[11px] leading-snug text-muted">{t("priorInForce")}</span>}
    </span>
  );
}

/** Lifecycle, deadline and evidence as three separate facts. */
export async function ObligationStateBadges({ state }: { state: ObligationState }) {
  const t = await getTranslations("app.obligationState");
  const f = await getFormatter();
  const d = state.deadline;
  return (
    <span className="flex flex-col items-start gap-1">
      <Pill tone="pending" data={{ "data-ob-lifecycle": state.lifecycle }}>{t(`lifecycle.${state.lifecycle}`)}</Pill>
      <Pill tone={deadlineTone(d)} data={{ "data-ob-deadline": d.window }}>{await deadlineLabel(d)}</Pill>
      {d.window === "needs_schedule" && (
        <span data-ob-schedule-reason={d.reason} className="text-[11px] leading-snug text-muted">{t(`needsScheduleReason.${d.reason}`)}</span>
      )}
      {"recurring" in d && d.recurring && !d.recurring.settlementsKnown && (
        <span data-ob-settlements-unknown className="text-[11px] leading-snug text-partial">{t("settlementsUnknown")}</span>
      )}
      {"recurring" in d && d.recurring?.settlementsKnown && d.recurring.unsettledPastCount > 0 && (
        <span data-ob-unsettled={d.recurring.unsettledPastCount} className="text-[11px] leading-snug text-muted">
          {t("unsettledCycles", { count: d.recurring.unsettledPastCount })}
        </span>
      )}
      {"recurring" in d && d.recurring?.nextDue && d.recurring.nextDue !== d.dueDate && (
        <span data-ob-next-cycle={d.recurring.nextDue} className="text-[11px] leading-snug text-muted">
          {t("nextCycle", { date: f.dateTime(new Date(`${d.recurring.nextDue}T00:00:00Z`), { day: "numeric", month: "short", timeZone: "UTC" }) })}
        </span>
      )}
      <EvidenceStatePill state={state} />
    </span>
  );
}
