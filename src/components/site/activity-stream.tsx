"use client";

import { motion, useInView } from "motion/react";
import { useTranslations } from "next-intl";
import { useRef } from "react";

import { StatusDot, type StatusTone } from "@/components/ui/status";
import { useReducedMotionSafe } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type Entry = { time: string; text: string; tone: StatusTone };

/** Operational activity stream of the AI Contract Officer — entries arrive in sequence once in view. */
export function ActivityStream({ className }: { className?: string }) {
  const t = useTranslations("home.officer");
  const entries = t.raw("stream") as Entry[];
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -20% 0px" });
  const reduce = useReducedMotionSafe();
  const show = reduce || inView;

  return (
    <div className={cn("relative", className)}>
      <div className="mb-5 flex items-center justify-between font-mono text-[11px] text-faint">
        <span>{t("streamTitle")}</span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-accent [animation:pulse-soft_1.6s_ease-in-out_infinite]" />
          {t("eyebrow")}
        </span>
      </div>
      <ol ref={ref} className="relative flex flex-col">
        <span aria-hidden className="absolute inset-y-2 start-[4.75rem] w-px bg-line-strong sm:start-[5.25rem]" />
        {entries.map((e, i) => {
          const last = i === entries.length - 1;
          return (
            <motion.li
              key={i}
              initial={false}
              animate={{ opacity: show ? 1 : 0, x: show ? 0 : 6 }}
              transition={{ duration: reduce ? 0 : 0.45, delay: reduce ? 0 : 0.25 + i * 0.35, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "relative grid grid-cols-[3.75rem_1.5rem_minmax(0,1fr)] items-start gap-x-3 py-2.5 sm:grid-cols-[4.25rem_1.5rem_minmax(0,1fr)]",
                last && "mt-3 border-t border-line pt-5",
              )}
            >
              <span className="pt-0.5 text-end font-mono text-[11px] tabular text-faint" dir="ltr">
                {e.time}
              </span>
              <span className="flex justify-center pt-1.5">
                <StatusDot tone={e.tone} className="ring-4 ring-bg" />
              </span>
              <span
                className={cn(
                  "text-sm leading-relaxed",
                  e.tone === "missing" && "text-fg",
                  e.tone === "partial" && "text-partial",
                  e.tone === "at_risk" && "text-fg",
                  e.tone === "pending" && "text-muted",
                  e.tone === "verified" && "text-base font-medium text-verified",
                )}
              >
                {e.text}
              </span>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
