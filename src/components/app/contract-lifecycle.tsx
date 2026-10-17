import { Check } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { IndicatorValue, indicatorValue } from "@/components/app/indicator";
import { Mono, Panel } from "@/components/app/primitives";
import type { ContractIndicators } from "@/domain/indicators";
import type { Claim, Contract } from "@/domain/types";
import { formatMoney } from "@/lib/utils";

/**
 * Contract lifecycle spine — the one thing global ContractOps lacks:
 * award → execution → evidence → verification → risk → claim → closeout,
 * with a marker for today. Values come from the contract's indicators; a
 * stage with no calculation says so instead of showing a placeholder.
 */
export async function ContractLifecycle({
  contract,
  nextClaim,
  indicators,
  today,
}: {
  contract: Contract;
  nextClaim?: Claim;
  indicators: ContractIndicators | undefined;
  /** the organization's local date; null hides the today marker */
  today: string | null;
}) {
  const t = await getTranslations("app.lifecycle");
  const st = await getTranslations("status");
  const f = await getFormatter();
  const coverage = indicatorValue(indicators?.evidenceCoverage);
  const readiness = indicatorValue(indicators?.claimReadiness);
  const exposure = indicatorValue(indicators?.riskExposure);
  const claimDeferred = indicators?.claimReadiness.state === "deferred";
  const safeDate = (iso: string, style: "short" | "medium" = "short") => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : f.dateTime(d, style);
  };
  const stageLabels = {
    award: t("stages.award"),
    execution: t("stages.execution"),
    evidence: t("stages.evidence"),
    verification: t("stages.verification"),
    risk: t("stages.risk"),
    claim: t("stages.claim"),
    closeout: t("stages.closeout"),
  };

  const stages: {
    key: keyof typeof stageLabels;
    value: ReactNode;
    done?: boolean;
    active?: boolean;
    tone?: "at_risk";
  }[] = [
    { key: "award", value: safeDate(contract.startDate), done: true },
    { key: "execution", value: st(contract.status), done: true },
    {
      key: "evidence",
      value: <IndicatorValue name="evidenceCoverage" indicator={indicators?.evidenceCoverage} format="percent" short />,
      done: coverage != null && coverage >= 0.85,
    },
    {
      key: "verification",
      value: <IndicatorValue name="claimReadiness" indicator={indicators?.claimReadiness} format="percent" short />,
      done: readiness != null && readiness >= 0.95,
    },
    {
      key: "risk",
      value: <IndicatorValue name="riskExposure" indicator={indicators?.riskExposure} format={{ money: contract.currency }} compact short />,
      tone: exposure ? ("at_risk" as const) : undefined,
    },
    {
      key: "claim",
      value: claimDeferred
        ? <IndicatorValue name="claimReadiness" indicator={indicators?.claimReadiness} short />
        : nextClaim
          ? `${formatMoney(nextClaim.amount, "en", nextClaim.currency, { compact: true })} · ${safeDate(nextClaim.targetDate)}`
          : "—",
      done: Boolean(nextClaim && nextClaim.status === "approved"),
      active: Boolean(nextClaim && (nextClaim.status === "preparing" || nextClaim.status === "ready")),
    },
    { key: "closeout", value: safeDate(contract.endDate), done: false },
  ];

  // Today's position needs a known today and a valid contract period.
  const start = new Date(contract.startDate).getTime();
  const end = new Date(contract.endDate).getTime();
  const todayMs = today ? new Date(today).getTime() : NaN;
  const progress = Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(todayMs) && end > start
    ? (Math.min(Math.max(todayMs, start), end) - start) / (end - start)
    : null;

  return (
    <Panel title={t("title")} hint={t("hint")}>
    <div className="relative px-6 py-5" data-section="lifecycle">
      <span aria-hidden className="absolute inset-x-8 top-[37px] h-px bg-line-strong" />
      {progress != null && today && (
        <>
          <span
            aria-hidden
            className="absolute top-[37px] h-px bg-verified"
            style={{ insetInlineStart: 32, width: `calc((100% - 64px) * ${progress})` }}
          />
          <span
            aria-hidden
            className="absolute top-[33px] size-[9px] rounded-full bg-fg"
            style={{ insetInlineStart: `calc(32px + (100% - 64px) * ${progress})`, transform: "translateX(-50%)" }}
            title={safeDate(today, "medium")}
          />
        </>
      )}
      <ol className="grid grid-cols-4 gap-y-6 sm:grid-cols-7">
        {stages.map((stage) => (
          <li key={stage.key} className="relative flex flex-col items-center gap-2 text-center">
            <span
              className={`flex size-[18px] rotate-45 items-center justify-center rounded-[3px] border ${
                stage.done
                  ? "border-verified bg-verified text-white"
                  : stage.active
                    ? "border-partial bg-bg text-partial"
                    : stage.tone === "at_risk"
                      ? "border-at-risk bg-bg text-at-risk"
                      : "border-line-strong bg-bg text-transparent"
              } ${stage.active ? "animate-pulse" : ""}`}
            >
              {stage.done && <Check size={10} strokeWidth={3.5} className="-rotate-45" />}
            </span>
            <span className="text-[11px] font-medium">{stageLabels[stage.key]}</span>
            <Mono className="text-[10px] text-muted">{stage.value}</Mono>
          </li>
        ))}
      </ol>
    </div>
    </Panel>
  );
}
