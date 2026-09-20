import { Download, FileClock } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { Mono } from "@/components/app/primitives";
import type { EvidenceItemDetail } from "@/domain/evidence";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Version history — every file version with its verification outcome.
 * Each row links to ?v=<n> so historical runs and their checks (including
 * human overrides) stay independently inspectable; nothing is hidden.
 */
export async function VersionHistory({
  detail,
  currentVersion,
  signedUrlAction,
}: {
  detail: EvidenceItemDetail;
  currentVersion?: number;
  signedUrlAction?: (formData: FormData) => void | Promise<void>;
}) {
  const t = await getTranslations("app.evidence.versions");
  const f = await getFormatter();

  // latest run per version (runs arrive newest-first)
  const runByVersion = new Map<string, (typeof detail.runs)[number]>();
  for (const run of detail.runs) {
    if (!runByVersion.has(run.evidenceVersionId)) runByVersion.set(run.evidenceVersionId, run);
  }

  return (
    <ol className="flex flex-col divide-y divide-line">
      {detail.versions.map((v) => {
        const run = runByVersion.get(v.id);
        const isCurrent = v.versionNumber === currentVersion;
        return (
          <li key={v.id} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between", isCurrent && "bg-fg/3")}>
            <Link
              href={`/app/evidence/${detail.id}?v=${v.versionNumber}`}
              className="group flex min-w-0 items-center gap-3 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/30"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-elevated text-muted">
                <FileClock size={14} strokeWidth={1.5} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2 text-sm">
                  <Mono className={isCurrent ? "font-semibold" : undefined}>v{v.versionNumber}</Mono>
                  <span dir="ltr" className="truncate text-muted group-hover:text-fg">{v.fileName}</span>
                  {isCurrent && <span className="text-[10px] text-faint">· {t("current")}</span>}
                </span>
                <span className="text-[11px] text-faint">
                  {f.dateTime(new Date(v.uploadedAt), "medium")}
                  {v.uploadedBy && <> · <Mono>{v.uploadedBy.slice(0, 8)}</Mono></>}
                  {" · "}
                  {(v.fileSize / 1024).toFixed(0)} KB
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-3 ps-11 sm:ps-0">
              {run ? (
                run.status === "failed" ? (
                  <span className="text-xs text-at-risk">
                    {t("verificationFailed")}
                    {run.errorCode && <Mono className="ms-1 text-faint">· {run.errorCode}</Mono>}
                  </span>
                ) : run.status === "queued" || run.status === "running" ? (
                  <span className="text-xs text-muted">{t("verificationInProgress")}</span>
                ) : (
                  <span className="text-xs text-muted">
                    {t("checksVerified", { verified: run.verifiedCount, total: run.checkCount })}
                    <span className="text-faint"> · {run.overall ?? "—"}</span>
                  </span>
                )
              ) : (
                <span className="text-xs text-faint">{t("notVerified")}</span>
              )}
              {signedUrlAction && (
                <form action={signedUrlAction}>
                  <input type="hidden" name="versionId" value={v.id} />
                  <button
                    type="submit"
                    className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-elevated text-muted transition-colors hover:text-fg"
                    aria-label={t("download")}
                    title={t("download")}
                  >
                    <Download size={13} strokeWidth={1.75} />
                  </button>
                </form>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
