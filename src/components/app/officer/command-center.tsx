import {
  AlertOctagon, AlertTriangle, CalendarClock, CalendarDays, CheckCircle2,
  Eye, FileSearch, Inbox, UserPlus,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Empty, Mono } from "@/components/app/primitives";
import type { ObservationRow } from "@/lib/officer/observations";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Command Center — the Officer's working surface.
 *
 * Sections are deterministic time buckets, not a feed. Each item answers:
 * what happened, why it matters, when it is due, what the evidence says, who
 * owns it, what VAZORA recommends, and where the proof is.
 */

type Section = {
  key: "approvals" | "critical" | "today" | "next_3_days" | "this_week" | "monitoring" | "resolved";
  icon: typeof AlertOctagon;
  accent: string;
};

const SECTIONS: Section[] = [
  { key: "approvals", icon: Inbox, accent: "text-partial" },
  { key: "critical", icon: AlertOctagon, accent: "text-missing" },
  { key: "today", icon: CalendarClock, accent: "text-partial" },
  { key: "next_3_days", icon: CalendarDays, accent: "text-fg" },
  { key: "this_week", icon: CalendarDays, accent: "text-fg" },
  { key: "monitoring", icon: Eye, accent: "text-muted" },
  { key: "resolved", icon: CheckCircle2, accent: "text-verified" },
];

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-missing",
  high: "text-at-risk",
  medium: "text-partial",
  low: "text-muted",
  informational: "text-faint",
};

export async function CommandCenter({
  observations,
  locale,
  acknowledgeAction,
  explainAction,
  proposeFollowUpAction,
}: {
  observations: ObservationRow[];
  locale: string;
  acknowledgeAction: (formData: FormData) => void | Promise<void>;
  explainAction: (formData: FormData) => void | Promise<void>;
  proposeFollowUpAction: (formData: FormData) => void | Promise<void>;
}) {
  const t = await getTranslations("app.officer.center");
  const kt = await getTranslations("app.officer.kind");
  const f = await getFormatter();

  if (!observations.length) {
    return <Empty>{t("empty")}</Empty>;
  }

  const inSection = (key: Section["key"]) =>
    key === "approvals"
      ? observations.filter((o) => o.kind === "action_waiting_for_approval" && o.status !== "resolved")
      : key === "resolved"
        ? observations.filter((o) => o.status === "resolved")
        : observations.filter((o) => o.kind !== "action_waiting_for_approval" && o.status !== "resolved" && o.timeBucket === key);

  return (
    <div className="flex flex-col divide-y divide-line">
      {SECTIONS.map((section) => {
        const items = inSection(section.key);
        if (!items.length) return null;
        const Icon = section.icon;
        return (
          <section key={section.key} className="flex flex-col">
            <header className="flex items-center gap-2 bg-fg/3 px-5 py-2.5">
              <Icon size={13} strokeWidth={1.75} aria-hidden className={section.accent} />
              <h3 className={cn("text-[11px] font-semibold uppercase tracking-wide", section.accent)}>
                {t(`section.${section.key}`)}
              </h3>
              <span className="ms-auto font-mono text-[10px] text-faint">{items.length}</span>
            </header>
            <ul className="flex flex-col divide-y divide-line">
              {items.map((o) => (
                <li
                  key={o.id}
                  data-observation-id={o.id}
                  data-observation-bucket={section.key}
                  data-observation-severity={o.severity}
                  className="flex flex-col gap-2.5 px-5 py-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wide", SEVERITY_TONE[o.severity] ?? "text-muted")}>
                      {t(`severity.${o.severity}`)}
                    </span>
                    <span className="rounded-sm bg-fg/5 px-1.5 py-0.5 text-[10px] text-muted">
                      {kt(o.kind as Parameters<typeof kt>[0])}
                    </span>
                    <span className="text-sm font-medium">{o.title}</span>
                    {o.status === "acknowledged" && (
                      <span className="rounded-sm bg-fg/10 px-1.5 py-0.5 text-[10px] text-fg">{t("acknowledged")}</span>
                    )}
                    {o.reopenCount > 0 && (
                      <span className="rounded-sm bg-missing/10 px-1.5 py-0.5 text-[10px] text-missing">
                        {t("recurring", { count: o.reopenCount })}
                      </span>
                    )}
                  </div>

                  {o.detail && <p className="text-xs leading-relaxed text-muted">{o.detail}</p>}

                  {/* why it matters — deterministic reason codes, not prose */}
                  {o.priorityReason.length > 0 && (
                    <ul className="flex flex-wrap gap-1">
                      {o.priorityReason.map((r) => (
                        <li key={r} className="rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-muted">
                          {r.replace(/_/g, " ")}
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
                    <span>{t("firstSeen")}: {f.dateTime(new Date(o.firstDetectedAt), "short")}</span>
                    <span>· {t("lastSeen")}: {f.dateTime(new Date(o.lastSeenAt), "short")}</span>
                    {o.resolvedAt && <span>· {t("resolvedAt")}: {f.dateTime(new Date(o.resolvedAt), "short")}</span>}
                  </p>

                  {/* sources — every actionable observation is traceable */}
                  {o.citations.length > 0 && (
                    <div className="flex flex-col gap-1 rounded-sm border border-line/60 bg-bg/60 p-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted">
                        <FileSearch size={12} strokeWidth={1.75} aria-hidden />
                        {t("sources")}
                      </span>
                      <ul className="flex flex-wrap gap-1.5">
                        {o.citations.map((c) => {
                          const href = citationHref(c.target, c.id, o.contractId);
                          return (
                            <li key={`${c.target}:${c.id}`}>
                              {href ? (
                                <Link href={href} className="inline-flex items-center rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-fg hover:bg-fg/5">
                                  {c.label}
                                </Link>
                              ) : (
                                <span className="inline-flex items-center rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-muted">
                                  {c.label}
                                </span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* actions — nothing external, nothing silent */}
                  {o.status !== "resolved" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <form action={explainAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="observationId" value={o.id} />
                        <button type="submit" className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-fg px-2.5 text-[11px] font-medium text-bg transition-colors hover:bg-fg/90">
                          {t("explain")}
                        </button>
                      </form>

                      {o.status === "active" && (
                        <form action={acknowledgeAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="observationId" value={o.id} />
                          <button type="submit" className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-elevated px-2.5 text-[11px] font-medium text-fg transition-colors hover:bg-fg/5">
                            <Eye size={11} strokeWidth={1.75} aria-hidden />
                            {t("acknowledge")}
                          </button>
                        </form>
                      )}

                      {o.recommendedActionType && o.kind !== "action_waiting_for_approval" && (
                        <form action={proposeFollowUpAction}>
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="observationId" value={o.id} />
                          <button type="submit" className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-elevated px-2.5 text-[11px] font-medium text-fg transition-colors hover:bg-fg/5">
                            {o.recommendedActionType === "obligation.assign_owner"
                              ? <><UserPlus size={11} strokeWidth={1.75} aria-hidden />{t("proposeAssignment")}</>
                              : <><AlertTriangle size={11} strokeWidth={1.75} aria-hidden />{t("proposeFollowUp")}</>}
                          </button>
                        </form>
                      )}

                      {o.kind === "action_waiting_for_approval" && (
                        <span className="text-[11px] text-faint">
                          {t("approveBelow")} <Mono>{String((o.supportingFacts as Record<string, unknown>).action_type ?? "")}</Mono>
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Deep link per citation target, built server-side (never model-supplied). */
function citationHref(target: string, id: string, contractId: string | null): string | null {
  switch (target) {
    case "contract": return `/app/contracts/${id}`;
    case "clause": return contractId ? `/app/contracts/${contractId}` : null;
    case "obligation": return contractId ? `/app/contracts/${contractId}/obligations` : null;
    case "evidence_gap": return contractId ? `/app/contracts/${contractId}/evidence` : null;
    case "evidence_item": return `/app/evidence/${id}`;
    case "verification_discrepancy": return contractId ? `/app/contracts/${contractId}/evidence` : null;
    default: return null;
  }
}
