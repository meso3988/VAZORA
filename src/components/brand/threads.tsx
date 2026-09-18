"use client";

import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";

import type { StatusTone } from "@/components/ui/status";
import { useReducedMotionSafe } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Evidence Threads — the VAZORA connective system.
 * Fine lines and small nodes that join requirement → evidence → verification → decision.
 * Threads draw in once when they enter the viewport; a slow dash flow indicates a
 * live connection. Everything is static under reduced motion. Horizontal geometry
 * is expressed in logical terms so RTL mirrors via `scaleX(-1)` on the SVG.
 */

export const toneStroke: Record<StatusTone | "neutral" | "accent", string> = {
  neutral: "var(--thread)",
  accent: "var(--brand-accent)",
  verified: "var(--status-verified)",
  partial: "var(--status-partial)",
  missing: "var(--status-missing)",
  at_risk: "var(--status-at-risk)",
  pending: "var(--status-pending)",
};

export type ThreadTone = keyof typeof toneStroke;

export type VerificationState =
  | "unverified"
  | "received"
  | "verifying"
  | "partial"
  | "requested"
  | "resubmitted"
  | "reverifying"
  | "verified";

export function EvidenceConvergence({
  state,
  className,
  compact = false,
}: {
  state: VerificationState;
  className?: string;
  compact?: boolean;
}) {
  const t = useTranslations("mineral.thread");
  const verified = state === "verified";
  const inspecting = state === "verifying" || state === "reverifying";
  const corrective = ["requested", "resubmitted", "reverifying"].includes(
    state,
  );
  const tone: ThreadTone = verified
    ? "verified"
    : ["partial", "requested", "resubmitted", "reverifying"].includes(state)
      ? "partial"
      : "neutral";
  return (
    <div
      className={cn(
        "evidence-convergence",
        compact && "convergence-compact",
        className,
      )}
      data-proof-state={state}
      data-gap-open={!verified}
    >
      <div className="convergence-inputs">
        <span>{t("requirement")}</span>
        <span>{t("evidence")}</span>
      </div>
      <svg
        viewBox="0 0 400 152"
        fill="none"
        aria-hidden
        className="convergence-drawing"
      >
        <ThreadPath d="M 16 16 H 98 L 182 87" width={1.6} tone="neutral" />
        <ThreadPath
          d="M 384 16 H 302 L 218 87"
          width={1.6}
          tone={state === "unverified" ? "neutral" : "accent"}
          dashed={state === "unverified"}
        />
        <path d="M 16 10 V 22 M 384 10 V 22" stroke="var(--thread)" />
        <path
          d="M 200 83 L 210 93 L 200 103 L 190 93 Z"
          stroke={toneStroke[tone]}
          fill="var(--bg-elevated)"
          strokeWidth="1.4"
        />
        <ThreadPath
          d="M 182 87 L 190 93 M 218 87 L 210 93 M 200 103 V 144"
          on={verified}
          width={1.8}
          tone="verified"
        />
        {!verified && (
          <path
            d="M 200 110 V 119 M 200 133 V 144"
            stroke={toneStroke[tone]}
            strokeWidth="1.4"
          />
        )}
        {!verified && (
          <path
            d="M 194 121 H 206 M 194 131 H 206"
            stroke={toneStroke[tone]}
            strokeWidth="1.4"
          />
        )}
        {inspecting && (
          <path
            className="verification-scan"
            d="M 186 93 L 200 79 L 214 93 L 200 107 Z"
            stroke="var(--brand-accent)"
            strokeWidth="1.4"
          />
        )}
        {corrective && (
          <ThreadPath
            d="M 218 87 L 249 113 H 360 V 133"
            tone="partial"
            dashed
            width={1.2}
          />
        )}
        {verified && (
          <path
            d="m 196 93 3 3 5-6"
            stroke="var(--status-verified)"
            strokeWidth="1.5"
          />
        )}
      </svg>
      <div className="convergence-result">
        <span
          className={cn(
            "state-label",
            verified
              ? "text-verified"
              : tone === "partial"
                ? "text-partial"
                : "text-muted",
          )}
        >
          {t(state)}
        </span>
        {!compact && <small>{t(verified ? "closed" : "open")}</small>}
      </div>
    </div>
  );
}

export function ThreadPath({
  d,
  tone = "neutral",
  on = true,
  delay = 0,
  dashed,
  flow,
  width = 1,
}: {
  d: string;
  tone?: ThreadTone;
  on?: boolean;
  delay?: number;
  dashed?: boolean;
  flow?: boolean;
  width?: number;
}) {
  const reduce = useReducedMotionSafe();
  const patterned = dashed || flow;
  return (
    <motion.path
      key={patterned ? "patterned" : "solid"}
      d={d}
      fill="none"
      stroke={toneStroke[tone]}
      strokeWidth={width}
      strokeLinecap="round"
      vectorEffect={patterned ? "non-scaling-stroke" : undefined}
      strokeDasharray={dashed ? "3 4" : flow ? "10 6" : undefined}
      className={cn(
        flow && !reduce && on && "[animation:thread-flow_1.6s_linear_infinite]",
      )}
      initial={false}
      animate={patterned ? { opacity: on ? 1 : 0 } : { pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
      transition={{
        duration: reduce ? 0 : 0.9,
        delay: reduce ? 0 : delay,
        ease: "easeInOut",
      }}
      style={{ transition: "stroke 500ms" }}
    />
  );
}

export function ThreadNode({
  x,
  y,
  tone = "neutral",
  on = true,
  r = 3,
  delay = 0,
}: {
  x: number;
  y: number;
  tone?: ThreadTone;
  on?: boolean;
  r?: number;
  delay?: number;
}) {
  const reduce = useReducedMotionSafe();
  const color = toneStroke[tone];
  return (
    <motion.g
      initial={false}
      animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.6 }}
      transition={{ duration: reduce ? 0 : 0.4, delay: reduce ? 0 : delay }}
      style={{ transformOrigin: `${x}px ${y}px`, transformBox: "fill-box" }}
    >
      <circle cx={x} cy={y} r={r * 2} fill="var(--bg)" />
      <circle
        cx={x}
        cy={y}
        r={r * 1.5}
        fill="none"
        stroke={color}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={x} cy={y} r={r * 0.55} fill={color} />
    </motion.g>
  );
}

/** Draws children (thread paths) once the SVG scrolls into view. */
export function ThreadCanvas({
  viewBox,
  className,
  children,
  mirror = true,
  preserveAspectRatio = "none",
}: {
  viewBox: string;
  className?: string;
  children: (inView: boolean) => ReactNode;
  mirror?: boolean;
  preserveAspectRatio?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const reduce = useReducedMotionSafe();
  return (
    <svg
      ref={ref}
      viewBox={viewBox}
      preserveAspectRatio={preserveAspectRatio}
      aria-hidden
      className={cn(
        "overflow-visible",
        mirror && "rtl:-scale-x-100",
        className,
      )}
    >
      {children(reduce || inView)}
    </svg>
  );
}

/** A single horizontal thread that draws itself in view; safe to use from server components. */
export function ThreadLine({
  className,
  tone = "accent",
  inset = 0,
}: {
  className?: string;
  tone?: ThreadTone;
  inset?: number;
}) {
  return (
    <ThreadCanvas viewBox="0 0 100 2" className={className}>
      {(on) => (
        <ThreadPath d={`M ${inset} 1 L ${100 - inset} 1`} on={on} tone={tone} />
      )}
    </ThreadCanvas>
  );
}

/**
 * Decorative field of converging threads used behind the hero and in the footer.
 * Pure SVG, stroke-only, no fills or glows. Hidden on very small screens by callers.
 */
export function ThreadField({
  className,
  tone = "neutral",
}: {
  className?: string;
  tone?: ThreadTone;
}) {
  const stroke = toneStroke[tone];
  const paths = [
    "M0 40 C 220 40, 300 120, 520 120 S 820 200, 1000 200",
    "M0 120 C 200 120, 320 160, 520 160 S 800 200, 1000 200",
    "M0 200 C 240 200, 300 200, 520 200 S 800 200, 1000 200",
    "M0 280 C 200 280, 320 240, 520 240 S 800 200, 1000 200",
    "M0 360 C 220 360, 300 280, 520 280 S 820 200, 1000 200",
  ];
  return (
    <svg
      viewBox="0 0 1000 400"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("pointer-events-none rtl:-scale-x-100", className)}
    >
      {paths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={0.35 + (i === 2 ? 0.25 : 0)}
        />
      ))}
      <circle
        cx={1000}
        cy={200}
        r={5}
        fill="var(--bg)"
        stroke="var(--brand-accent)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={1000} cy={200} r={2} fill="var(--brand-accent)" />
    </svg>
  );
}
