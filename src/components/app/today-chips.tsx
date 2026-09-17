"use client";

import { useEffect, useState } from "react";
import { CheckCircle, AlertTriangle, UserCheck, FileCheck2, type LucideIcon } from "lucide-react";

import { Mono } from "@/components/app/primitives";

type Stat = { count: number; tone: "amber" | "emerald" | "sky" | "graphite"; key: string };

const ICON: Record<string, LucideIcon> = {
  approvals: CheckCircle,
  actions: AlertTriangle,
  assignments: UserCheck,
  activation: FileCheck2,
};

const ACCENT: Record<Stat["tone"], string> = {
  amber: "from-amber-500 to-amber-300",
  emerald: "from-emerald-600 to-emerald-400",
  sky: "from-sky-500 to-sky-300",
  graphite: "from-neutral-700 to-neutral-500",
};
const VALUE: Record<Stat["tone"], string> = {
  amber: "text-amber-700",
  emerald: "text-emerald-700",
  sky: "text-sky-700",
  graphite: "text-fg",
};
const GLOW: Record<Stat["tone"], string> = {
  amber: "bg-amber-400",
  emerald: "bg-emerald-500",
  sky: "bg-sky-400",
  graphite: "bg-neutral-500",
};

/** Today's operating picture — count chips with a slow counter-roll for a calm, premium feel. */
export function TodayChips({ labels, stats, progress }: { labels: Record<string, string>; stats: Stat[]; progress: number }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.key}
            className="group relative overflow-hidden rounded-2xl border border-line bg-elevated p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-8px_rgba(27,38,31,0.18)]"
          >
            {/* Top accent bar */}
            <span className={`absolute inset-x-0 top-0 h-1 bg-linear-to-r ${ACCENT[stat.tone]}`} />
            {/* Soft corner glow */}
            <span className={`pointer-events-none absolute -inset-inline-end-5 -top-5 h-20 w-20 rounded-full opacity-[0.07] blur-xl ${GLOW[stat.tone]}`} />
            {/* Status icon + label */}
            <div className="flex items-center gap-2">
              {(() => { const Icon = ICON[stat.key]; return Icon ? <Icon size={18} className="shrink-0 text-muted" strokeWidth={1.5} /> : null; })()}
              <span className="text-[11px] font-medium tracking-wide text-muted">{labels[stat.key]}</span>
            </div>
            {/* Animated counter */}
            <Counter value={stat.count} className={`mt-2 block font-mono text-[30px] font-bold tabular leading-none ${VALUE[stat.tone]}`} />
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-medium text-muted">{labels.progressLabel}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/10">
          <div className="h-full rounded-full bg-linear-to-r from-emerald-600 to-emerald-400 transition-[width] duration-700" style={{ width: `${progress}%` }} />
        </div>
        <Mono className="text-xs font-semibold text-fg tabular">{progress}%</Mono>
      </div>
    </div>
  );
}

function Counter({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 700;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(value * (t * (2 - t))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{display}</span>;
}
