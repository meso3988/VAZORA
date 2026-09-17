import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Panel, StackedBar } from "@/components/app/primitives";
import { EvidenceTable } from "@/components/app/tables";
import { statusTone, toneDot } from "@/components/ui/status";
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
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const [evidence, obligations] = await Promise.all([
    db.evidence.list(orgId, { contractId: id }),
    db.obligations.list(orgId, { contractId: id }),
  ]);
  const by = countBy(evidence, (e) => e.status);

  return (
    <>
      <Panel title={t("byStatus")} tone="sky">
        <div className="p-5">
          <StackedBar segments={ORDER.filter((s) => by[s]).map((s) => ({ key: s, value: by[s] ?? 0, className: toneDot[statusTone[s]], label: st(s) }))} />
        </div>
      </Panel>
      <Panel title={t("title")} tone="graphite" hint={t("subtitle")}>
        <EvidenceTable evidence={evidence} obligations={obligations} />
      </Panel>
    </>
  );
}
