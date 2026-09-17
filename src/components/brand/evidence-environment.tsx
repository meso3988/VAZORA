"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { ThreadPath, type VerificationState } from "@/components/brand/threads";
import { cn } from "@/lib/utils";

type EvidenceSource = {
  reference: string;
  clause: string;
  excerpt: string;
  evidence: string | null;
};

const REQUIREMENT_PATH = "M -40 270 H 164 L 618 660 L 680 714";
const EVIDENCE_PATH = "M 1440 270 H 1236 L 782 660 L 720 714";

export function EvidenceEnvironment({
  state,
  source,
  detected = true,
  tone = "mineral",
  className,
}: {
  state: VerificationState;
  source: EvidenceSource;
  detected?: boolean;
  tone?: "mineral" | "graphite";
  className?: string;
}) {
  const t = useTranslations("mineral.environment");
  const status = useTranslations("mineral.thread");
  const id = useId().replace(/:/g, "");
  const verified = state === "verified";
  const inspecting = state === "verifying" || state === "reverifying";
  const corrective = ["requested", "resubmitted", "reverifying"].includes(
    state,
  );
  const evidencePresent = Boolean(source.evidence);

  return (
    <div
      className={cn("evidence-environment", className)}
      data-env-tone={tone}
      data-env-state={state}
      data-env-detected={detected}
      aria-hidden="true"
    >
      <div className="env-bed" />
      <svg
        className="env-material"
        viewBox="0 0 1400 1000"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${id}-stone`} x1="0" y1="0" x2=".85" y2="1">
            <stop stopColor="var(--env-pearl)" />
            <stop offset=".52" stopColor="var(--env-stone)" />
            <stop offset="1" stopColor="var(--env-depth)" />
          </linearGradient>
          <linearGradient id={`${id}-silver`} x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="var(--env-depth)" />
            <stop offset=".6" stopColor="var(--env-silver)" />
            <stop offset="1" stopColor="var(--env-pearl)" />
          </linearGradient>
        </defs>
        <path
          className="env-plane env-plane-source"
          d="M -160 410 L 460 112 L 850 490 L 196 826 Z"
          fill={`url(#${id}-stone)`}
        />
        <path
          className="env-plane env-plane-evidence"
          d="M 1000 130 L 1580 348 L 1190 810 L 640 548 Z"
          fill={`url(#${id}-silver)`}
        />
        <path
          className="env-plane env-plane-inspection"
          d="M -90 830 L 708 526 L 1530 864 L 1400 1100 H 0 Z"
          fill={`url(#${id}-stone)`}
        />
        <g className="env-surface-edges" fill="none" stroke="var(--env-edge)">
          <path d="M -160 410 L 460 112 L 850 490 M 1000 130 L 1580 348 M -90 830 L 708 526 L 1530 864" />
          <path
            d="M -150 429 L 453 140 M 1188 812 L 643 551"
            className="env-recess"
          />
        </g>
      </svg>
      <svg className="env-grain" width="100%" height="100%" focusable="false">
        <defs>
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".72"
              numOctaves="3"
              stitchTiles="stitch"
              seed="17"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <pattern
            id={`${id}-texture`}
            width="160"
            height="160"
            patternUnits="userSpaceOnUse"
          >
            <rect width="160" height="160" filter={`url(#${id}-grain)`} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id}-texture)`} />
      </svg>
      <div className="env-raking-light" />
      <div className="env-fragment env-fragment-source">
        <div className="env-fragment-meta">
          <span>{t("source")}</span>
          <span className="m-code" dir="ltr">
            {source.reference}
          </span>
        </div>
        <p className="env-clause" dir="ltr">
          § {source.clause}
        </p>
        <p className="env-excerpt">{source.excerpt}</p>
        <span className="env-fragment-rule" />
        <span className="env-fragment-caption">
          {t(detected ? "extracted" : "sourceTruth")}
        </span>
      </div>
      <div className="env-fragment env-fragment-evidence">
        <div className="env-fragment-meta">
          <span>{t("evidence")}</span>
          <span className="m-code" dir="ltr">
            § {source.clause}
          </span>
        </div>
        <p className="env-file" dir="ltr">
          {source.evidence ?? "—"}
        </p>
        <p className="env-evidence-link">{t("linked")}</p>
        <div className="env-ledger">
          <span className="env-ledger-mark" />
          <span>{status(state)}</span>
        </div>
      </div>
      <svg
        className="env-plan"
        viewBox="0 0 1400 1000"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        focusable="false"
      >
        <g
          className="env-engraved-channels"
          stroke="var(--env-recess)"
          strokeWidth="5"
        >
          <path d={REQUIREMENT_PATH} />
          <path d={EVIDENCE_PATH} />
        </g>
        <g className="env-evidence-traces">
          <ThreadPath
            d={REQUIREMENT_PATH}
            on={detected}
            tone="neutral"
            width={1.2}
          />
          <ThreadPath
            d={EVIDENCE_PATH}
            tone={evidencePresent ? "accent" : "neutral"}
            dashed={!evidencePresent}
            width={1.2}
          />
          <path
            d="M 700 714 L 712 726 L 700 738 L 688 726 Z"
            stroke="var(--env-signal)"
            strokeWidth="1.3"
            fill="var(--env-stone)"
          />
          {verified ? (
            <g data-env-bridge="verified">
              <ThreadPath
                d="M 680 714 L 688 726 M 720 714 L 712 726 M 700 738 V 1000"
                tone="verified"
                width={1.7}
              />
            </g>
          ) : (
            <g className="env-open-seam" stroke="var(--env-signal)">
              <path d="M 700 754 V 802 M 700 826 V 1000 M 693 809 H 707 M 693 819 H 707" />
            </g>
          )}
          {corrective && (
            <ThreadPath
              d="M 720 714 H 862 L 1050 864 H 1440"
              dashed
              tone="partial"
              width={1.1}
            />
          )}
        </g>
        {inspecting && (
          <g
            key={state}
            className="env-inspection-signal"
            stroke="var(--brand-accent)"
            strokeWidth="2"
          >
            <path className="env-probe" d={REQUIREMENT_PATH} pathLength="1" />
            <path className="env-probe" d={EVIDENCE_PATH} pathLength="1" />
          </g>
        )}
      </svg>
      <div className="env-reading-field" />
      <div className="env-edge-reference">
        <span className="m-code" dir="ltr">
          {source.reference} / § {source.clause}
        </span>
        <span>{t("illustrative")}</span>
      </div>
      <div className="env-vignette" />
    </div>
  );
}
