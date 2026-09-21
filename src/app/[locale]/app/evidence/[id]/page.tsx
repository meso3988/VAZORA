import { ArrowLeft, FileUp, Link2, ScanSearch } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import {
  getEvidenceSignedUrl,
  linkEvidenceToRequirement,
  overrideEvidenceCheck,
  requestEvidenceVerification,
  resolveEvidenceDiscrepancy,
  uploadEvidenceVersion,
} from "@/app/[locale]/app/evidence/actions";
import { CheckCard } from "@/components/app/evidence/check-card";
import { DiscrepancyList } from "@/components/app/evidence/discrepancy-list";
import { GapList } from "@/components/app/evidence/gap-list";
import { ItemStatusBadge } from "@/components/app/evidence/badges";
import { ProofChain } from "@/components/app/evidence/proof-chain";
import { VersionHistory } from "@/components/app/evidence/version-history";
import { Empty, Mono, PageHeader, Panel } from "@/components/app/primitives";
import { auth } from "@/data/auth/provider";
import { getEvidenceItemDetail } from "@/data/supabase/evidence-detail";
import { asLocale } from "@/i18n/params";
import { Link } from "@/i18n/navigation";

/**
 * Evidence Inspector — the primary Phase 3 surface.
 * Zone A: what was required · Zone B: what was submitted · Zone C: what it proves.
 * Mobile stacks in spec order: status/gaps → requirement → evidence → checks → history.
 */
export default async function EvidenceInspector(props: PageProps<"/[locale]/app/evidence/[id]">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const { v: versionParam, uploaded, error, discrepancy } = await props.searchParams;
  const t = await getTranslations("app.evidence.inspector");
  const ut = await getTranslations("app.evidence.upload");
  const vt = await getTranslations("app.evidence.versions");
  const gt = await getTranslations("app.evidence.gaps");
  const dt = await getTranslations("app.evidence.discrepancy");
  const session = await auth.getSession();
  const isLive = session?.mode === "live";
  const orgId = session?.organizationId;
  if (!orgId) notFound();

  const detail = await getEvidenceItemDetail(orgId, id);
  if (!detail) notFound();

  const f = await getFormatter();
  const latestVersion = detail.versions[0] ?? null;
  // Historical versions stay independently inspectable — ?v=<n> selects the
  // version and the run that verified it.
  const selectedVersion =
    detail.versions.find((ver) => ver.versionNumber === Number(versionParam)) ?? latestVersion;
  const selectedRun =
    detail.runs.find((r) => r.evidenceVersionId === selectedVersion?.id && r.status === "completed") ??
    detail.runs.find((r) => r.evidenceVersionId === selectedVersion?.id) ??
    null;
  const isHistorical = selectedVersion != null && latestVersion != null && selectedVersion.id !== latestVersion.id;
  const criterionChecks = (selectedRun?.checks ?? []).filter((c) => c.requirementId);
  const openGaps = detail.gaps.filter((g) => g.status !== "resolved" && g.status !== "dismissed_by_authorized_human");
  const linkedIds = new Set(Object.keys(detail.linkVersionByRequirement));
  const unlinked = detail.obligationRequirements.filter((r) => !linkedIds.has(r.id));
  const verifiedCriteria = criterionChecks.filter((c) => (c.humanResult ?? c.result) === "verified").length;
  const totalCriteria = detail.obligationRequirements.length || criterionChecks.length;

  const reqName = (rid: string | null) =>
    detail.requirements.find((r) => r.id === rid)?.name ??
    detail.obligationRequirements.find((r) => r.id === rid)?.name ??
    "—";

  // A gap closed by a check carrying a human override must be attributed as
  // a human decision — never implied as VAZORA verification.
  const overrideClosed = new Set<string>();
  for (const g of detail.gaps) {
    if (!g.closedByRunId || !g.requirementId) continue;
    const run = detail.runs.find((r) => r.id === g.closedByRunId);
    if (run?.checks.some((c) => c.requirementId === g.requirementId && c.humanResult != null)) {
      overrideClosed.add(g.id);
    }
  }

  return (
    <>
      <PageHeader
        meta={
          <Link href={`/app/contracts/${detail.contractId}/evidence`} className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft size={12} strokeWidth={1.75} aria-hidden className="rtl:-scale-x-100" />
            {detail.contractTitle}
          </Link>
        }
        title={detail.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <ItemStatusBadge status={detail.status} />
            {totalCriteria > 0 && (
              <span className="text-xs text-muted">
                {t("criteriaCount", { verified: verifiedCriteria, total: totalCriteria })}
              </span>
            )}
            {openGaps.length > 0 && <span className="text-xs text-at-risk">{gt("openCount", { count: openGaps.length })}</span>}
          </span>
        }
        actions={
          isLive ? (
            <>
              {latestVersion && (
                <form action={getEvidenceSignedUrl}>
                  <input type="hidden" name="versionId" value={latestVersion.id} />
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-elevated px-3 text-xs font-medium text-fg transition-colors hover:bg-fg/5">
                    {t("openFile")}
                  </button>
                </form>
              )}
              <form action={requestEvidenceVerification}>
                <input type="hidden" name="evidenceItemId" value={detail.id} />
                <input type="hidden" name="contractId" value={detail.contractId} />
                <input type="hidden" name="returnTo" value="item" />
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-fg px-3 text-xs font-medium text-bg transition-colors hover:bg-fg/90">
                  <ScanSearch size={13} strokeWidth={1.75} aria-hidden />
                  {t("runVerification")}
                </button>
              </form>
            </>
          ) : undefined
        }
      />

      {typeof uploaded === "string" && uploaded && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {ut("receivedNotice")}
        </p>
      )}
      {typeof error === "string" && error && (
        <p className="rounded-md border border-missing/40 bg-missing/5 px-4 py-3 text-xs text-missing" role="alert">
          {ut("errorNotice")}
        </p>
      )}
      {typeof discrepancy === "string" && discrepancy && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {discrepancy === "kept" ? dt("keptNotice") : dt("regressionNotice")}
        </p>
      )}

      {/* ===== three-zone inspector — mobile order: gaps(2) → A→B→C(3) → history(4) ===== */}
      <div className="grid grid-cols-1 gap-4 max-lg:order-3 lg:grid-cols-3">
        {/* ZONE A — requirement */}
        <Panel title={t("zoneRequirement")} tone="graphite" className="order-2 lg:order-1">
          <div className="flex flex-col gap-3 p-5 text-sm">
            <dl className="flex flex-col gap-2.5">
              <div>
                <dt className="text-[11px] font-medium tracking-wide text-muted">{t("contract")}</dt>
                <dd>{detail.contractTitle}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium tracking-wide text-muted">{t("clause")}</dt>
                <dd>{detail.obligation?.clauseRef ? <Mono>§ {detail.obligation.clauseRef}</Mono> : <span className="text-faint">—</span>}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium tracking-wide text-muted">{t("obligation")}</dt>
                <dd className="flex flex-col gap-0.5">
                  <span>{detail.obligation?.title ?? t("unlinkedObligation")}</span>
                  {detail.obligation?.requirementText && (
                    <span className="text-xs leading-relaxed text-muted">{detail.obligation.requirementText}</span>
                  )}
                </dd>
              </div>
              {detail.obligation?.dueContext && (
                <div>
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("dueContext")}</dt>
                  <dd className="text-xs text-muted">{detail.obligation.dueContext}</dd>
                </div>
              )}
            </dl>

            <div className="border-t border-line pt-3">
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted">{t("requirements")}</h3>
              {detail.obligationRequirements.length ? (
                <ul className="flex flex-col gap-1.5">
                  {detail.obligationRequirements.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-xs">
                      <span aria-hidden className={`size-1.5 rounded-full ${linkedIds.has(r.id) ? "bg-verified" : "bg-faint"}`} />
                      <span className={linkedIds.has(r.id) ? "" : "text-muted"}>{r.name}</span>
                      {r.required && <span className="text-faint">· {t("required")}</span>}
                      {!linkedIds.has(r.id) && <span className="text-faint">· {t("notLinked")}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-faint">{t("noRequirements")}</p>
              )}

              {/* link form — unlinked obligation criteria */}
              {isLive && unlinked.length > 0 && (
                <form action={linkEvidenceToRequirement} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="evidenceItemId" value={detail.id} />
                  <select name="requirementId" required className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 text-xs text-fg" aria-label={t("linkRequirement")}>
                    {unlinked.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                  <button type="submit" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line bg-elevated px-2 text-xs font-medium text-fg hover:bg-fg/5">
                    <Link2 size={12} strokeWidth={1.75} aria-hidden />
                    {t("link")}
                  </button>
                </form>
              )}
            </div>
          </div>
        </Panel>

        {/* ZONE B — submitted evidence */}
        <Panel title={t("zoneSubmitted")} tone="sky" className="order-3 lg:order-2">
          {selectedVersion ? (
            <div className="flex flex-col gap-3 p-5 text-sm">
              {isHistorical && (
                <p className="flex items-center justify-between gap-2 rounded-sm border border-line bg-bg/60 px-3 py-2 text-[11px] text-muted">
                  {vt("viewing", { version: selectedVersion.versionNumber })}
                  <Link href={`/app/evidence/${detail.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
                    {vt("backToCurrent")}
                  </Link>
                </p>
              )}
              <dl className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("file")}</dt>
                  <dd dir="ltr" className="truncate text-right font-mono text-xs">{selectedVersion.fileName}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("version")}</dt>
                  <dd><Mono>v{selectedVersion.versionNumber} / {detail.versions.length}</Mono></dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("type")}</dt>
                  <dd><Mono className="uppercase">{selectedVersion.mimeType}</Mono></dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("size")}</dt>
                  <dd><Mono>{(selectedVersion.fileSize / 1024).toFixed(1)} KB</Mono></dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("uploaded")}</dt>
                  <dd className="text-xs">{f.dateTime(new Date(selectedVersion.uploadedAt), "medium")}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-[11px] font-medium tracking-wide text-muted">{t("uploadedBy")}</dt>
                  <dd><Mono>{selectedVersion.uploadedBy?.slice(0, 8) ?? "—"}</Mono></dd>
                </div>
              </dl>

              {/* upload new version — receipt ≠ verification */}
              {isLive && (
                <form action={uploadEvidenceVersion} className="mt-1 flex flex-col gap-2 border-t border-line pt-3">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="evidenceItemId" value={detail.id} />
                  <label className="text-[11px] font-medium tracking-wide text-muted">{t("newVersion")}</label>
                  <div className="flex items-center gap-2">
                    <input type="file" name="file" required className="block w-full text-xs text-muted file:me-2 file:rounded-md file:border file:border-line file:bg-bg file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-fg" />
                    <button type="submit" className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line bg-elevated px-2 text-xs font-medium text-fg hover:bg-fg/5">
                      <FileUp size={12} strokeWidth={1.75} aria-hidden />
                      {t("upload")}
                    </button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-faint">{t("newVersionHint")}</p>
                </form>
              )}
            </div>
          ) : (
            <Empty>{t("noFile")}</Empty>
          )}
        </Panel>

        {/* ZONE C — verification */}
        <Panel title={t("zoneVerification")} tone="emerald" className="order-4 lg:order-3">
          {criterionChecks.length ? (
            <div className="flex flex-col gap-3 p-4">
              {criterionChecks.map((c) => (
                <CheckCard
                  key={c.id}
                  check={c}
                  locale={locale}
                  contractId={detail.contractId}
                  overrideAction={isLive ? overrideEvidenceCheck : undefined}
                />
              ))}
              {selectedRun && (
                <p className="text-[11px] text-faint">
                  {t("runMeta", { provider: selectedRun.provider ?? "—", model: selectedRun.model ?? "—" })}
                  {" · "}
                  {f.dateTime(new Date(selectedRun.completedAt ?? selectedRun.createdAt), "medium")}
                </p>
              )}
            </div>
          ) : selectedRun?.status === "failed" ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <p className="text-sm text-at-risk">{t("verificationFailed")}</p>
              <p className="max-w-[40ch] text-xs leading-relaxed text-faint">
                {t("verificationFailedHint")}
                {selectedRun.errorCode && <Mono className="ms-1">{selectedRun.errorCode}</Mono>}
              </p>
            </div>
          ) : selectedRun?.status === "queued" || selectedRun?.status === "running" ? (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <p className="text-sm text-muted">{t("verificationInProgress")}</p>
              <p className="max-w-[40ch] text-xs leading-relaxed text-faint">{t("verificationInProgressHint")}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-5 py-8 text-center">
              <p className="text-sm text-muted">{t("pendingVerification")}</p>
              <p className="max-w-[40ch] text-xs leading-relaxed text-faint">{t("pendingHint")}</p>
            </div>
          )}
        </Panel>
      </div>

      {/* ===== verification discrepancies — same-version weakening, human review ===== */}
      {detail.discrepancies.length > 0 && (
        <Panel
          title={dt("title")}
          tone={detail.discrepancies.some((d) => d.status === "pending") ? "amber" : "graphite"}
          className="max-lg:order-2"
        >
          <DiscrepancyList
            discrepancies={detail.discrepancies}
            runs={detail.runs}
            requirementName={reqName}
            evidenceItemId={detail.id}
            resolveAction={isLive ? resolveEvidenceDiscrepancy : undefined}
            locale={locale}
          />
        </Panel>
      )}

      {/* ===== gaps ===== */}
      <Panel title={gt("title")} tone={openGaps.length ? "rose" : "emerald"} className="max-lg:order-2">
        <GapList gaps={detail.gaps} requirementName={reqName} overrideClosed={overrideClosed} />
      </Panel>

      {/* ===== proof chain + version history ===== */}
      <div className="grid grid-cols-1 gap-4 max-lg:order-4 lg:grid-cols-2">
        <Panel title={t("proofChain")} tone="amber">
          <div className="p-4">
            <ProofChain detail={detail} />
          </div>
        </Panel>
        <Panel title={t("versionHistory")} tone="graphite">
          <VersionHistory detail={detail} currentVersion={selectedVersion?.versionNumber} signedUrlAction={isLive ? getEvidenceSignedUrl : undefined} />
        </Panel>
      </div>
    </>
  );
}
