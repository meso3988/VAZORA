import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { OverrideBadge, ResultBadge } from "@/components/app/evidence/badges";
import { Mono } from "@/components/app/primitives";
import type { VerificationDiscrepancyView, VerificationRunView } from "@/domain/evidence";

/**
 * VERIFICATION_DISCREPANCY panel — a weaker result on the SAME immutable
 * version is shown side-by-side with the prior verified result, never hidden.
 * Pending rows offer the authorized human decision: keep prior verified state
 * or confirm regression (which opens an attributed gap).
 */
export async function DiscrepancyList({
  discrepancies,
  runs,
  requirementName,
  evidenceItemId,
  resolveAction,
  locale,
}: {
  discrepancies: VerificationDiscrepancyView[];
  runs: VerificationRunView[];
  requirementName: (id: string | null) => string;
  evidenceItemId: string;
  resolveAction?: (formData: FormData) => void | Promise<void>;
  locale: string;
}) {
  const t = await getTranslations("app.evidence.discrepancy");
  const f = await getFormatter();
  if (!discrepancies.length) return null;

  const runById = new Map(runs.map((r) => [r.id, r]));
  const checkOf = (runId: string, checkId: string) =>
    runById.get(runId)?.checks.find((c) => c.id === checkId) ?? null;

  return (
    <ul className="flex flex-col divide-y divide-line">
      {discrepancies.map((d) => {
        const priorRun = runById.get(d.priorRunId);
        const currentRun = runById.get(d.currentRunId);
        const currentCheck = checkOf(d.currentRunId, d.currentCheckId);
        return (
          <li key={d.id} className="flex flex-col gap-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle size={13} strokeWidth={1.75} aria-hidden className="text-partial" />
                <span className="text-sm font-medium">{requirementName(d.requirementId)}</span>
                {d.status === "pending" ? (
                  <span className="rounded-sm bg-partial/10 px-1.5 py-0.5 text-[10px] font-medium text-partial">
                    {t("pending")}
                  </span>
                ) : (
                  <span className="rounded-sm bg-fg/10 px-1.5 py-0.5 text-[10px] font-medium text-fg">
                    {d.status === "kept_prior" ? t("kept") : t("confirmed")}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-faint">{t("sameVersion")}</span>
            </div>

            {/* prior verified vs current conflicting result — both visible */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <ResultBadge result={d.priorResult} />
              <Mono className="text-faint">{d.priorRunId.slice(0, 8)}</Mono>
              {priorRun && (
                <span className="text-[11px] text-faint">
                  {f.dateTime(new Date(priorRun.completedAt ?? priorRun.createdAt), "medium")}
                </span>
              )}
              <ArrowRight size={12} strokeWidth={1.75} aria-hidden className="text-faint rtl:-scale-x-100" />
              <ResultBadge result={d.currentResult} />
              <Mono className="text-faint">{d.currentRunId.slice(0, 8)}</Mono>
              {currentRun && (
                <span className="text-[11px] text-faint">
                  {f.dateTime(new Date(currentRun.completedAt ?? currentRun.createdAt), "medium")}
                </span>
              )}
            </div>

            <p className="text-[11px] text-faint">
              {t("runMeta", { provider: d.provider ?? "—", model: d.model ?? "—" })}
            </p>
            {currentCheck?.reason && (
              <p className="text-xs leading-relaxed text-muted">{currentCheck.reason}</p>
            )}
            {d.status === "pending" && (
              <p className="text-xs leading-relaxed text-muted">{t("reviewHint")}</p>
            )}

            {/* decided state — attribution is explicit, never implied as AI */}
            {d.status !== "pending" && (
              <div className="flex flex-col gap-1 rounded-sm border border-line/60 bg-bg/60 p-3">
                <p className="flex items-center gap-1.5 text-[11px] text-muted">
                  {d.status === "kept_prior" ? (
                    <ShieldCheck size={12} strokeWidth={1.75} aria-hidden className="text-verified" />
                  ) : (
                    <AlertTriangle size={12} strokeWidth={1.75} aria-hidden className="text-at-risk" />
                  )}
                  {d.status === "kept_prior" ? t("keptLabel") : t("confirmedLabel")}
                  {" · "}
                  <OverrideBadge />
                </p>
                {d.resolutionNote && <p className="text-xs leading-relaxed text-muted">{d.resolutionNote}</p>}
                <p className="text-[11px] text-faint">
                  <Mono>{d.resolvedBy?.slice(0, 8)}</Mono>
                  {d.resolvedAt && <> · {f.dateTime(new Date(d.resolvedAt), "medium")}</>}
                </p>
              </div>
            )}

            {/* authorized human decision — pending only */}
            {d.status === "pending" && resolveAction && (
              <form action={resolveAction} className="flex flex-col gap-2 rounded-sm border border-line/60 bg-bg/60 p-3">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="discrepancyId" value={d.id} />
                <input type="hidden" name="evidenceItemId" value={evidenceItemId} />
                <input
                  name="reason"
                  required
                  maxLength={1000}
                  placeholder={t("reasonPlaceholder")}
                  className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg placeholder:text-faint"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="submit"
                    name="decision"
                    value="keep_prior"
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-line bg-elevated px-2.5 text-xs font-medium text-fg transition-colors hover:bg-fg/5"
                  >
                    <ShieldCheck size={12} strokeWidth={1.75} aria-hidden />
                    {t("keepPrior")}
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="confirm_regression"
                    className="inline-flex h-7 items-center gap-1 rounded-sm border border-missing/40 bg-missing/5 px-2.5 text-xs font-medium text-missing transition-colors hover:bg-missing/10"
                  >
                    <AlertTriangle size={12} strokeWidth={1.75} aria-hidden />
                    {t("confirmRegression")}
                  </button>
                </div>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
