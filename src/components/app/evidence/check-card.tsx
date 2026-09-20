import { FileText, MapPin, ScanSearch, Wrench } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { OverrideBadge, ResultBadge } from "@/components/app/evidence/badges";
import { Mono } from "@/components/app/primitives";
import type { VerificationCheckView } from "@/domain/evidence";

const OVERRIDE_OPTIONS = [
  "verified", "partial", "missing", "not_applicable", "needs_human_review",
] as const;

/**
 * One criterion check — result, method, reason, provenance, and the
 * additive human-override lane. UPLOADED ≠ VERIFIED and
 * HUMAN OVERRIDE ≠ VAZORA VERIFIED are rendered structurally:
 * the AI row never shows the override as if VAZORA produced it.
 */
export async function CheckCard({
  check,
  overrideAction,
  contractId,
  locale,
}: {
  check: VerificationCheckView;
  /** server action — present only for live sessions */
  overrideAction?: (formData: FormData) => void | Promise<void>;
  contractId: string;
  locale: string;
}) {
  const t = await getTranslations("app.evidence.check");
  const rt = await getTranslations("app.evidence.result");
  const f = await getFormatter();
  const isDeterministic = check.checkKind === "deterministic";
  const MethodIcon = isDeterministic ? Wrench : ScanSearch;
  const KEY: Record<string, "verified" | "partial" | "missing" | "notApplicable" | "needsHumanReview"> = {
    verified: "verified", partial: "partial", missing: "missing",
    not_applicable: "notApplicable", needs_human_review: "needsHumanReview",
  };

  return (
    <article className="flex flex-col gap-3 rounded-md border border-line bg-elevated/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ResultBadge result={check.result} />
          <span className="truncate text-sm font-medium">{check.checkLabel}</span>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-faint">
          <MethodIcon size={12} strokeWidth={1.75} aria-hidden />
          {isDeterministic ? t("methodDeterministic") : t("methodAi")}
          {check.model && <Mono className="ms-1">{check.model}</Mono>}
        </span>
      </div>

      {check.reason && <p className="text-xs leading-relaxed text-muted">{check.reason}</p>}
      {check.confidence != null && (
        <p className="text-[11px] text-faint">{t("confidence", { value: check.confidence.toFixed(2) })}</p>
      )}

      {/* provenance — verbatim excerpt + location, or honest absence */}
      <div className="flex flex-col gap-1.5 rounded-sm border border-line/60 bg-bg/60 p-3">
        {check.sourceExcerpt ? (
          <blockquote dir="auto" className="border-s-2 border-line ps-3 text-xs leading-relaxed text-fg">
            “{check.sourceExcerpt}”
          </blockquote>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-faint">
            <FileText size={12} strokeWidth={1.75} aria-hidden />
            {t("noExcerpt")}
          </p>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <MapPin size={12} strokeWidth={1.75} aria-hidden />
          {check.sourcePage != null
            ? t("page", { page: check.sourcePage })
            : check.sourceLocation
              ? check.sourceLocation
              : t("locationUnavailable")}
        </p>
      </div>

      {/* human override — additive lane, AI result untouched */}
      {check.humanResult && (
        <div className="flex flex-col gap-1.5 rounded-sm border border-sky-800/40 bg-sky-800/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <OverrideBadge />
            <ResultBadge result={check.humanResult} />
          </div>
          <p className="text-xs leading-relaxed text-muted">{check.humanReason}</p>
          <p className="text-[11px] text-faint">
            {t("overrideBy")} <Mono>{check.overriddenBy?.slice(0, 8)}</Mono>
            {check.overriddenAt && <> · {f.dateTime(new Date(check.overriddenAt), "medium")}</>}
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-faint">
            {t("vazoraWas")} <ResultBadge result={check.result} />
          </p>
        </div>
      )}

      {/* override form — only while no override exists (audit stays singular) */}
      {overrideAction && !check.humanResult && check.requirementId && (
        <details className="group">
          <summary className="cursor-pointer select-none text-[11px] font-medium text-muted hover:text-fg">
            {t("overrideAction")}
          </summary>
          <form action={overrideAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="checkId" value={check.id} />
            <input type="hidden" name="contractId" value={contractId} />
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`hr-${check.id}`} className="text-[11px] text-muted">{t("humanDecision")}</label>
              <select
                id={`hr-${check.id}`}
                name="humanResult"
                required
                className="rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-fg"
              >
                {OVERRIDE_OPTIONS.map((o) => (
                  <option key={o} value={o}>{rt(KEY[o])}</option>
                ))}
              </select>
            </div>
            <input
              name="reason"
              required
              maxLength={1000}
              placeholder={t("overrideReason")}
              className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg placeholder:text-faint"
            />
            <button
              type="submit"
              className="inline-flex h-7 w-fit items-center rounded-sm border border-line bg-elevated px-2.5 text-xs font-medium text-fg transition-colors hover:bg-fg/5"
            >
              {t("overrideSubmit")}
            </button>
          </form>
        </details>
      )}
    </article>
  );
}
