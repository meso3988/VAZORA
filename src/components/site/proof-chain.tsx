"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ThreadPath, type ThreadTone } from "@/components/brand/threads";
import { useReducedMotionSafe } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Original clause → Requirement → Evidence → Verification → Decision, one step selectable at a time. */
export function ProofChain({ className }: { className?: string }) {
  const t = useTranslations("home.shift");
  const steps = t.raw("chain") as string[];
  const detail = t.raw("chainDetail") as { title: string; body: string }[];
  const [active, setActive] = useState(3);
  const reduce = useReducedMotionSafe();

  const tones: ThreadTone[] = ["neutral", "neutral", "accent", "partial", "partial"];
  const n = steps.length;
  const cx = (i: number) => ((i + 0.5) * 100) / n;

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      <div className="relative">
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" className="absolute inset-x-0 top-[0.5rem] h-3 w-full overflow-visible rtl:-scale-x-100" aria-hidden>
          {steps.slice(0, -1).map((_, i) => (
            <ThreadPath
              key={i}
              d={`M ${cx(i)} 6 L ${cx(i + 1)} 6`}
              tone={i < active ? tones[i + 1] : "neutral"}
              on
              flow={i === active - 1}
              width={1}
            />
          ))}
        </svg>
        <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => (
            <li key={s} className="flex justify-center">
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={cn(
                  "flex flex-col items-center gap-3 pt-[0.35rem] text-center transition-colors",
                  i === active ? "text-fg" : "text-faint hover:text-muted",
                )}
              >
                <span
                  className={cn(
                    "size-4 rounded-full border-2 bg-bg transition-colors",
                    i === active ? "border-accent" : i < active ? "border-fg/50" : "border-line-strong",
                  )}
                />
                <span className="text-[11px] leading-tight sm:text-xs">
                  <span className="mb-1 block font-mono text-[10px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="relative min-h-[8.5rem] border-t border-line pt-6 sm:min-h-[7rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-10"
          >
            <p className="text-sm font-medium text-fg">{detail[active]?.title}</p>
            <p className="text-sm leading-relaxed text-muted">{detail[active]?.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="text-xs text-faint">{t("hint")}</p>
    </div>
  );
}
