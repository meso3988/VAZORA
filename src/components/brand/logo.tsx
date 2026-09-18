import { cn } from "@/lib/utils";

/**
 * Two inputs converge into one verified point: a pair of strokes descend,
 * meet, and resolve to a single mineral node. The lighter inner stroke is
 * the evidence thread joining the requirement.
 */
export function Mark({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <path
        d="M4 4.5 L11.2 17.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 4.5 L12.8 17.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.65"
      />
      <circle cx="12" cy="18.5" r="2.4" className="fill-bg" />
      <circle cx="12" cy="18.5" r="1.7" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({
  className,
  compact,
  sculpted = false,
}: {
  className?: string;
  compact?: boolean;
  sculpted?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {(!sculpted || compact) && <Mark size={22} />}
      {!compact && (sculpted ? <><BrandLettering className="vazora-wordmark" /><span className="sr-only">VAZORA</span></> : (
        <span
          className="text-[15px] font-semibold tracking-[0.2em] text-fg"
          style={{ fontFamily: "var(--font-latin)" }}
        >
          VAZORA
        </span>
      ))}
    </span>
  );
}

export function BrandLettering({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 324 56" fill="none" className={className} aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="5.5" strokeLinejoin="miter">
        <path d="m4 6 19 42h3L45 6M60 48 79 6h3l19 42M67 34h27M116 6h36l-35 42h36M193 6h-9c-11 0-15 8-15 21s4 21 15 21h9c11 0 15-8 15-21s-4-21-15-21ZM226 48V6h17c10 0 14 4 14 12s-5 13-14 13h-17m15 0 18 17M276 48l19-42h3l19 42m-33-14h27" />
      </g>
    </svg>
  );
}
