import { AlertTriangle, ArrowRight, CheckCircle2, CircleDot, RefreshCw } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { GapStatusBadge } from "@/components/app/evidence/badges";
import type { EvidenceGapView } from "@/domain/evidence";
import { cn } from "@/lib/utils";

/** Lifecycle stepper — open → evidence_received → reverification_pending → resolved. */
const LIFECYCLE = ["open", "evidence_received", "reverification_pending", "resolved"] as const;
type LifecycleStep = (typeof LIFECYCLE)[number];
const STEP_ICON = { open: AlertTriangle, evidence_received: CircleDot, reverification_pending: RefreshCw, resolved: CheckCircle2 } as const;

/**
 * Gap cards — what is missing, why it matters, current lifecycle state
 * (explicit stepper, never an OPEN→RESOLVED visual jump), and what resolves it.
 */
export async function GapList({
  gaps,
  requirementName,
}: {
  gaps: EvidenceGapView[];
  requirementName: (id: string | null) => string;
}) {
  const t = await getTranslations("app.evidence.gaps");
  if (!gaps.length) return <p className="px-5 py-6 text-center text-sm text-verified">{t("none")}</p>;

  return (
    <ul className="flex flex-col divide-y divide-line">
      {gaps.map((g) => {
        const lifecycleIdx = LIFECYCLE.indexOf(
          (g.status === "dismissed_by_authorized_human" ? "resolved" : g.status) as LifecycleStep,
        );
        return (
          <li key={g.id} className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GapStatusBadge status={g.status} />
                <span className="text-sm font-medium">{g.requirementId ? requirementName(g.requirementId) : g.gapType}</span>
              </div>
              <span className="text-[11px] text-faint">{g.gapType}</span>
            </div>
            {g.description && <p className="text-xs leading-relaxed text-muted">{g.description}</p>}

            {/* lifecycle stepper — the current state is one of four named stops */}
            <ol className="flex flex-wrap items-center gap-1" aria-label={t("lifecycle")}>
              {LIFECYCLE.map((step, i) => {
                const Icon = STEP_ICON[step];
                const reached = i <= lifecycleIdx;
                const isCurrent = i === lifecycleIdx;
                return (
                  <li key={step} className="flex items-center gap-1">
                    {i > 0 && <ArrowRight size={11} aria-hidden className="text-faint rtl:-scale-x-100" />}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                        isCurrent ? "bg-fg/10 text-fg" : reached ? "text-muted" : "text-faint",
                      )}
                    >
                      <Icon size={11} strokeWidth={1.75} aria-hidden />
                      {t(`step.${step}`)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-[11px] text-faint">
              {g.status === "resolved" && g.closedByRunId
                ? t("resolvedBy", { run: g.closedByRunId.slice(0, 8) })
                : g.status === "dismissed_by_authorized_human"
                  ? t("dismissedHuman")
                  : t("nextAction")}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
