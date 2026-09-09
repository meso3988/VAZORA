"use client";

import { Bell, FileText } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { StatusDot, type StatusTone } from "@/components/ui/status";
import { useReducedMotionSafe } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Signature animation: a contract enters, clauses are recognised, become
 * obligations, connect to evidence, resolve to verified / partial / missing,
 * claim readiness is computed and the Contract Officer raises the gap.
 *
 * Positions are percentages inside a fixed-ratio stage; the SVG overlay draws
 * connectors in the same coordinate space and is mirrored for RTL.
 */

type Item = { clause: string; obligation: string; evidence: string };
const STATUSES: StatusTone[] = ["verified", "partial", "missing"];
const ROWS = [24, 46, 68]; // y% of each clause/obligation/evidence row
const READINESS = 82;

// stage: 0 document, 1 clauses, 2 obligations, 3 evidence, 4 statuses, 5 readiness, 6 officer
const TIMELINE = [0, 900, 1900, 3300, 4700, 5700, 7200];
const LOOP_AT = 12500;

export function SignatureAnimation({ className }: { className?: string }) {
  const t = useTranslations("home.signature");
  const locale = useLocale();
  const rtl = locale === "ar";
  const reduce = useReducedMotionSafe();
  const items = t.raw("items") as Item[];

  const [timedStage, setStage] = useState(0);
  const [cycle, setCycle] = useState(0);
  const stage = reduce ? 6 : timedStage;

  useEffect(() => {
    if (reduce) return;
    const timers = TIMELINE.map((ms, i) => setTimeout(() => setStage(i), ms));
    const loop = setTimeout(() => setCycle((c) => c + 1), LOOP_AT);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(loop);
    };
  }, [cycle, reduce]);

  const x = (v: number) => (rtl ? 100 - v : v);
  const stageLabel = (["reading", "reading", "structuring", "linking", "verifying", "ready", "ready"] as const)[stage];

  return (
    <div
      className={cn("relative w-full select-none", className)}
      aria-label={t("document")}
      role="img"
    >
      <div className="relative aspect-[4/3] w-full sm:aspect-[16/10]">
        {/* connectors */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          aria-hidden
        >
          {ROWS.map((y, i) => (
            <g key={i}>
              <Trace
                x1={x(27)}
                x2={x(35)}
                y={y}
                on={stage >= 2}
                delay={i * 0.12}
                tone={stage >= 4 ? STATUSES[i] : undefined}
              />
              <Trace
                x1={x(63)}
                x2={x(71)}
                y={y}
                on={stage >= 3}
                delay={i * 0.12}
                tone={stage >= 4 ? STATUSES[i] : undefined}
              />
            </g>
          ))}
          {/* missing evidence → officer */}
          <motion.line
            x1={x(85)}
            x2={x(85)}
            y1={ROWS[2] + 7}
            y2={83}
            stroke="var(--status-missing)"
            strokeWidth={0.35}
            strokeDasharray="1.2 1.2"
            vectorEffect="non-scaling-stroke"
            initial={false}
            animate={{ opacity: stage >= 6 ? 0.8 : 0 }}
            transition={{ duration: 0.5 }}
          />
        </svg>

        {/* document */}
        <motion.div
          className="absolute top-[8%] bottom-[24%] w-[27%] rounded-md border border-line bg-elevated/90 p-[3%]"
          style={{ insetInlineStart: 0 }}
          initial={false}
          animate={{ opacity: stage >= 0 ? 1 : 0, y: stage >= 0 ? 0 : 12 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-[8%] flex items-center gap-1.5 text-faint">
            <FileText size={12} />
            <span className="truncate font-mono text-[9px] sm:text-[10px]">{t("document")}</span>
          </div>
          <div className="flex flex-col gap-[6%]">
            {Array.from({ length: 11 }).map((_, i) => {
              const clauseIdx = [2, 5, 8].indexOf(i);
              const isClause = clauseIdx >= 0;
              const lit = isClause && stage >= 1;
              return (
                <div
                  key={i}
                  className={cn(
                    "h-[3px] rounded-full transition-colors duration-500 sm:h-1",
                    lit ? "bg-accent" : "bg-line",
                    i % 3 === 1 ? "w-[70%]" : i % 4 === 3 ? "w-[85%]" : "w-full",
                  )}
                  style={lit ? { transitionDelay: `${clauseIdx * 150}ms` } : undefined}
                />
              );
            })}
          </div>
        </motion.div>

        {/* clause markers on the document edge */}
        {ROWS.map((y, i) => (
          <motion.span
            key={`c${i}`}
            className="absolute flex h-5 -translate-y-1/2 items-center rounded-sm border border-accent/40 bg-bg px-1.5 font-mono text-[9px] text-accent sm:text-[10px]"
            style={{ top: `${y}%`, insetInlineStart: "18%" }}
            initial={false}
            animate={{ opacity: stage >= 1 ? 1 : 0, scale: stage >= 1 ? 1 : 0.8 }}
            transition={{ duration: 0.4, delay: i * 0.15 }}
          >
            {items[i].clause}
          </motion.span>
        ))}

        {/* obligations */}
        {ROWS.map((y, i) => (
          <motion.div
            key={`o${i}`}
            className="absolute flex h-[15%] w-[28%] -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border border-line bg-elevated px-[2%]"
            style={{ top: `${y}%`, insetInlineStart: "35%" }}
            initial={false}
            animate={{ opacity: stage >= 2 ? 1 : 0, x: stage >= 2 ? 0 : rtl ? 8 : -8 }}
            transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="eyebrow !text-[8px] sm:!text-[9px]">{t("obligation")}</span>
            <span className="line-clamp-2 text-[9px] leading-tight text-fg sm:text-[11px]">
              {items[i].obligation}
            </span>
          </motion.div>
        ))}

        {/* evidence */}
        {ROWS.map((y, i) => {
          const tone = STATUSES[i];
          const resolved = stage >= 4;
          return (
            <motion.div
              key={`e${i}`}
              className={cn(
                "absolute flex h-[15%] w-[29%] -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border bg-elevated px-[2%] transition-colors duration-500",
                resolved
                  ? tone === "verified"
                    ? "border-verified/50"
                    : tone === "partial"
                      ? "border-partial/50"
                      : "border-missing/50"
                  : "border-line",
              )}
              style={{ top: `${y}%`, insetInlineStart: "71%" }}
              initial={false}
              animate={{ opacity: stage >= 3 ? 1 : 0, x: stage >= 3 ? 0 : rtl ? 8 : -8 }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="flex items-center gap-1 eyebrow !text-[8px] sm:!text-[9px]">
                {resolved && <StatusDot tone={tone} />}
                {t("evidence")}
              </span>
              <span
                className={cn(
                  "truncate font-mono text-[9px] leading-tight sm:text-[11px]",
                  resolved && tone === "missing" ? "text-missing" : "text-fg",
                )}
                dir="ltr"
              >
                {items[i].evidence}
              </span>
            </motion.div>
          );
        })}

        {/* readiness */}
        <motion.div
          className="absolute bottom-0 flex h-[20%] w-[48%] items-center gap-[3%] rounded-md border border-line bg-elevated px-[3%]"
          style={{ insetInlineStart: 0 }}
          initial={false}
          animate={{ opacity: stage >= 5 ? 1 : 0, y: stage >= 5 ? 0 : 8 }}
          transition={{ duration: 0.5 }}
        >
          <Ring value={stage >= 5 ? READINESS : 0} animate={!reduce} />
          <div className="flex min-w-0 flex-col">
            <span className="eyebrow !text-[8px] sm:!text-[9px]">{t("readiness")}</span>
            <span className="font-mono text-base font-medium tabular text-fg sm:text-xl">
              <Counter to={stage >= 5 ? READINESS : 0} animate={!reduce} />%
            </span>
          </div>
        </motion.div>

        {/* officer */}
        <motion.div
          className="absolute bottom-0 flex h-[20%] w-[48%] items-start gap-2 rounded-md border border-missing/40 bg-elevated p-[2.5%]"
          style={{ insetInlineEnd: 0 }}
          initial={false}
          animate={{ opacity: stage >= 6 ? 1 : 0, y: stage >= 6 ? 0 : 8 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm bg-missing/15 text-missing">
            <Bell size={11} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="eyebrow !text-[8px] sm:!text-[9px]">{t("officer")}</span>
            <span className="line-clamp-2 text-[9px] leading-snug text-fg sm:text-[11px]">
              {t("officerMessage")}
            </span>
            <span className="hidden font-mono text-[9px] text-missing sm:block">{t("officerExposure")}</span>
          </div>
        </motion.div>
      </div>

      {/* stage indicator */}
      <div className="mt-4 flex items-center gap-2 text-xs text-faint">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-[pulse-soft_2s_ease-in-out_infinite] rounded-full bg-accent" />
        </span>
        <span className="font-mono">{t(`stages.${stageLabel}`)}</span>
      </div>
    </div>
  );
}

function Trace({
  x1,
  x2,
  y,
  on,
  delay,
  tone,
}: {
  x1: number;
  x2: number;
  y: number;
  on: boolean;
  delay: number;
  tone?: StatusTone;
}) {
  const color = tone
    ? tone === "verified"
      ? "var(--status-verified)"
      : tone === "partial"
        ? "var(--status-partial)"
        : "var(--status-missing)"
    : "var(--line-strong)";
  return (
    <motion.line
      x1={x1}
      x2={x2}
      y1={y}
      y2={y}
      stroke={color}
      strokeWidth={0.35}
      vectorEffect="non-scaling-stroke"
      initial={false}
      animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
      transition={{ duration: 0.6, delay, ease: "easeOut" }}
      style={{ transition: "stroke 500ms" }}
    />
  );
}

function Ring({ value, animate }: { value: number; animate: boolean }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-[70%] max-h-12 shrink-0 -rotate-90 rtl:rotate-90 rtl:scale-x-[-1]" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--line)" strokeWidth="2.5" />
      <motion.circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="var(--status-verified)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c - (c * value) / 100 }}
        transition={{ duration: animate ? 1.2 : 0, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

function Counter({ to, animate }: { to: number; animate: boolean }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const dur = 1200;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, animate]);
  return <>{animate ? v : to}</>;
}
