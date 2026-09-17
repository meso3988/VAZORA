import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { EvidenceScanner } from "@/components/app/evidence-scanner";
import { PageHeader, Panel, StackedBar } from "@/components/app/primitives";
import { statusTone, toneDot } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { countBy, type EvidenceStatus } from "@/domain/types";
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
  const [evidence, obligations] = await Promise.all([
    db.evidence.list(orgId),
    db.obligations.list(orgId),
  ]);
  const by = countBy(evidence, (e) => e.status);

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Panel title={t("byStatus")} tone="sky">
        <div className="p-5">
          <StackedBar segments={ORDER.filter((s) => by[s]).map((s) => ({ key: s, value: by[s] ?? 0, className: toneDot[statusTone[s]], label: st(s) }))} />
        </div>
      </Panel>
      <Panel>
        <EvidenceScanner evidence={evidence} obligations={obligations} />
      </Panel>
    </>
  );
}
