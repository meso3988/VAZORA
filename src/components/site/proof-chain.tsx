"use client";

import { ArrowUpRight, Check, FileText, Minus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { EvidenceConvergence } from "@/components/brand/threads";
import { cn } from "@/lib/utils";

/** Original clause → Requirement → Evidence → Verification → Decision, one check selectable at a time. */
export function ProofChain({ className }: { className?: string }) {
  const t = useTranslations("mineral.proof");
  const common = useTranslations("mineral");
  const checks = t.raw("checks") as {
    label: string;
    value: string;
    detail: string;
  }[];
  const [active, setActive] = useState(3);
  return (
    <div className={cn("proof-workbench", className)}>
      <div className="system-caption">
        <span className="m-code" dir="ltr">
          PROOF / 12.1
        </span>
        <span>{common("demo")}</span>
      </div>
      <div className="proof-layout">
        <aside className="proof-source">
          <div className="source-heading">
            <FileText size={16} />
            <span>{t("source")}</span>
          </div>
          <span className="proof-clause-number" dir="ltr">
            § 12.1
          </span>
          <blockquote>{t("quote")}</blockquote>
          <div className="proof-extracted">
            <span className="m-eyebrow">{t("requirement")}</span>
            <p>{t("requirementBody")}</p>
          </div>
          <div className="proof-source-meta m-code" dir="ltr">
            RTA-OM-2026-014 / P.12
          </div>
        </aside>
        <div className="proof-inspector">
          <div className="proof-evidence">
            <span className="m-eyebrow">{t("evidence")}</span>
            <h3 dir="ltr">Performance_Sep.pdf</h3>
            <p>{t("fileMeta")}</p>
          </div>
          <span className="m-eyebrow">{t("inspect")}</span>
          <div className="proof-checks" role="group" aria-label={t("inspect")}>
            {checks.map((check, i) => {
              const tone = i < 2 ? "verified" : i === checks.length - 1 ? "missing" : "partial";
              return (
              <button
                type="button"
                key={check.label}
                aria-pressed={active === i}
                onClick={() => setActive(i)}
                className={cn(`proof-check is-${tone}`, active === i && "is-selected")}
              >
                <span className={`check-icon text-${tone}`}>
                  {tone === "verified" ? <Check size={16} /> : tone === "missing" ? <X size={16} /> : <Minus size={16} />}
                </span>
                <span>{check.label}</span>
                <strong className={`check-value text-${tone}`} dir="ltr">
                  <bdi>{check.value}</bdi>
                </strong>
                <ArrowUpRight size={14} className="rtl:-scale-x-100" />
              </button>
              );
            })}
          </div>
          <div className="proof-inspection-detail" aria-live="polite">
            <span className="m-code">0{active + 1}</span>
            <p>{checks[active].detail}</p>
          </div>
          <p className="proof-source-link">{t("sourceLink")}</p>
        </div>
        <div className="proof-decision">
          <EvidenceConvergence state="partial" compact />
          <span className="state-label text-partial">{t("decision")}</span>
          <h3>{t("impact")}</h3>
          <p>{t("request")}</p>
        </div>
      </div>
      <div className="workbench-foot">
        <span className="gap-symbol" aria-hidden />
        <p>{t("why")}</p>
      </div>
    </div>
  );
}
