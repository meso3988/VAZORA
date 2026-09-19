import { Check } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Mono, Panel } from "@/components/app/primitives";
import { DEMO_TODAY } from "@/data/mock/organization";
import type { Claim, Contract } from "@/domain/types";
import { formatMoney } from "@/lib/utils";

/**
 * Contract lifecycle spine — the one thing global ContractOps lacks:
 * award → execution → evidence → verification → risk → claim → closeout,
 * with a marker for today. Values come from the contract's real state.
 */
export async function ContractLifecycle({
  contract,
  nextClaim,
  today = DEMO_TODAY,
}: {
  contract: Contract;
  nextClaim?: Claim;
  today?: string;
}) {
  const t = await getTranslations("app.lifecycle");
  const st = await getTranslations("status");
  const f = await getFormatter();
  const h = contract.health;
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
    value: string;
    done?: boolean;
    active?: boolean;
    tone?: "at_risk";
  }[] = [
    { key: "award", value: safeDate(contract.startDate), done: true },
    { key: "execution", value: st(contract.status), done: true },
    { key: "evidence", value: f.number(h.evidenceCoverage, "percent"), done: h.evidenceCoverage >= 0.85 },
    { key: "verification", value: f.number(h.claimReadiness, "percent"), done: h.claimReadiness >= 0.95 },
    { key: "risk", value: formatMoney(h.riskExposure, "en", contract.currency, { compact: true }), tone: h.riskExposure > 0 ? ("at_risk" as const) : undefined },
    {
      key: "claim",
      value: nextClaim
        ? `${formatMoney(nextClaim.amount, "en", nextClaim.currency, { compact: true })} · ${safeDate(nextClaim.targetDate)}`
        : "—",
      done: Boolean(nextClaim && nextClaim.status === "approved"),
      active: Boolean(nextClaim && (nextClaim.status === "preparing" || nextClaim.status === "ready")),
    },
    { key: "closeout", value: safeDate(contract.endDate), done: false },
  ];

  const start = new Date(contract.startDate).getTime();
  const end = new Date(contract.endDate).getTime();
  const now = Math.min(Math.max(new Date(today).getTime(), start), end);
  const progress = (now - start) / (end - start);

  return (
    <Panel title={t("title")} hint={t("hint")}>
    <div className="relative px-6 py-5">
      <span aria-hidden className="absolute inset-x-8 top-[37px] h-px bg-line-strong" />
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
