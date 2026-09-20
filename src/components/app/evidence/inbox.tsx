import { ArrowUpLeft } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { ItemStatusBadge } from "@/components/app/evidence/badges";
import { Empty, Mono } from "@/components/app/primitives";
import type { EvidenceInboxRow, InboxCategory } from "@/domain/evidence";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Inbox category derived from live state — exceptions first. */
function categoryOf(row: EvidenceInboxRow): InboxCategory {
  if (row.unlinkedCount > 0 || !row.obligationTitle) return "needs_linking";
  switch (row.status) {
    case "verification_pending":
      return "reverification_pending";
    case "partially_verified":
      return "partial";
    case "rejected":
      return "missing";
    case "needs_review":
    case "ocr_required":
      return "needs_human_review";
    case "verified":
      return "verified";
    default:
      return "needs_verification"; // received / never run
  }
}

const CATEGORY_ORDER: InboxCategory[] = [
  "needs_linking",
  "needs_human_review",
  "reverification_pending",
  "partial",
  "missing",
  "needs_verification",
  "recent",
  "verified",
];

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const isRecent = (r: EvidenceInboxRow) => Date.now() - Date.parse(r.uploadedAt) < RECENT_MS;

const CATEGORY_RANK: Record<InboxCategory, number> = {
  needs_human_review: 0,
  needs_linking: 1,
  reverification_pending: 2,
  partial: 3,
  missing: 4,
  needs_verification: 5,
  recent: 6,
  verified: 7,
  all: 8,
};

/**
 * Evidence Inbox — an operational queue, not a file list. Each row answers:
 * what is this, for which obligation, what is wrong, who uploaded it, and
 * what should happen next.
 */
export async function EvidenceInbox({
  rows,
  active,
  contracts,
  activeContract,
}: {
  rows: EvidenceInboxRow[];
  active: InboxCategory;
  contracts: { id: string; title: string }[];
  activeContract: string | null;
}) {
  const t = await getTranslations("app.evidence.inbox");
  const f = await getFormatter();
  const locale = await getLocale();

  const scoped = activeContract ? rows.filter((r) => r.contractId === activeContract) : rows;
  const counts = new Map<InboxCategory, number>();
  for (const r of scoped) {
    const c = categoryOf(r);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const recentCount = scoped.filter(isRecent).length;

  const filtered = (
    active === "all" ? scoped
    : active === "recent" ? scoped.filter(isRecent)
    : scoped.filter((r) => categoryOf(r) === active)
  )
    .slice()
    .sort((a, b) => CATEGORY_RANK[categoryOf(a)] - CATEGORY_RANK[categoryOf(b)] || b.uploadedAt.localeCompare(a.uploadedAt));

  const chipHref = (c: InboxCategory | "all") =>
    `/app/evidence?${new URLSearchParams({ ...(c === "all" ? {} : { c }), ...(activeContract ? { contract: activeContract } : {}) })}`;

  const nextFor = (r: EvidenceInboxRow): string => {
    const c = categoryOf(r);
    switch (c) {
      case "needs_linking": return t("next.link");
      case "needs_verification": return t("next.verify");
      case "reverification_pending": return t("next.waitRun");
      case "partial":
      case "missing": return r.openGapCount ? t("next.resolveGap", { count: r.openGapCount }) : t("next.inspect");
      case "needs_human_review": return t("next.review");
      default: return t("next.inspect");
    }
  };

  return (
    <div className="flex flex-col">
      {/* category + contract filters */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3" role="navigation" aria-label={t("filters")}>
        <FilterChip href={chipHref("all")} label={t("cat.all", { count: scoped.length })} active={active === "all"} />
        {CATEGORY_ORDER.map((c) => (
          <FilterChip
            key={c}
            href={chipHref(c)}
            label={t(`cat.${c}` as `cat.${InboxCategory}`, { count: c === "recent" ? recentCount : (counts.get(c) ?? 0) })}
            active={active === c}
          />
        ))}
        {contracts.length > 1 && (
          <form action={`/${locale}/app/evidence`} method="get" className="ms-auto flex items-center gap-1.5">
            {active !== "all" && <input type="hidden" name="c" value={active} />}
            <select
              name="contract"
              defaultValue={activeContract ?? ""}
              aria-label={t("contractFilter")}
              className="h-7 max-w-44 rounded-md border border-line bg-bg px-2 text-[11px] text-fg"
            >
              <option value="">{t("allContracts")}</option>
              {contracts.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <button type="submit" className="inline-flex h-7 items-center rounded-full border border-line bg-bg px-3 text-xs font-medium text-muted transition-colors hover:text-fg">
              {t("apply")}
            </button>
          </form>
        )}
      </div>

      {/* rows */}
      {filtered.length === 0 ? (
        <Empty>{t("emptyCategory")}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {filtered.map((r) => {
            return (
              <li key={r.itemId}>
                <Link
                  href={`/app/evidence/${r.itemId}`}
                  className="flex flex-col gap-2 px-5 py-3.5 transition-colors hover:bg-fg/3 focus:outline-none focus-visible:bg-fg/5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ItemStatusBadge status={r.status} />
                      <span className="truncate text-sm font-medium">{r.title}</span>
                      {r.openGapCount > 0 && (
                        <span className="rounded-sm bg-missing/10 px-1.5 py-0.5 text-[10px] font-medium text-missing">
                          {t("gaps", { count: r.openGapCount })}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span dir="ltr" className="font-mono">{r.fileName}</span>
                      <span>· {r.contractTitle}</span>
                      {r.obligationTitle && <span>· {r.obligationTitle}</span>}
                      <span>· <Mono>v{r.version}</Mono></span>
                      {r.uploadedBy && <span>· {t("uploadedBy")} <Mono>{r.uploadedBy.slice(0, 8)}</Mono></span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 ps-0 sm:ps-4">
                    <div className="flex flex-col items-start gap-0.5 sm:items-end">
                      <span className="text-[11px] text-faint">
                        {f.dateTime(new Date(r.uploadedAt), "medium")}
                      </span>
                      <span className="text-xs font-medium text-fg">{nextFor(r)}</span>
                    </div>
                    <ArrowUpLeft size={14} strokeWidth={1.75} aria-hidden className="text-faint rtl:-scale-x-100" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-3 text-xs font-medium transition-colors",
        active ? "border-fg/40 bg-fg/10 text-fg" : "border-line bg-bg text-muted hover:text-fg",
      )}
      aria-current={active ? "true" : undefined}
    >
      {label}
    </Link>
  );
}
