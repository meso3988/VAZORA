"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Mark } from "@/components/brand/logo";
import { useReducedMotionSafe } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Framework = {
  key: string;
  label: string;
  context: string;
  requirements: string;
  questions: string;
  evidence: string;
  sampling: string;
};

/** One engine, many assessors: selecting a framework changes the assessment context below. */
export function AssessorEcosystem({ className }: { className?: string }) {
  const t = useTranslations("home.assessor");
  const frameworks = t.raw("frameworks") as Framework[];
  const labels = t.raw("labels") as Record<"requirements" | "questions" | "evidence" | "sampling" | "context" | "engine", string>;
  const [active, setActive] = useState(0);
  const reduce = useReducedMotionSafe();
  const f = frameworks[active];

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-md border border-line bg-elevated text-fg">
          <Mark size={16} />
        </span>
        <span className="text-xs text-muted">{labels.engine}</span>
        <span aria-hidden className="h-px flex-1 bg-thread" />
      </div>

      <div role="tablist" aria-label={labels.context} className="flex flex-wrap gap-2">
        {frameworks.map((fw, i) => (
          <button
            key={fw.key}
            role="tab"
            type="button"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm transition-colors",
              i === active ? "border-fg bg-fg text-bg" : "border-line-strong bg-transparent text-muted hover:border-fg/50 hover:text-fg",
            )}
          >
            {fw.label}
          </button>
        ))}
      </div>

      <div className="surface-float overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.dl
            key={f.key}
            role="tabpanel"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.28 }}
            className="grid grid-cols-1 divide-y divide-line"
          >
            <div className="flex items-baseline justify-between gap-4 px-5 py-4">
              <dt className="eyebrow">{labels.context}</dt>
              <dd className="text-sm font-medium text-end">{f.context}</dd>
            </div>
            {(["requirements", "questions", "evidence", "sampling"] as const).map((k) => (
              <div key={k} className="grid grid-cols-1 gap-1 px-5 py-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
                <dt className="text-xs text-faint">{labels[k]}</dt>
                <dd className="text-sm leading-relaxed text-fg">{f[k]}</dd>
              </div>
            ))}
          </motion.dl>
        </AnimatePresence>
      </div>
    </div>
  );
}
