import { getLocale, getTranslations } from "next-intl/server";

import { StatusDot, StatusPill, statusTone, type StatusTone } from "@/components/ui/status";
import type { Clause, Evidence, Obligation } from "@/domain/types";
import { cn, lt } from "@/lib/utils";

const TONE_BORDER: Record<StatusTone, string> = {
  verified: "border-s-verified",
  partial: "border-s-partial",
  missing: "border-s-missing",
  at_risk: "border-s-at-risk",
  pending: "border-s-pending",
};

/**
 * Original clause → requirement → evidence → verification.
 * Laid out as a logical row (flex), so it mirrors correctly under RTL.
 */
export async function ClauseTrace({
  clause,
  obligation,
  evidence,
}: {
  clause: Clause;
  obligation: Obligation;
  evidence: Evidence[];
}) {
  const locale = await getLocale();
  const t = await getTranslations("app");
  const tone = statusTone[obligation.status];

  const step = "flex min-w-0 flex-1 flex-col gap-2 rounded-md border border-line bg-bg p-4";
  const label = "text-[11px] font-medium text-muted";

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-stretch">
      <div className={step}>
        <span className={label}>
          {t("obligations.columns.clause")} <span className="font-mono" dir="ltr">{clause.ref}</span>
          <span className="text-faint"> · <span dir="ltr">p.{clause.page}</span></span>
        </span>
        <span className="text-sm font-medium">{lt(clause.heading, locale)}</span>
        <p className="text-xs leading-relaxed text-muted">{lt(clause.excerpt, locale)}</p>
      </div>
      <Connector />
      <div className={step}>
        <span className={label}>{t("obligations.columns.requirement")}</span>
        <p className="text-sm leading-snug">{lt(obligation.requirement, locale)}</p>
        <ul className="mt-auto flex flex-col gap-1 text-xs text-muted">
          {obligation.requiredEvidence.map((r) => (
            <li key={r.en} className="flex items-center gap-1.5">
              <span className="size-1 rounded-full bg-line-strong" />
              {lt(r, locale)}
            </li>
          ))}
        </ul>
      </div>
      <Connector />
      <div className={step}>
        <span className={label}>{t("nav.evidence")}</span>
        {evidence.length === 0 ? (
          <p className="text-sm text-missing">{t("obligations.evidenceCount", { count: 0 })}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {evidence.map((e) => (
              <li key={e.id} className="flex items-center gap-2 text-xs">
                <StatusDot tone={statusTone[e.status]} />
                <span className="truncate font-mono" dir="ltr">{e.fileName}</span>
                <span className="ms-auto text-muted">v{e.version}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Connector />
      <div className={cn(step, "border-s-2", TONE_BORDER[tone])}>
        <span className={label}>{t("evidence.verification")}</span>
        <StatusPill status={obligation.status} />
        {evidence[0] && <p className="text-xs leading-relaxed text-muted">{lt(evidence[0].verification.summary, locale)}</p>}
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div aria-hidden className="hidden items-center md:flex">
      <span className="h-px w-5 bg-line-strong" />
      <span className="-ms-1 size-1.5 rounded-full bg-line-strong" />
    </div>
  );
}
