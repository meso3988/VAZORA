import { FileText, FileCheck, ListChecks, FileUp, ScanSearch, GitBranch, Flag } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { GapStatusBadge, ResultBadge } from "@/components/app/evidence/badges";
import { Mono } from "@/components/app/primitives";
import type { EvidenceItemDetail } from "@/domain/evidence";
import { Link } from "@/i18n/navigation";

/**
 * Proof Chain — "why did VAZORA reach this result?"
 * Original clause → approved obligation → evidence requirement → evidence
 * version → verification run → result → gap. Every step is inspectable.
 */
export async function ProofChain({ detail }: { detail: EvidenceItemDetail }) {
  const t = await getTranslations("app.evidence.chain");
  const f = await getFormatter();
  const latestRun = detail.runs[0] ?? null;
  const latestVersion = detail.versions[0] ?? null;

  const steps: {
    icon: typeof FileText;
    title: string;
    body: React.ReactNode;
    href?: string;
  }[] = [
    {
      icon: FileText,
      title: t("clause"),
      body: detail.obligation?.clauseRef ? (
        <span className="flex flex-col gap-0.5">
          <Mono>§ {detail.obligation.clauseRef}</Mono>
          {detail.obligation.clausePage != null && <span className="text-xs text-muted">{t("page", { page: detail.obligation.clausePage })}</span>}
          {detail.obligation.clauseText && <span className="line-clamp-2 text-xs text-muted">{detail.obligation.clauseText}</span>}
        </span>
      ) : (
        <span className="text-xs text-faint">{t("noClause")}</span>
      ),
      href: `/app/contracts/${detail.contractId}/obligations`,
    },
    {
      icon: FileCheck,
      title: t("obligation"),
      body: detail.obligation ? (
        <span className="flex flex-col gap-0.5">
          <span className="text-sm">{detail.obligation.title}</span>
          <span className="line-clamp-2 text-xs text-muted">{detail.obligation.requirementText}</span>
        </span>
      ) : (
        <span className="text-xs text-faint">{t("noObligation")}</span>
      ),
      href: `/app/contracts/${detail.contractId}/obligations`,
    },
    {
      icon: ListChecks,
      title: t("requirements"),
      body: detail.requirements.length ? (
        <ul className="flex flex-col gap-1">
          {detail.requirements.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden className="size-1 rounded-full bg-fg/40" />
              {r.name}
              {r.required && <span className="text-faint">· {t("required")}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-faint">{t("noRequirements")}</span>
      ),
    },
    {
      icon: FileUp,
      title: t("version"),
      body: latestVersion ? (
        <span className="flex flex-col gap-0.5">
          <span className="text-sm">
            <Mono className="me-1.5">v{latestVersion.versionNumber}</Mono>
            <span dir="ltr">{latestVersion.fileName}</span>
          </span>
          <span className="text-xs text-muted">{f.dateTime(new Date(latestVersion.uploadedAt), "medium")}</span>
        </span>
      ) : (
        <span className="text-xs text-faint">{t("noVersion")}</span>
      ),
    },
    {
      icon: ScanSearch,
      title: t("verification"),
      body: latestRun ? (
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">
            {t("run", { count: detail.runs.length })}
            {latestRun.status === "completed" && (
              <> · <Mono>{latestRun.model ?? latestRun.provider ?? "—"}</Mono></>
            )}
          </span>
          {latestRun.status === "completed" ? (
            <span className="text-xs text-muted">
              {t("checks", { verified: latestRun.verifiedCount, total: latestRun.checkCount })}
            </span>
          ) : latestRun.status === "failed" ? (
            <span className="text-xs text-at-risk">{t("runStatus.failed")}</span>
          ) : (
            <span className="text-xs text-muted">
              {t(latestRun.status === "queued" ? "runStatus.queued" : "runStatus.running")}
            </span>
          )}
        </span>
      ) : (
        <span className="text-xs text-faint">{t("noRun")}</span>
      ),
    },
    {
      icon: GitBranch,
      title: t("result"),
      body: latestRun ? (
        <ul className="flex flex-col gap-1">
          {latestRun.checks.filter((c) => c.requirementId).map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-xs">
              <ResultBadge result={c.result} />
              <span className="text-muted">{c.checkLabel}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-faint">{t("noResult")}</span>
      ),
    },
    {
      icon: Flag,
      title: t("gaps"),
      body: detail.gaps.length ? (
        <ul className="flex flex-col gap-1">
          {detail.gaps.slice(0, 4).map((g) => (
            <li key={g.id} className="flex items-center gap-2 text-xs">
              <GapStatusBadge status={g.status} />
              <span className="text-muted">{g.description ?? g.gapType}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-xs text-verified">{t("noGaps")}</span>
      ),
    },
  ];

  return (
    <ol className="relative flex flex-col gap-0" aria-label={t("title")}>
      {steps.map((s, i) => {
        const Icon = s.icon;
        const content = (
          <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-md px-3 py-2 transition-colors group-hover:bg-fg/3">
            <span className="text-[11px] font-medium tracking-wide text-muted">{s.title}</span>
            {s.body}
          </div>
        );
        return (
          <li key={s.title} className="relative flex gap-3">
            <div className="flex flex-col items-center">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-elevated text-muted">
                <Icon size={13} strokeWidth={1.75} aria-hidden />
              </span>
              {i < steps.length - 1 && <span aria-hidden className="w-px flex-1 bg-line" />}
            </div>
            {s.href ? (
              <Link href={s.href} className="group mb-2 flex min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/30 rounded-md">
                {content}
              </Link>
            ) : (
              <div className="mb-2 flex min-w-0 flex-1">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
