import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  meta,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {meta && <div className="text-xs text-muted">{meta}</div>}
        <h1 className="display truncate text-2xl font-medium sm:text-3xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  hint,
  action,
  tone = "graphite",
  icon: Icon,
  className,
  children,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  tone?: "graphite" | "amber" | "emerald" | "sky" | "rose";
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  const headerTone = TONE_HEADER[tone];
  const badgeTone = TONE_BADGE[tone];
  return (
    <Surface className={cn("app-panel flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <div className={cn("panel-header-tonal flex items-start justify-between gap-4 rounded-t-md border-b border-line px-5 py-3", headerTone)}>
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && (
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                {Icon && <Icon size={18} className="shrink-0 opacity-80" strokeWidth={1.5} />}
                {title}
              </h2>
            )}
            {hint && <p className={cn("text-xs", badgeTone)}>{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Surface>
  );
}

const TONE_HEADER: Record<string, string> = {
  graphite: "bg-neutral-800 text-neutral-50",
  amber: "bg-amber-800 text-amber-50",
  emerald: "bg-emerald-800 text-emerald-50",
  sky: "bg-sky-800 text-sky-50",
  rose: "bg-rose-800 text-rose-50",
};
const TONE_BADGE: Record<string, string> = {
  graphite: "text-neutral-200/80",
  amber: "text-amber-100/80",
  emerald: "text-emerald-100/80",
  sky: "text-sky-100/80",
  rose: "text-rose-100/80",
};

/** RTL-safe table wrapper: `text-start` on cells follows document direction. */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full min-w-[640px] text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn("whitespace-nowrap px-4 py-2.5 text-start text-[11px] font-medium text-muted first:ps-5 last:pe-5", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle first:ps-5 last:pe-5", className)} {...props} />;
}

export function Mono({ className, ...props }: ComponentProps<"span">) {
  return <span dir="ltr" className={cn("font-mono text-xs tabular", className)} {...props} />;
}

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "verified" | "partial" | "missing" | "at_risk";
}) {
  const dotClass = tone ? `kpi-dot kpi-dot-${tone}` : "kpi-dot kpi-dot-neutral";
  return (
    <Surface className={cn("app-kpi flex flex-col gap-2 px-5 py-4", tone && `kpi-${tone}`)}>
      <div className="flex items-center gap-2">
        <span className={dotClass} />
        <span className="text-[11px] font-medium tracking-wide text-muted">{label}</span>
      </div>
      <span
        className={cn(
          "kpi-value font-mono text-[28px] tabular leading-none",
          tone === "verified" && "text-verified",
          tone === "partial" && "text-partial",
          tone === "missing" && "text-missing",
          tone === "at_risk" && "text-at-risk",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </Surface>
  );
}

export function Ring({
  value,
  size = 72,
  stroke = 6,
  className,
  children,
}: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  className?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = value >= 0.9 ? "text-verified" : value >= 0.6 ? "text-partial" : "text-missing";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-line" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          className={tone}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-medium tabular">
        {children ?? `${Math.round(value * 100)}%`}
      </span>
    </span>
  );
}

/** Horizontal stacked bar for status distributions; order is logical, so it mirrors correctly in RTL. */
export function StackedBar({
  segments,
  className,
}: {
  segments: { key: string; value: number; className: string; label: string }[];
  className?: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
        {segments.filter((s) => s.value > 0).map((s) => (
          <span key={s.key} className={s.className} style={{ width: `${(s.value / total) * 100}%` }} title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", s.className)} />
            {s.label}
            <span className="font-mono tabular text-fg">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted">{children}</p>;
}
