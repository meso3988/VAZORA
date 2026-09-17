import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

type Tone = "verified" | "partial" | "missing" | "at_risk";

const TONE_HEX: Record<Tone, string> = {
  verified: "#0b7455",
  partial: "#d4a24a",
  missing: "#ad493b",
  at_risk: "#c2603e",
};
const TONE_TEXT: Record<Tone, string> = {
  verified: "text-verified",
  partial: "text-partial",
  missing: "text-missing",
  at_risk: "text-at-risk",
};

/** Radial gauge — large number with an arc fill. */
export function KpiGauge({
  label,
  value,
  display,
  max = 100,
  tone = "verified",
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  display: ReactNode;
  max?: number;
  tone?: Tone;
  hint?: ReactNode;
  icon?: LucideIcon;
}) {
  const pct = Math.min(1, value / max);
  const r = 36;
  const c = 2 * Math.PI * r;
  const size = 88;
  return (
    <Surface className={cn("app-kpi kpi-gauge kpi-", tone, "relative flex items-center gap-4 overflow-hidden rounded-2xl px-5 py-4")}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={5} className="text-line" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={TONE_HEX[tone]}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className={cn("font-mono text-lg font-bold tabular", TONE_TEXT[tone])}>{display}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={17} className="shrink-0 text-muted" strokeWidth={1.5} />}
          <span className="text-[11px] font-medium tracking-wide text-muted">{label}</span>
        </div>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
    </Surface>
  );
}

/** Vertical bar chart — segmented bars showing magnitude. */
export function KpiBars({
  label,
  value,
  display,
  segments = 5,
  tone = "verified",
  hint,
  icon: Icon,
}: {
  label: string;
  value: number;
  display: ReactNode;
  segments?: number;
  tone?: Tone;
  hint?: ReactNode;
  icon?: LucideIcon;
}) {
  const filled = Math.round((value / 100) * segments);
  return (
    <Surface className={cn("app-kpi kpi-", tone, "relative flex flex-col gap-3 overflow-hidden rounded-2xl px-5 py-4")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={17} className="shrink-0 text-muted" strokeWidth={1.5} />}
          <span className="text-[11px] font-medium tracking-wide text-muted">{label}</span>
        </div>
        {hint && <span className="text-[10px] text-faint">{hint}</span>}
      </div>
      <div className="flex items-end justify-between gap-1.5" style={{ height: 44 }}>
        {Array.from({ length: segments }).map((_, i) => {
          const active = i < filled;
          const h = 20 + (i / segments) * 24;
          return (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all duration-500"
              style={{
                height: `${h}px`,
                background: active ? TONE_HEX[tone] : "rgba(27,38,31,0.08)",
                opacity: active ? 1 : 0.5,
                transitionDelay: `${i * 60}ms`,
              }}
            />
          );
        })}
      </div>
      <span className={cn("font-mono text-2xl font-bold tabular leading-none", TONE_TEXT[tone])}>{display}</span>
    </Surface>
  );
}

/** Sparkline trend — line chart with area fill. */
export function KpiTrend({
  label,
  display,
  points,
  tone = "verified",
  hint,
  icon: Icon,
}: {
  label: string;
  display: ReactNode;
  points: number[];
  tone?: Tone;
  hint?: ReactNode;
  icon?: LucideIcon;
}) {
  const w = 120;
  const h = 40;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const coords = points.map((p, i) => [i * step, h - ((p - min) / range) * (h - 6) - 3]);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = points[points.length - 1];
  const prev = points[points.length - 2] ?? last;
  const up = last >= prev;
  return (
    <Surface className={cn("app-kpi kpi-", tone, "relative flex flex-col gap-2 overflow-hidden rounded-2xl px-5 py-4")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={17} className="shrink-0 text-muted" strokeWidth={1.5} />}
          <span className="text-[11px] font-medium tracking-wide text-muted">{label}</span>
        </div>
        <span className={cn("text-[10px] font-semibold tabular", up ? "text-verified" : "text-missing")}>
          {up ? "▲" : "▼"} {hint}
        </span>
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="self-stretch" aria-hidden preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${tone}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={TONE_HEX[tone]} stopOpacity={0.25} />
            <stop offset="100%" stopColor={TONE_HEX[tone]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#grad-${tone})`} />
        <path d={line} fill="none" stroke={TONE_HEX[tone]} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r={3} fill={TONE_HEX[tone]} />
      </svg>
      <span className={cn("font-mono text-2xl font-bold tabular leading-none", TONE_TEXT[tone])}>{display}</span>
    </Surface>
  );
}

/** Big number — hero metric with accent ring. */
export function KpiHero({
  label,
  display,
  tone = "at_risk",
  hint,
  icon: Icon,
}: {
  label: string;
  display: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Surface className={cn("app-kpi kpi-", tone, "relative flex flex-col gap-2 overflow-hidden rounded-2xl px-5 py-5")}>
      <span
        className="pointer-events-none absolute -inset-e-8 -top-10 h-32 w-32 rounded-full opacity-[0.08] blur-2xl"
        style={{ background: TONE_HEX[tone] }}
      />
      <div className="flex items-center gap-2">
        {Icon ? <Icon size={19} className="shrink-0 text-muted" strokeWidth={1.5} /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONE_HEX[tone], boxShadow: `0 0 10px ${TONE_HEX[tone]}66` }} />}
        <span className="text-[11px] font-medium tracking-wide text-muted">{label}</span>
      </div>
      <span className={cn("font-mono text-[34px] font-bold tabular leading-none", TONE_TEXT[tone])}>{display}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </Surface>
  );
}

/** Pill stat — compact inline metric for secondary KPIs. */
export function KpiPill({
  label,
  display,
  tone = "verified",
}: {
  label: string;
  display: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      className={cn("flex items-center gap-2.5 rounded-full border px-4 py-2", tone === "verified" ? "border-verified/30 bg-verified/5" : tone === "partial" ? "border-partial/30 bg-partial/5" : tone === "missing" ? "border-missing/30 bg-missing/5" : "border-at-risk/30 bg-at-risk/5")}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: TONE_HEX[tone] }} />
      <span className="text-[11px] font-medium text-muted">{label}</span>
      <span className={cn("font-mono text-sm font-bold tabular", TONE_TEXT[tone])}>{display}</span>
    </div>
  );
}
