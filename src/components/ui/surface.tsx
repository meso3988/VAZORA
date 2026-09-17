import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Surface({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-md border border-line bg-elevated", className)}
      {...props}
    />
  );
}

export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("eyebrow", className)} {...props} />;
}

export function ChapterFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className="container-x"><div className={cn("chapter-frame", className)}>{children}</div></div>;
}

export function ChapterLabel({ label }: { label: string }) {
  const parts = label.match(/^(\d{2})\s*\/\s*(.*)$/);
  return (
    <p className="chapter-label m-eyebrow">
      {parts && <><span className="chapter-index" dir="ltr">{parts[1]}</span><span className="sr-only"> / </span></>}
      <span className="chapter-name">{parts ? parts[2] : label}</span>
      <span className="chapter-rule" aria-hidden />
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  align = "start",
  className,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  align?: "start" | "center";
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Tag className="display max-w-[24ch] text-balance text-[1.75rem] sm:text-[2.125rem] lg:text-[2.5rem]">
        {title}
      </Tag>
      {body && <p className="measure text-base leading-relaxed text-muted sm:text-[1.0625rem]">{body}</p>}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "verified" | "partial" | "missing" | "at_risk";
  className?: string;
}) {
  return (
    <Surface className={cn("flex flex-col gap-2 p-4 sm:p-5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      <span
        className={cn(
          "font-mono text-2xl font-medium tabular sm:text-[1.75rem]",
          tone === "verified" && "text-verified",
          tone === "partial" && "text-partial",
          tone === "missing" && "text-missing",
          tone === "at_risk" && "text-at-risk",
        )}
      >
        {value}
      </span>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </Surface>
  );
}

export function DemoBadge({ label, hint }: { label: string; hint?: string }) {
  return (
    <span
      title={hint}
      className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-dashed border-line-strong px-2 text-[11px] font-medium text-muted"
    >
      <span aria-hidden className="size-1.5 rounded-full bg-partial" />
      {label}
    </span>
  );
}
