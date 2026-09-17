import type { ComponentProps } from "react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "inverse" | "luxury";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2.5 whitespace-nowrap font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none active:scale-[0.98]";

const variants: Record<Variant, string> = {
  primary:
    "relative overflow-hidden rounded-[4px] bg-gradient-to-b from-[#0e8a64] to-[#085a41] text-[#f4f7f4] font-medium tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_16px_-2px_rgba(11,116,85,0.45)] hover:from-[#119d72] hover:to-[#0a684b] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_22px_-2px_rgba(11,116,85,0.6)] border border-[#1b9a71]/40",
  secondary:
    "rounded-[4px] border border-line-strong bg-elevated/60 text-fg backdrop-blur-sm hover:border-fg/40 hover:bg-elevated shadow-sm",
  ghost:
    "rounded-[4px] text-muted hover:text-fg hover:bg-fg/5",
  inverse:
    "rounded-[4px] bg-fg text-bg hover:opacity-90 shadow-sm",
  luxury:
    "relative overflow-hidden rounded-[4px] bg-gradient-to-r from-[#17251e] to-[#21352a] text-[#e8eee9] border border-[#3e5a49]/60 hover:border-[#65c59a]/60 hover:text-white shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)]",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-xs",
  md: "h-11 px-6 text-[13.5px]",
  lg: "h-12 px-7 text-[15px]",
};

type Common = { variant?: Variant; size?: Size; className?: string };

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: Common & ComponentProps<"button">) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: Common & ComponentProps<typeof Link>) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
