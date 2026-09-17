"use client";

import { Check, CornerDownRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { EvidenceEnvironment } from "@/components/brand/evidence-environment";
import {
  EvidenceConvergence,
  type VerificationState,
} from "@/components/brand/threads";
import { SequenceControls } from "@/components/site/signature-animation";
import { useNarrativePlayback } from "@/lib/hooks";
import { cn } from "@/lib/utils";

const STATES: VerificationState[] = [
  "unverified",
  "requested",
  "received",
  "verifying",
  "partial",
  "requested",
  "resubmitted",
  "reverifying",
  "verified",
  "verified",
];

/** Operational activity stream of the AI Contract Officer — entries arrive in sequence once in view. */
export function ActivityStream({ className }: { className?: string }) {
  const t = useTranslations("mineral.officer");
  const common = useTranslations("mineral");
  const entries = t.raw("events") as {
    time: string;
    text: string;
    detail: string;
  }[];
  const ref = useRef<HTMLDivElement>(null);
  const playback = useNarrativePlayback(ref, entries.length, 2200);
  const { step } = playback;
  const impacted = step === 9;
  return (
    <div
      className={cn("officer-workspace", className)}
      ref={ref}
      data-officer-step={step}
    >
      <EvidenceEnvironment
        className="officer-environment"
        tone="graphite"
        state={STATES[step]}
        source={{
          reference: "RTA-OM-2026-014",
          clause: "14.2",
          excerpt: entries[0].detail,
          evidence:
            step < 2
              ? null
              : step >= 6
                ? "Signed_Acknowledgement.pdf"
                : "Performance_Sep.pdf",
        }}
      />
      <div className="system-caption">
        <span>{t("context")}</span>
        <span>{common("demo")}</span>
      </div>
      <div className="officer-layout">
        <ol className="officer-timeline">
          {entries.map((entry, i) => (
            <li
              key={entry.time}
              className={cn(
                i === step && "is-current",
                i > step && "is-future",
              )}
            >
              <button
                type="button"
                onClick={() => playback.seek(i)}
                aria-current={i === step ? "step" : undefined}
              >
                <time className="m-code" dir="ltr">
                  {entry.time}
                </time>
                <span className="timeline-node" aria-hidden>
                  {i < step ? <Check size={10} /> : null}
                </span>
                <span>{entry.text}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className="officer-inspection">
          <p className="m-eyebrow">{t("day")}</p>
          <EvidenceConvergence state={STATES[step]} />
          <div
            className="officer-cause"
            aria-live={playback.playing ? "off" : "polite"}
          >
            <CornerDownRight size={17} className="rtl:-scale-x-100" />
            <p>{entries[step].detail}</p>
          </div>
          <dl className="officer-effects" data-impact-updated={impacted}>
            <div>
              <dt>{t("risk")}</dt>
              <dd className={impacted ? "text-verified" : "text-partial"}>
                {t(impacted ? "mitigated" : "open")}
              </dd>
            </div>
            <div>
              <dt>{t("obligation")}</dt>
              <dd>
                {t(step >= 8 ? "verified" : step >= 4 ? "partial" : "open")}
              </dd>
            </div>
            <div>
              <dt>{t("action")}</dt>
              <dd
                data-action-state={
                  impacted ? "resolved" : step >= 5 ? "open" : "pending"
                }
              >
                {t(impacted ? "resolved" : step >= 5 ? "open" : "notCreated")}
              </dd>
            </div>
            <div>
              <dt>{t("readiness")}</dt>
              <dd
                className="officer-score"
                dir="ltr"
                data-readiness={impacted ? 91 : 82}
              >
                {impacted ? 91 : 82}
                <small>%</small>
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <div className="officer-workspace-foot">
        <p>{t("note")}</p>
        <SequenceControls playback={playback} />
      </div>
    </div>
  );
}
