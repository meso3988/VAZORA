"use client";

import { ArrowDownToLine, FileText, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { ThreadPath } from "@/components/brand/threads";
import { StatusDot, type StatusTone } from "@/components/ui/status";
import { useReducedMotionSafe } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/**
 * Signature hero sequence — one continuous causal chain:
 *  0 contract appears · 1 clauses illuminate · 2 clauses become obligations ·
 *  3 threads connect evidence · 4 verification states · 5 missing → risk ·
 *  6 the Contract Officer acts · 7 new evidence arrives, thread reconnects ·
 *  8 claim readiness progresses 73 → 82 → 91.
 *
 * Positions are percentages inside a fixed-ratio stage; the SVG overlay draws
 * Evidence Threads in the same coordinate space and is mirrored for RTL.
 */

type Item = { clause: string; obligation: string; evidence: string };
const ROWS = [18, 38, 58];
const TIMELINE = [0, 900, 1900, 3200, 4500, 5500, 6700, 8600, 9800];
const LOOP_AT = 14000;
const FINAL = TIMELINE.length - 1;

export function SignatureAnimation({ className }: { className?: string }) {
  const t = useTranslations("home.signature");
  const locale = useLocale();
  const rtl = locale === "ar";
  const reduce = useReducedMotionSafe();
  const items = t.raw("items") as Item[];

  const [timedStage, setStage] = useState(0);
  const [cycle, setCycle] = useState(0);
  const stage = reduce ? FINAL : timedStage;

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
  const statuses: StatusTone[] = ["verified", "partial", stage >= 7 ? "verified" : "missing"];
  const resolved = stage >= 4;
  const readiness = stage >= 8 ? 91 : stage >= 7 ? 82 : stage >= 4 ? 73 : 0;
  const stageKey = (
    ["reading", "reading", "structuring", "linking", "verifying", "risk", "acting", "reconnecting", "ready"] as const
  )[stage];

  return (
    <div className={cn("relative w-full select-none", className)} aria-label={t("document")} role="img">
      <div className="surface-float relative aspect-[4/3] w-full overflow-hidden bg-canvas sm:aspect-[16/10]">
        {/* status strip */}
        <div className="absolute inset-x-0 top-0 flex h-[9%] items-center justify-between border-b border-line px-[3%] text-[9px] text-faint sm:text-[10px]">
          <span className="flex items-center gap-1.5 font-mono" dir="ltr">
            <FileText size={11} />
            RTA-OM-2026-014
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", stage >= 8 ? "bg-verified" : "bg-accent [animation:pulse-soft_1.6s_ease-in-out_infinite]")} />
            {t(`stages.${stageKey}`)}
          </span>
        </div>

        {/* threads */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {ROWS.map((y, i) => {
            const tone = resolved ? statuses[i] : "neutral";
            const missing = resolved && statuses[i] === "missing";
            return (
              <g key={i}>
                <ThreadPath d={`M ${x(24)} ${y} C ${x(28)} ${y}, ${x(30)} ${y}, ${x(34)} ${y}`} on={stage >= 2} delay={i * 0.12} tone={stage >= 2 ? "accent" : "neutral"} />
                <ThreadPath
                  d={`M ${x(60)} ${y} C ${x(64)} ${y}, ${x(66)} ${y}, ${x(70)} ${y}`}
                  on={stage >= 3 && !missing}
                  delay={i * 0.12}
                  tone={tone}
                  flow={resolved && statuses[i] === "verified" && stage < 8}
                />
                {missing && <ThreadPath d={`M ${x(60)} ${y} L ${x(70)} ${y}`} on dashed tone="missing" />}
              </g>
            );
          })}
          {/* missing → risk → officer → readiness causal thread */}
          <ThreadPath d={`M ${x(84)} ${ROWS[2] + 6} L ${x(84)} 74`} on={stage >= 5} tone={stage >= 7 ? "verified" : "missing"} dashed={stage < 7} />
          <ThreadPath d={`M ${x(60)} 86 L ${x(38)} 86`} on={stage >= 6} tone="accent" />
        </svg>

        {/* document */}
        <motion.div
          className="absolute top-[13%] w-[22%] rounded-md border border-line bg-elevated p-[2.5%] shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          style={{ insetInlineStart: "3%", height: "54%" }}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-[8%] flex items-center gap-1.5 text-faint">
            <span className="truncate text-[8px] sm:text-[9px]">{t("document")}</span>
          </div>
          <div className="flex flex-col gap-[6%]">
            {Array.from({ length: 12 }).map((_, i) => {
              const clauseIdx = [2, 6, 10].indexOf(i);
              const lit = clauseIdx >= 0 && stage >= 1;
              return (
                <div
                  key={i}
                  className={cn(
                    "h-[2px] rounded-full transition-colors duration-500 sm:h-[3px]",
                    lit ? "bg-accent" : "bg-line",
                    i % 3 === 1 ? "w-[70%]" : i % 4 === 3 ? "w-[85%]" : "w-full",
                  )}
                  style={lit ? { transitionDelay: `${clauseIdx * 150}ms` } : undefined}
                />
              );
            })}
          </div>
        </motion.div>

        {/* clause markers */}
        {ROWS.map((y, i) => (
          <motion.span
            key={`c${i}`}
            className="absolute flex h-[7%] -translate-y-1/2 items-center rounded-sm border border-accent/40 bg-elevated px-1.5 font-mono text-[8px] text-accent sm:text-[10px]"
            style={{ top: `${y}%`, insetInlineStart: "17%" }}
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
            className="absolute flex h-[15%] w-[26%] -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border border-line bg-elevated px-[2%]"
            style={{ top: `${y}%`, insetInlineStart: "34%" }}
            initial={false}
            animate={{ opacity: stage >= 2 ? 1 : 0, x: stage >= 2 ? 0 : rtl ? 8 : -8 }}
            transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="eyebrow !text-[7px] sm:!text-[9px]">{t("obligation")}</span>
            <span className="line-clamp-2 text-[8px] leading-tight text-fg sm:text-[11px]">{items[i].obligation}</span>
          </motion.div>
        ))}

        {/* evidence */}
        {ROWS.map((y, i) => {
          const tone = statuses[i];
          const isThird = i === 2;
          const arrived = !isThird || stage >= 7;
          const label = isThird && stage < 7 ? t("noFile") : items[i].evidence;
          return (
            <motion.div
              key={`e${i}`}
              className={cn(
                "absolute flex h-[15%] w-[27%] -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border bg-elevated px-[2%] transition-colors duration-500",
                resolved
                  ? tone === "verified"
                    ? "border-verified/50"
                    : tone === "partial"
                      ? "border-partial/60"
                      : "border-missing/60 border-dashed"
                  : "border-line",
              )}
              style={{ top: `${y}%`, insetInlineStart: "70%" }}
              initial={false}
              animate={{ opacity: stage >= 3 ? 1 : 0, x: stage >= 3 ? 0 : rtl ? 8 : -8 }}
              transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="flex items-center gap-1 eyebrow !text-[7px] sm:!text-[9px]">
                {resolved && <StatusDot tone={tone} />}
                {isThird && stage === 7 ? t("arrived") : t("evidence")}
              </span>
              <span
                className={cn(
                  "truncate font-mono text-[8px] leading-tight sm:text-[11px]",
                  arrived ? "text-fg" : "text-faint italic",
                )}
                dir="ltr"
              >
                {label}
              </span>
              {resolved && (
                <span
                  className={cn(
                    "font-mono text-[7px] uppercase tracking-wider sm:text-[8px]",
                    tone === "verified" && "text-verified",
                    tone === "partial" && "text-partial",
                    tone === "missing" && "text-missing",
                  )}
                >
                  {t(`status.${tone}`)}
                </span>
              )}
            </motion.div>
          );
        })}

        {/* risk */}
        <motion.div
          className={cn(
            "absolute top-[74%] flex h-[8%] -translate-y-1/2 items-center gap-1.5 rounded-sm border px-2 font-mono text-[8px] transition-colors duration-500 sm:text-[10px]",
            stage >= 7 ? "border-verified/40 bg-verified/5 text-verified" : "border-missing/40 bg-missing/5 text-missing",
          )}
          style={{ insetInlineEnd: "3%" }}
          initial={false}
          animate={{ opacity: stage >= 5 ? 1 : 0, y: stage >= 5 ? 0 : 6 }}
          transition={{ duration: 0.5 }}
        >
          <span className="size-1.5 rounded-full bg-current" />
          <span dir="ltr">{stage >= 7 ? t("riskCleared") : t("risk")}</span>
        </motion.div>

        {/* officer */}
        <motion.div
          className="absolute bottom-[4%] flex h-[16%] w-[38%] items-center gap-2 overflow-hidden rounded-md border border-line bg-elevated px-[2%]"
          style={{ insetInlineEnd: "3%" }}
          initial={false}
          animate={{ opacity: stage >= 6 ? 1 : 0, y: stage >= 6 ? 0 : 8 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
            {stage >= 7 ? <ArrowDownToLine size={11} /> : <Sparkles size={11} />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="eyebrow !text-[7px] sm:!text-[8px]">{t("officer")}</span>
            <span className="truncate text-[8px] leading-snug text-fg sm:text-[10px]">
              {stage >= 7 ? t("officerFollowUp") : t("officerAction")}
            </span>
          </span>
        </motion.div>

        {/* readiness */}
        <motion.div
          className="absolute bottom-[4%] flex h-[16%] w-[30%] items-center gap-[4%] rounded-md border border-line bg-elevated px-[2%]"
          style={{ insetInlineStart: "3%" }}
          initial={false}
          animate={{ opacity: stage >= 4 ? 1 : 0, y: stage >= 4 ? 0 : 8 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <Ring value={readiness} />
          <div className="flex min-w-0 flex-col">
            <span className="eyebrow !text-[7px] sm:!text-[8px]">{t("readiness")}</span>
            <span className="font-mono text-[12px] font-medium tabular text-fg sm:text-base" dir="ltr">
              <Counter to={readiness} />%
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function Ring({ value }: { value: number }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-[70%] max-h-10 shrink-0 -rotate-90" aria-hidden>
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
        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

function Counter({ to }: { to: number }) {
  const [v, setV] = useState(to);
  const fromRef = useRef(to);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = fromRef.current;
    const dur = 900;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (to - from) * eased);
      fromRef.current = next;
      setV(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{v}</>;
}
