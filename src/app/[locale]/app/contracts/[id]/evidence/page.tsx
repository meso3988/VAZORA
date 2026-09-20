import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EVIDENCE_TYPES, EvidenceUpload } from "@/components/app/evidence-upload";
import { requestEvidenceVerification } from "@/app/[locale]/app/evidence/actions";
import { Panel, StackedBar } from "@/components/app/primitives";
import { EvidenceTable } from "@/components/app/tables";
import { statusTone, toneDot } from "@/components/ui/status";
import { auth } from "@/data/auth/provider";
import { requireTenant } from "@/data/context";
import { countBy, type EvidenceStatus } from "@/domain/types";
import { asLocale } from "@/i18n/params";

const ORDER: EvidenceStatus[] = ["verified", "partial", "rejected", "pending"];

export default async function ContractEvidence(props: PageProps<"/[locale]/app/contracts/[id]/evidence">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.evidence");
  const st = await getTranslations("status");
  const session = await auth.getSession();
  const isLive = session?.mode === "live";
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const [evidence, obligations] = await Promise.all([
    db.evidence.list(orgId, { contractId: id }),
    db.obligations.list(orgId, { contractId: id }),
  ]);
  const by = countBy(evidence, (e) => e.status);
  const tt = await getTranslations("app.evidence.upload.types");
  const typeLabels = Object.fromEntries(EVIDENCE_TYPES.map((k) => [k, tt(k)]));

  return (
    <>
      <Panel title={t("byStatus")} tone="sky">
        <div className="p-5">
          <StackedBar segments={ORDER.filter((s) => by[s]).map((s) => ({ key: s, value: by[s] ?? 0, className: toneDot[statusTone[s]], label: st(s) }))} />
        </div>
      </Panel>
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
      <Panel title={t("title")} tone="graphite" hint={t("subtitle")}>
        <EvidenceTable evidence={evidence} obligations={obligations} verifyAction={isLive ? requestEvidenceVerification : undefined} />
      </Panel>
    </>
  );
}
