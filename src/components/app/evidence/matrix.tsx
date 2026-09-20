import { ArrowUpLeft, FileUp } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { uploadNewEvidence } from "@/app/[locale]/app/evidence/actions";
import { GapStatusBadge, ItemStatusBadge, OverrideBadge, ResultBadge } from "@/components/app/evidence/badges";
import { Empty, Mono, Table, Td, Th } from "@/components/app/primitives";
import type { EvidenceMatrixRow } from "@/domain/evidence";
import { Link } from "@/i18n/navigation";

/**
 * Contract Evidence Matrix — one row per required criterion, grouped by
 * obligation. SHOW EXCEPTIONS, COLLAPSE CERTAINTY: verified rows stay
 * compact; gaps, missing links and unproven results surface prominently.
 */
export async function EvidenceMatrix({
  rows,
  contractId,
  locale,
  canUpload,
}: {
  rows: EvidenceMatrixRow[];
  contractId: string;
  locale: string;
  canUpload: boolean;
}) {
  const t = await getTranslations("app.evidence.matrix");
  if (!rows.length) return <Empty>{t("empty")}</Empty>;

  const byObligation = new Map<string, EvidenceMatrixRow[]>();
  for (const r of rows) {
    const list = byObligation.get(r.obligation.id) ?? [];
    list.push(r);
    byObligation.set(r.obligation.id, list);
  }

  return (
    <Table className="min-w-[980px]">
      <thead className="bg-fg/2">
        <tr>
          <Th>{t("columns.requirement")}</Th>
          <Th>{t("columns.submitted")}</Th>
          <Th>{t("columns.verification")}</Th>
          <Th>{t("columns.gap")}</Th>
          <Th>{t("columns.next")}</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {[...byObligation.entries()].map(([obId, list]) => {
          const ob = list[0].obligation;
          const verifiedCount = list.filter((r) => r.latestResult === "verified").length;
          return (
            <ObligationRows
              key={obId}
              obTitle={ob.title}
              clauseRef={ob.clauseRef}
              dueContext={ob.dueContext}
              coverage={t("coverage", { verified: verifiedCount, total: list.length })}
              allVerified={verifiedCount === list.length}
              rows={list}
              contractId={contractId}
              locale={locale}
              canUpload={canUpload}
            />
          );
        })}
      </tbody>
    </Table>
  );
}

async function ObligationRows({
  obTitle,
  clauseRef,
  dueContext,
  coverage,
  allVerified,
  rows,
  contractId,
  locale,
  canUpload,
}: {
  obTitle: string;
  clauseRef: string | null;
  dueContext: string | null;
  coverage: string;
  allVerified: boolean;
  rows: EvidenceMatrixRow[];
  contractId: string;
  locale: string;
  canUpload: boolean;
}) {
  const t = await getTranslations("app.evidence.matrix");
  return (
    <>
      <tr className="bg-fg/3">
        <Td colSpan={5} className="py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {clauseRef && <Mono>§ {clauseRef}</Mono>}
            <span className="text-sm font-medium">{obTitle}</span>
            <span className={allVerified ? "text-xs text-verified" : "text-xs text-muted"}>{coverage}</span>
            {dueContext && <span className="text-xs text-faint">· {dueContext}</span>}
          </div>
        </Td>
      </tr>
      {rows.map((r) => {
        const exception =
          r.gap != null ||
          r.latestResult !== "verified" ||
          (r.latestItemStatus != null && r.latestItemStatus !== "verified");
        return (
          <tr key={r.requirement.id} className={`align-top ${exception ? "bg-missing/3" : ""} hover:bg-fg/3`}>
            <Td>
              <div className="flex max-w-[38ch] flex-col gap-0.5">
                <span className="text-sm">{r.requirement.name}</span>
                {r.requirement.required && <span className="text-[11px] text-faint">{t("required")}</span>}
              </div>
            </Td>
            <Td>
              {r.linkedItemCount > 0 ? (
                <span className="flex flex-col items-start gap-1">
                  <Link href={`/app/evidence/${r.latestItemId}`} className="inline-flex items-center gap-1 text-xs text-fg hover:underline">
                    {t("items", { count: r.linkedItemCount })}
                    <ArrowUpLeft size={11} strokeWidth={1.75} aria-hidden className="rtl:-scale-x-100" />
                  </Link>
                  {r.latestItemStatus && r.latestItemStatus !== "verified" && (
                    <ItemStatusBadge status={r.latestItemStatus} />
                  )}
                </span>
              ) : (
                <span className="text-xs text-missing">{t("noneSubmitted")}</span>
              )}
            </Td>
            <Td>
              {r.latestResult ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <ResultBadge result={r.latestResult} />
                  {r.effectiveHuman && <OverrideBadge />}
                </span>
              ) : (
                <span className="text-xs text-faint">{t("notVerified")}</span>
              )}
            </Td>
            <Td>
              {r.gap ? (
                <span className="flex flex-col gap-1">
                  <GapStatusBadge status={r.gap.status} />
                  {r.gap.description && <span className="max-w-[34ch] text-[11px] text-muted">{r.gap.description}</span>}
                </span>
              ) : (
                <span className="text-xs text-faint">—</span>
              )}
            </Td>
            <Td>
              {r.latestItemId && (r.latestResult !== "verified" || (r.latestItemStatus != null && r.latestItemStatus !== "verified")) ? (
                <Link href={`/app/evidence/${r.latestItemId}`} className="inline-flex items-center gap-1 text-xs font-medium text-fg hover:underline">
                  {r.gap ? t("resolveGap") : t("inspect")}
                </Link>
              ) : r.linkedItemCount === 0 && canUpload ? (
                <form action={uploadNewEvidence} className="flex items-center gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="contractId" value={contractId} />
                  <input type="hidden" name="requirementId" value={r.requirement.id} />
                  <input type="hidden" name="obligationId" value={r.requirement.obligationId} />
                  <input
                    type="file"
                    name="file"
                    required
                    aria-label={t("uploadFor", { name: r.requirement.name })}
                    className="block w-44 text-[11px] text-muted file:me-1.5 file:rounded-md file:border file:border-line file:bg-bg file:px-2 file:py-1 file:text-[10px] file:font-medium file:text-fg"
                  />
                  <button type="submit" className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-line bg-elevated px-1.5 text-[11px] font-medium text-fg hover:bg-fg/5">
                    <FileUp size={11} strokeWidth={1.75} aria-hidden />
                    {t("upload")}
                  </button>
                </form>
              ) : (
                <span className="text-xs text-faint">—</span>
              )}
            </Td>
          </tr>
        );
      })}
    </>
  );
}
