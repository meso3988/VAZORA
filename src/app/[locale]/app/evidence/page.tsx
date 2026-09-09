import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader, Panel, StackedBar } from "@/components/app/primitives";
import { EvidenceTable } from "@/components/app/tables";
import { statusTone, toneDot } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { countBy, type EvidenceStatus } from "@/domain/types";
import { lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

const ORDER: EvidenceStatus[] = ["verified", "partial", "rejected", "pending"];

export async function generateMetadata(props: PageProps<"/[locale]/app/evidence">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.evidence" });
  return { title: t("title") };
}

export default async function EvidencePage(props: PageProps<"/[locale]/app/evidence">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.evidence");
  const st = await getTranslations("status");
  const { orgId, db } = await requireTenant();
  const [evidence, obligations, contracts] = await Promise.all([
    db.evidence.list(orgId),
    db.obligations.list(orgId),
    db.contracts.list(orgId),
  ]);
  const titles = Object.fromEntries(contracts.map((c) => [c.id, lt(c.title, locale)]));
  const by = countBy(evidence, (e) => e.status);

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Panel title={t("byStatus")}>
        <div className="p-5">
          <StackedBar segments={ORDER.filter((s) => by[s]).map((s) => ({ key: s, value: by[s] ?? 0, className: toneDot[statusTone[s]], label: st(s) }))} />
        </div>
      </Panel>
      <Panel>
        <EvidenceTable evidence={evidence} obligations={obligations} contractTitles={titles} />
      </Panel>
    </>
  );
}
