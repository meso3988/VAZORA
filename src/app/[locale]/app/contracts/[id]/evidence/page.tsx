import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EVIDENCE_TYPES, EvidenceUpload } from "@/components/app/evidence-upload";
import { requestEvidenceVerification } from "@/app/[locale]/app/evidence/actions";
import { EvidenceMatrix } from "@/components/app/evidence/matrix";
import { Panel, StackedBar } from "@/components/app/primitives";
import { EvidenceTable } from "@/components/app/tables";
import { statusTone, toneDot } from "@/components/ui/status";
import { auth } from "@/data/auth/provider";
import { requireTenant } from "@/data/context";
import { getContractEvidenceMatrix } from "@/data/supabase/evidence-detail";
import { countBy, type EvidenceStatus } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { asLocale } from "@/i18n/params";

const ORDER: EvidenceStatus[] = ["verified", "partial", "rejected", "pending"];

export default async function ContractEvidence(props: PageProps<"/[locale]/app/contracts/[id]/evidence">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const { uploaded, error } = await props.searchParams;
  const t = await getTranslations("app.evidence");
  const st = await getTranslations("status");
  const session = await auth.getSession();
  const isLive = session?.mode === "live";
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const [evidence, obligations, matrix] = await Promise.all([
    db.evidence.list(orgId, { contractId: id }),
    db.obligations.list(orgId, { contractId: id }),
    isLive ? getContractEvidenceMatrix(orgId, id) : Promise.resolve([]),
  ]);
  const by = countBy(evidence, (e) => e.status);
  const tt = await getTranslations("app.evidence.upload.types");
  const typeLabels = Object.fromEntries(EVIDENCE_TYPES.map((k) => [k, tt(k)]));

  return (
    <>
      {uploaded && (
        <p className="rounded-md border border-line bg-elevated px-4 py-3 text-xs text-muted" role="status">
          {t("upload.receivedNotice")}
          {isLive && (
            <Link href={`/app/evidence/${uploaded}`} className="ms-2 font-medium text-fg underline-offset-2 hover:underline">
              {t("matrix.inspect")}
            </Link>
          )}
        </p>
      )}
      {error && (
        <p className="rounded-md border border-missing/40 bg-missing/5 px-4 py-3 text-xs text-missing" role="alert">
          {t("upload.errorNotice")}
        </p>
      )}
      <Panel title={t("byStatus")} tone="sky">
        <div className="p-5">
          <StackedBar segments={ORDER.filter((s) => by[s]).map((s) => ({ key: s, value: by[s] ?? 0, className: toneDot[statusTone[s]], label: st(s) }))} />
        </div>
      </Panel>

      {/* Evidence Matrix — required criteria × submitted × verification × gaps */}
      {isLive && (
        <Panel title={t("matrix.title")} hint={t("matrix.subtitle")} tone="emerald">
          <EvidenceMatrix rows={matrix} contractId={id} locale={locale} canUpload={isLive} />
        </Panel>
      )}

      <EvidenceUpload
        contractId={id}
        locale={locale}
        obligations={obligations}
        canUpload={isLive}
        labels={{
          title: t("upload.title"),
          hint: t("upload.hint"),
          nameField: t("upload.nameField"),
          typeField: t("upload.typeField"),
          obligationField: t("upload.obligationField"),
          noObligation: t("upload.noObligation"),
          submit: t("upload.submit"),
          types: typeLabels,
        }}
      />
      <Panel title={t("title")} hint={t("subtitle")}>
        <EvidenceTable
          evidence={evidence}
          obligations={obligations}
          verifyAction={isLive ? requestEvidenceVerification : undefined}
          detailBasePath={isLive ? "/app/evidence" : undefined}
        />
      </Panel>
    </>
  );
}
