import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock,
  Eye,
  FileSearch,
  MinusCircle,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { CheckResult, EvidenceItemStatus, GapStatus } from "@/domain/evidence";
import { cn } from "@/lib/utils";

/**
 * Verification badges — label + icon + tone, never color alone (a11y).
 * Every verification state has its own icon and translated text.
 */

type Tone = "verified" | "partial" | "missing" | "at_risk" | "pending";

const TONE_CLASS: Record<Tone, string> = {
  verified: "text-verified",
  partial: "text-partial",
  missing: "text-missing",
  at_risk: "text-at-risk",
  pending: "text-pending",
};

type ResultKey = "verified" | "partial" | "missing" | "notFound" | "notApplicable" | "needsHumanReview" | "unableToVerify";
const RESULT_META: Record<CheckResult, { tone: Tone; icon: typeof CheckCircle2; key: ResultKey }> = {
  verified: { tone: "verified", icon: CheckCircle2, key: "verified" },
  partial: { tone: "partial", icon: CircleDot, key: "partial" },
  missing: { tone: "missing", icon: XCircle, key: "missing" },
  not_found: { tone: "missing", icon: XCircle, key: "notFound" },
  not_applicable: { tone: "pending", icon: MinusCircle, key: "notApplicable" },
  needs_human_review: { tone: "at_risk", icon: Eye, key: "needsHumanReview" },
  unable_to_verify: { tone: "pending", icon: AlertTriangle, key: "unableToVerify" },
};

/** Per-criterion result badge. */
export function ResultBadge({ result, className }: { result: CheckResult; className?: string }) {
  const t = useTranslations("app.evidence.result");
  const meta = RESULT_META[result] ?? RESULT_META.unable_to_verify;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_CLASS[meta.tone], className)}>
      <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
      {t(meta.key)}
    </span>
  );
}

type ItemKey = "received" | "verificationPending" | "partiallyVerified" | "verified" | "needsReview" | "ocrRequired" | "rejected";
const ITEM_META: Record<EvidenceItemStatus, { tone: Tone; icon: typeof CheckCircle2; key: ItemKey }> = {
  received: { tone: "pending", icon: Clock, key: "received" },
  verification_pending: { tone: "partial", icon: RefreshCw, key: "verificationPending" },
  partially_verified: { tone: "partial", icon: CircleDot, key: "partiallyVerified" },
  verified: { tone: "verified", icon: ShieldCheck, key: "verified" },
  needs_review: { tone: "at_risk", icon: Eye, key: "needsReview" },
  ocr_required: { tone: "at_risk", icon: FileSearch, key: "ocrRequired" },
  rejected: { tone: "missing", icon: XCircle, key: "rejected" },
};

/** Evidence item overall status badge. */
export function ItemStatusBadge({ status, className }: { status: EvidenceItemStatus; className?: string }) {
  const t = useTranslations("app.evidence.itemStatus");
  const meta = ITEM_META[status] ?? ITEM_META.received;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_CLASS[meta.tone], className)}>
      <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
      {t(meta.key)}
    </span>
  );
}

type GapKey = "open" | "evidenceReceived" | "reverificationPending" | "resolved" | "dismissed";
const GAP_META: Record<GapStatus, { tone: Tone; icon: typeof CheckCircle2; key: GapKey }> = {
  open: { tone: "at_risk", icon: XCircle, key: "open" },
  evidence_received: { tone: "partial", icon: Clock, key: "evidenceReceived" },
  reverification_pending: { tone: "partial", icon: RefreshCw, key: "reverificationPending" },
  resolved: { tone: "verified", icon: CheckCircle2, key: "resolved" },
  dismissed_by_authorized_human: { tone: "pending", icon: UserCheck, key: "dismissed" },
};

/** Gap lifecycle badge — states are named explicitly, never OPEN→RESOLVED jumps. */
export function GapStatusBadge({ status, className }: { status: GapStatus; className?: string }) {
  const t = useTranslations("app.evidence.gapStatus");
  const meta = GAP_META[status] ?? GAP_META.open;
  const Icon = meta.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", TONE_CLASS[meta.tone], className)}>
      <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
      {t(meta.key)}
    </span>
  );
}

/** Distinct human-override marker — visually separated from VAZORA results. */
export function OverrideBadge({ className }: { className?: string }) {
  const t = useTranslations("app.evidence");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-sky-800/40 bg-sky-800/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300",
        className,
      )}
    >
      <UserCheck size={12} strokeWidth={2} aria-hidden />
      {t("humanOverride")}
    </span>
  );
}
