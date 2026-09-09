import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type StatusTone = "verified" | "partial" | "missing" | "at_risk" | "pending";

export type StatusKey =
  | "verified"
  | "partial"
  | "missing"
  | "at_risk"
  | "pending"
  | "overdue"
  | "rejected"
  | "open"
  | "mitigating"
  | "closed"
  | "in_progress"
  | "done"
  | "preparing"
  | "ready"
  | "submitted"
  | "approved"
  | "paid"
  | "active"
  | "closeout"
  | "draft";

export const statusTone: Record<StatusKey, StatusTone> = {
  verified: "verified",
  partial: "partial",
  missing: "missing",
  at_risk: "at_risk",
  pending: "pending",
  overdue: "missing",
  rejected: "missing",
  open: "at_risk",
  mitigating: "partial",
  closed: "pending",
  in_progress: "partial",
  done: "verified",
  preparing: "partial",
  ready: "verified",
  submitted: "pending",
  approved: "verified",
  paid: "verified",
  active: "verified",
  closeout: "pending",
  draft: "pending",
};

export const toneDot: Record<StatusTone, string> = {
  verified: "bg-verified",
  partial: "bg-partial",
  missing: "bg-missing",
  at_risk: "bg-at-risk",
  pending: "bg-pending",
};

export const toneText: Record<StatusTone, string> = {
  verified: "text-verified",
  partial: "text-partial",
  missing: "text-missing",
  at_risk: "text-at-risk",
  pending: "text-pending",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", toneDot[tone], className)}
    />
  );
}

export function StatusPill({
  status,
  className,
  subtle,
}: {
  status: StatusKey;
  className?: string;
  subtle?: boolean;
}) {
  const t = useTranslations("status");
  const tone = statusTone[status];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-xs font-medium",
        subtle ? "border-transparent bg-fg/5 text-muted" : "border-line bg-elevated text-fg",
        className,
      )}
    >
      <StatusDot tone={tone} />
      {t(status)}
    </span>
  );
}
