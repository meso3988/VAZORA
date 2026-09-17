"use client";

import { ArrowDown, ArrowUpRight, ScanLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Mark } from "@/components/brand/logo";
import { EvidenceConvergence } from "@/components/brand/threads";
import { cn } from "@/lib/utils";

type Framework = {
  key: string;
  name: string;
  context: string;
  types: string[];
  method: string;
  requirement: string;
  evidence: string;
  gap: string;
  action: string;
};

/** One engine, many assessors: selecting a framework changes the assessment context below. */
export function AssessorEcosystem({ className }: { className?: string }) {
  const t = useTranslations("mineral.assessor");
  const common = useTranslations("mineral");
  const frameworks = t.raw("frameworks") as Framework[];
  const [active, setActive] = useState(0);
  const f = frameworks[active];
  return (
    <div className={cn("assessor-field", className)} data-framework={f.key}>
      <div className="system-caption">
        <span className="m-code" dir="ltr">
          VAZORA / ASSESSOR
        </span>
        <span>{common("preview")}</span>
      </div>
      <div className="assessment-layout">
        <div className="framework-rail">
          <p className="m-eyebrow">{t("framework")}</p>
          <div role="group" aria-label={t("framework")}>
            {frameworks.map((framework, i) => (
              <button
                type="button"
                key={framework.key}
                aria-pressed={i === active}
                onClick={() => setActive(i)}
                className={cn(i === active && "is-selected")}
              >
                <span className="m-code">0{i + 1}</span>
                <span>{framework.name}</span>
                <ArrowUpRight size={14} className="rtl:-scale-x-100" />
              </button>
            ))}
          </div>
        </div>
        <div className="assessment-active" aria-live="polite">
          <div className="assessment-context">
            <span className="m-eyebrow">{f.name}</span>
            <h3>{f.context}</h3>
            <span className="m-code" dir="ltr">
              LOGIC / 0{active + 1}
            </span>
          </div>
          <div className="assessment-inputs">
            <span className="m-eyebrow">{t("inputs")}</span>
            <div className="evidence-fan" key={f.key}>
              {f.types.map((type, i) => (
                <div key={type}>
                  <span className="input-index m-code">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{type}</span>
                  <i aria-hidden />
                </div>
              ))}
            </div>
          </div>
          <div className="assessment-engine">
            <span className="engine-mark">
              <Mark size={25} />
            </span>
            <div>
              <strong>{t("engine")}</strong>
              <span>{t("engineHint")}</span>
            </div>
            <ScanLine size={22} />
            <span className="engine-output" aria-hidden />
          </div>
          <div className="assessment-method">
            <span className="m-eyebrow">{t("logic")}</span>
            <p>{f.method}</p>
          </div>
          <div className="assessment-inspection">
            <div>
              <span className="m-eyebrow">{t("sample")}</span>
              <h4>{f.requirement}</h4>
              <p>{f.evidence}</p>
              <ArrowDown size={15} />
              <span className="m-eyebrow">{t("finding")}</span>
              <p className="assessment-finding">{f.gap}</p>
            </div>
            <div>
              <EvidenceConvergence state="partial" compact />
              <span className="m-eyebrow">{t("next")}</span>
              <p>{f.action}</p>
              <span className="review-boundary">{t("review")}</span>
            </div>
          </div>
        </div>
      </div>
      <p className="assessment-disclaimer">{t("disclaimer")}</p>
    </div>
  );
}
