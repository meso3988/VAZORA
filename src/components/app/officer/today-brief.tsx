import { RefreshCw, Sunrise } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Mono } from "@/components/app/primitives";
import type { TodayBrief } from "@/lib/officer/brief";

/**
 * Today Brief.
 *
 * The numbers and priority items come from the deterministic brief object —
 * the narrative, when a model produced one, only rewords them. If the
 * narrative is missing the brief is still complete, because the facts were
 * never the model's to begin with.
 */
export async function TodayBriefPanel({
  brief,
  narrative,
  displayName,
  locale,
  sweepAction,
  lastSweepAt,
  sweepStatus,
}: {
  brief: TodayBrief;
  narrative: string | null;
  displayName: string | null;
  locale: string;
  sweepAction: (formData: FormData) => void | Promise<void>;
  lastSweepAt: string | null;
  sweepStatus: string | null;
}) {
  const t = await getTranslations("app.officer.brief");
  const f = await getFormatter();

  return (
    <section className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-medium">
          <Sunrise size={15} strokeWidth={1.75} aria-hidden className="text-partial" />
          {displayName ? t("greetingNamed", { name: displayName }) : t("greeting")}
        </h2>
        <span className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
          <span>{brief.asOfDate} · {brief.localTime}</span>
          <Mono>{brief.timeZone}</Mono>
          {lastSweepAt && (
            <span>· {t("lastSweep", { at: f.dateTime(new Date(lastSweepAt), "short") })}{sweepStatus === "partial" ? ` (${t("partial")})` : ""}</span>
          )}
          <form action={sweepAction}>
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-elevated px-2.5 text-[11px] font-medium text-fg transition-colors hover:bg-fg/5">
              <RefreshCw size={11} strokeWidth={1.75} aria-hidden />
              {t("runSweep")}
            </button>
          </form>
        </span>
      </div>

      {brief.quiet ? (
        <p className="text-sm text-verified">{t("quiet")}</p>
      ) : (
        <>
          {/* deterministic counts — the record of truth */}
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Stat label={t("newIssues")} value={brief.newIssues} tone="text-at-risk" />
            <Stat label={t("resolved")} value={brief.resolvedSinceLastReview} tone="text-verified" />
            <Stat label={t("approvals")} value={brief.approvalsWaiting} tone="text-partial" />
            <Stat label={t("critical")} value={brief.counts.critical} tone="text-missing" />
            <Stat label={t("today")} value={brief.counts.today} tone="text-partial" />
            <Stat label={t("thisWeek")} value={brief.counts.next3Days + brief.counts.thisWeek} tone="text-fg" />
            <Stat label={t("monitoring")} value={brief.counts.monitoring} tone="text-muted" />
          </dl>

          <p className="text-[11px] text-faint">
            {t("since", {
              kind: t(`sinceKind.${brief.sinceKind}`),
              at: brief.since ? f.dateTime(new Date(brief.since), "short") : "—",
            })}
            {" · "}
            {t("changeCount", { count: brief.changes.length })}
          </p>

          {narrative && (
            <p dir="auto" className="whitespace-pre-wrap border-s-2 border-line ps-3 text-sm leading-relaxed text-muted">
              {narrative}
            </p>
          )}

          {brief.highestPriorityItems.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium tracking-wide text-muted">{t("highestPriority")}</span>
              <ul className="flex flex-col gap-1">
                {brief.highestPriorityItems.map((i) => (
                  <li key={i.observationId} className="text-xs leading-relaxed">
                    <span className="font-medium">{i.title}</span>
                    {i.detail && <span className="text-muted"> — {i.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`font-mono text-lg tabular-nums ${tone}`}>{value}</dd>
    </div>
  );
}
