import { cn } from "@/lib/utils";

/**
 * Two inputs converge into one verified point: a pair of strokes descend,
 * meet, and resolve to a single mineral node. The lighter inner stroke is
 * the evidence thread joining the requirement.
 */
export function Mark({ className, size = 24 }: { className?: string; size?: number }) {
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
        d="M3.5 4.5 L12 18.5 L20.5 4.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 4.5 L12 11.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.45"
      />
      <circle cx="12" cy="18.5" r="2.4" className="fill-bg" />
      <circle cx="12" cy="18.5" r="1.7" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={22} />
      {!compact && (
        <span
          className="text-[15px] font-semibold tracking-[0.2em] text-fg"
          style={{ fontFamily: "var(--font-latin)" }}
        >
          VAZORA
        </span>
      )}
    </span>
  );
}
