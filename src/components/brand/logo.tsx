import { cn } from "@/lib/utils";

/** Converging strokes forming a V, with a signal node where they meet. */
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
        d="M3 5 L12 19 L21 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M7.5 5 L12 12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
      <circle cx="12" cy="19" r="2" className="fill-accent" />
    </svg>
  );
}

export function Wordmark({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={22} />
      {!compact && (
        <span
          className="font-sans text-[15px] font-semibold tracking-[0.18em] text-fg"
          style={{ fontFamily: "var(--font-latin)" }}
        >
          VAZORA
        </span>
      )}
    </span>
  );
}
