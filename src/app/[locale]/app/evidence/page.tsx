import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { uploadNewEvidence } from "@/app/[locale]/app/evidence/actions";
import { EvidenceInbox } from "@/components/app/evidence/inbox";
import { EVIDENCE_TYPES } from "@/components/app/evidence-upload";
import { PageHeader, Panel, StackedBar } from "@/components/app/primitives";
import { statusTone, toneDot } from "@/components/ui/status";
import { auth } from "@/data/auth/provider";
import { requireTenant } from "@/data/context";
import { listEvidenceInbox } from "@/data/supabase/evidence-detail";
import type { InboxCategory } from "@/domain/evidence";
import { countBy, type EvidenceStatus } from "@/domain/types";
import { asLocale } from "@/i18n/params";

const ORDER: EvidenceStatus[] = ["verified", "partial", "rejected", "pending"];
const INBOX_CATEGORIES: InboxCategory[] = [
  "needs_linking", "needs_verification", "needs_human_review", "partial",
  "missing", "reverification_pending", "verified", "all",
];

export async function generateMetadata(props: PageProps<"/[locale]/app/evidence">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.evidence" });
  return { title: t("title") };
}

export default async function EvidencePage(props: PageProps<"/[locale]/app/evidence">) {
  const { locale: rawLocale } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const { c, contract } = await props.searchParams;
  const t = await getTranslations("app.evidence");
  const st = await getTranslations("status");
  const session = await auth.getSession();
  const isLive = session?.mode === "live";
  const { orgId, db } = await requireTenant();
  const [evidence, inbox, contracts] = await Promise.all([
    db.evidence.list(orgId),
    isLive ? listEvidenceInbox(orgId) : Promise.resolve([]),
    isLive ? db.contracts.list(orgId) : Promise.resolve([]),
  ]);
  const by = countBy(evidence, (e) => e.status);
  const active: InboxCategory = INBOX_CATEGORIES.includes(c as InboxCategory) ? (c as InboxCategory) : "all";
  const contractParam = typeof contract === "string" ? contract : null;
  const activeContract = contracts.some((x) => x.id === contractParam) ? contractParam : null;
  const tt = await getTranslations("app.evidence.upload.types");
  const typeLabels = Object.fromEntries(EVIDENCE_TYPES.map((k) => [k, tt(k)]));

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Panel title={t("byStatus")} tone="sky">
        <div className="p-5">
          <StackedBar segments={ORDER.filter((s) => by[s]).map((s) => ({ key: s, value: by[s] ?? 0, className: toneDot[statusTone[s]], label: st(s) }))} />
        </div>
      </Panel>

      {isLive && contracts.length > 0 && (
        <Panel title={t("upload.title")} hint={t("upload.globalHint")} tone="graphite">
          <form action={uploadNewEvidence} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            <input type="hidden" name="locale" value={locale} />
            <select name="contractId" required className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg" aria-label={t("upload.contractField")}>
              {contracts.map((c2) => (
                <option key={c2.id} value={c2.id}>{c2.title.en}</option>
              ))}
            </select>
            <input name="title" required maxLength={200} placeholder={t("upload.nameField")} className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg placeholder:text-faint" />
            <select name="evidenceType" defaultValue="document" className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg" aria-label={t("upload.typeField")}>
              {EVIDENCE_TYPES.map((k) => (
                <option key={k} value={k}>{typeLabels[k] ?? k}</option>
              ))}
            </select>
            <div className="flex items-center gap-3">
              <input type="file" name="file" required className="block w-full text-xs text-muted file:me-3 file:rounded-md file:border file:border-line file:bg-bg file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg" />
              <button type="submit" className="inline-flex h-8 shrink-0 items-center rounded-sm border border-line bg-fg px-3 text-xs font-medium text-bg hover:bg-fg/90">
                {t("upload.submit")}
              </button>
            </div>
          </form>
        </Panel>
      )}

      <Panel title={t("inbox.title")} hint={t("inbox.subtitle")}>
        {isLive ? (
          <EvidenceInbox
            rows={inbox}
            active={active}
            activeContract={activeContract}
            contracts={contracts.map((x) => ({ id: x.id, title: x.title[locale] ?? x.title.en }))}
          />
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">{t("inbox.liveOnly")}</p>
        )}
      </Panel>
    </>
  );
}
