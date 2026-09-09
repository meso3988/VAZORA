import { getLocale, getTranslations } from "next-intl/server";

import { StatusPill } from "@/components/ui/status";
import { DemoBadge } from "@/components/ui/surface";
import { getDataProvider } from "@/data";
import { CONTRACT_HERO_ID } from "@/data/mock/contracts";
import { DEMO_ORGANIZATION_ID } from "@/data/mock/organization";
import { formatMoney, lt } from "@/lib/utils";

/** Static, light-themed preview of the contract workspace rendered from demo data. */
export async function WorkspacePreview() {
  const locale = await getLocale();
  const t = await getTranslations("app");
  const c = await getTranslations("common");
  const db = getDataProvider();
  const contract = await db.contracts.getById(DEMO_ORGANIZATION_ID, CONTRACT_HERO_ID);
  const obligations = (await db.obligations.list(DEMO_ORGANIZATION_ID, { contractId: CONTRACT_HERO_ID })).slice(0, 5);
  if (!contract) return null;

  const h = contract.health;
  const kpis = [
    { label: t("dashboard.kpis.obligationsDue"), value: String(h.obligationsDueThisMonth) },
    { label: t("dashboard.kpis.overdue"), value: String(h.obligationsOverdue), tone: h.obligationsOverdue ? "text-missing" : "" },
    { label: t("dashboard.kpis.coverage"), value: `${Math.round(h.evidenceCoverage * 100)}%` },
    { label: t("dashboard.kpis.exposure"), value: formatMoney(h.riskExposure, locale, contract.currency, { compact: true }), tone: "text-at-risk" },
    { label: t("dashboard.kpis.readiness"), value: `${Math.round(h.claimReadiness * 100)}%`, tone: "text-verified" },
  ];

  return (
    <div data-theme="light" className="overflow-hidden rounded-lg border border-line-strong bg-bg text-fg shadow-[0_30px_80px_-40px_rgba(17,21,20,0.35)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-elevated px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-mono text-xs text-muted" dir="ltr">{contract.reference}</span>
          <span className="truncate text-sm font-medium">{lt(contract.title, locale)}</span>
        </div>
        <DemoBadge label={c("demoData")} hint={c("demoDataHint")} />
      </div>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="flex flex-col gap-1 bg-bg px-5 py-4">
            <span className="text-[11px] text-muted">{k.label}</span>
            <span className={`font-mono text-xl font-medium tabular ${k.tone ?? ""}`}>{k.value}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <table className="w-full text-start text-sm">
          <thead className="bg-elevated text-[11px] text-muted">
            <tr>
              <th className="px-5 py-2 text-start font-medium">{t("obligations.columns.clause")}</th>
              <th className="px-5 py-2 text-start font-medium">{t("obligations.columns.requirement")}</th>
              <th className="hidden px-5 py-2 text-start font-medium sm:table-cell">{t("obligations.columns.owner")}</th>
              <th className="px-5 py-2 text-start font-medium">{t("obligations.columns.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {obligations.map((o) => (
              <tr key={o.id}>
                <td className="px-5 py-3 font-mono text-xs text-muted" dir="ltr">{o.clauseRef}</td>
                <td className="max-w-[28ch] truncate px-5 py-3">{lt(o.requirement, locale)}</td>
                <td className="hidden px-5 py-3 text-muted sm:table-cell">{o.ownerName}</td>
                <td className="px-5 py-3"><StatusPill status={o.status} subtle /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
