"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { EvidenceConvergence } from "@/components/brand/threads";
import { cn } from "@/lib/utils";

export function ClaimCanvas() {
  const t = useTranslations("mineral.claim");
  const common = useTranslations("mineral");
  const items = t.raw("items") as {
    ref: string;
    title: string;
    status: string;
    missing: string;
    action: string;
  }[];
  const [selected, setSelected] = useState(0);
  const item = items[selected];
  return (
    <div className="claim-canvas">
      <div className="system-caption">
        <span>{t("label")}</span>
        <span>{common("demo")}</span>
      </div>
      <div className="claim-financial">
        <div className="claim-value">
          <span className="m-eyebrow">{t("value")}</span>
          <p dir="ltr">
            <span>SAR</span>1,850,000
          </p>
        </div>
        <div className="claim-readiness">
          <span className="m-eyebrow">{t("readiness")}</span>
          <p dir="ltr">
            82<span>%</span>
          </p>
          <small>{t("scoreNote")}</small>
        </div>
      </div>
      <div className="claim-coverage">
        <div className="claim-coverage-labels">
          <span>{t("requirements")}</span>
          <span className="text-verified">{t("verified")}</span>
          <span className="text-partial">{t("partial")}</span>
          <span className="text-missing">{t("missing")}</span>
        </div>
        <div className="requirement-segments" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={
                i < 9 ? "is-verified" : i < 11 ? "is-partial" : "is-missing"
              }
            />
          ))}
        </div>
      </div>
      <div className="claim-inspection">
        <div>
          <h3>{t("blockers")}</h3>
          <p className="m-eyebrow">{t("select")}</p>
          <div className="claim-blockers" role="group" aria-label={t("select")}>
            {items.map((entry, i) => (
              <button
                key={entry.ref}
                type="button"
                aria-pressed={selected === i}
                onClick={() => setSelected(i)}
                className={cn(selected === i && "is-selected")}
              >
                <span className="m-code" dir="ltr">
                  § {entry.ref}
                </span>
                <span>
                  {entry.title}
                  <small>{entry.status}</small>
                </span>
                <ArrowUpRight size={17} className="rtl:-scale-x-100" />
              </button>
            ))}
          </div>
        </div>
        <div className="claim-gap-detail" aria-live="polite">
          <EvidenceConvergence
            state={selected === 2 ? "unverified" : "partial"}
            compact
          />
          <div>
            <span className="m-eyebrow">{t("gap")}</span>
            <h4>{item.missing}</h4>
            <span className="m-eyebrow">{t("action")}</span>
            <p>{item.action}</p>
          </div>
        </div>
      </div>
      <div className="claim-boundary">
        <div>
          <span className="m-eyebrow">{t("impactLabel")}</span>
          <p>{t("impact")}</p>
        </div>
        <p>{t("boundary")}</p>
      </div>
    </div>
  );
}
