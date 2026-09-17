import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { Empty, Mono, Ring, Table, Td, Th } from "@/components/app/primitives";
import { StatusDot, StatusPill, statusTone } from "@/components/ui/status";
import { claimReadiness, type Claim, type Evidence, type Obligation, type Risk } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { cn, formatMoney, lt } from "@/lib/utils";

export async function ObligationsTable({
  obligations,
  currency = "SAR",
  contractTitles,
}: {
  obligations: Obligation[];
  currency?: string;
  contractTitles?: Record<string, string>;
}) {
  const locale = await getLocale();
  const t = await getTranslations("app.obligations");
  const cad = await getTranslations("cadence");
  const f = await getFormatter();
  if (!obligations.length) return <Empty>—</Empty>;

  return (
    <Table className="min-w-[900px]">
      <thead className="bg-fg/2">
        <tr>
          <Th>{t("columns.clause")}</Th>
          <Th>{t("columns.requirement")}</Th>
          <Th>{t("columns.owner")}</Th>
          <Th>{t("columns.cadence")}</Th>
          <Th>{t("columns.due")}</Th>
          <Th>{t("columns.evidence")}</Th>
          <Th>{t("columns.exposure")}</Th>
          <Th>{t("columns.status")}</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {obligations.map((o) => (
          <tr key={o.id} className="align-top hover:bg-fg/3">
            <Td><Mono>{o.clauseRef}</Mono></Td>
            <Td>
              <div className="flex max-w-[52ch] flex-col gap-1">
                <span>{lt(o.requirement, locale)}</span>
                {contractTitles?.[o.contractId] && <span className="text-xs text-muted">{contractTitles[o.contractId]}</span>}
                <ul className="flex flex-wrap gap-x-3 text-xs text-muted">
                  {o.requiredEvidence.map((r) => (
                    <li key={r.en}>· {lt(r, locale)}</li>
                  ))}
                </ul>
              </div>
            </Td>
            <Td className="whitespace-nowrap text-muted">{o.ownerName}</Td>
            <Td className="whitespace-nowrap text-muted">{cad(o.cadence)}</Td>
            <Td><Mono className={cn("text-sm", o.status === "overdue" && "text-missing")}>{f.dateTime(new Date(o.dueDate), "short")}</Mono></Td>
            <Td className="whitespace-nowrap text-muted">{t("evidenceCount", { count: o.evidenceIds.length })}</Td>
            <Td>{o.penaltyExposure ? <Mono className="text-sm text-at-risk">{formatMoney(o.penaltyExposure, locale, currency, { compact: true })}</Mono> : <span className="text-faint">—</span>}</Td>
            <Td><StatusPill status={o.status} subtle /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export async function EvidenceTable({
  evidence,
  obligations,
  contractTitles,
}: {
  evidence: Evidence[];
  obligations: Obligation[];
  contractTitles?: Record<string, string>;
}) {
  const locale = await getLocale();
  const t = await getTranslations("app.evidence");
  const f = await getFormatter();
  const byId = new Map(obligations.map((o) => [o.id, o]));
  if (!evidence.length) return <Empty>—</Empty>;

  return (
    <Table className="min-w-[900px]">
      <thead className="bg-fg/2">
        <tr>
          <Th>{t("columns.file")}</Th>
          <Th>{t("columns.obligation")}</Th>
          <Th>{t("columns.uploaded")}</Th>
          <Th>{t("columns.version")}</Th>
          <Th>{t("verification")}</Th>
          <Th>{t("columns.status")}</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {evidence.map((e) => {
          const o = byId.get(e.obligationId);
          const passed = e.verification.checks.filter((c) => c.passed).length;
          return (
            <tr key={e.id} className="align-top hover:bg-fg/3">
              <Td>
                <div className="flex flex-col gap-0.5">
                  <Mono className="text-sm text-fg">{e.fileName}</Mono>
                  <span className="text-xs uppercase text-faint">{e.fileType}</span>
                </div>
              </Td>
              <Td>
                {o ? (
                  <Link href={`/app/contracts/${o.contractId}/obligations`} className="flex max-w-[40ch] flex-col gap-0.5">
                    <span className="truncate"><Mono className="me-1.5">{o.clauseRef}</Mono>{lt(o.requirement, locale)}</span>
                    {contractTitles?.[o.contractId] && <span className="text-xs text-muted">{contractTitles[o.contractId]}</span>}
                  </Link>
                ) : "—"}
              </Td>
              <Td>
                <div className="flex flex-col gap-0.5 whitespace-nowrap">
                  <Mono className="text-sm">{f.dateTime(new Date(e.uploadedAt), "medium")}</Mono>
                  <span className="text-xs text-muted">{t("uploadedBy", { name: e.uploadedBy })}</span>
                </div>
              </Td>
              <Td><Mono>v{e.version}</Mono></Td>
              <Td>
                <div className="flex max-w-[44ch] flex-col gap-1.5">
                  <span className="text-xs text-muted">{t("passed", { passed, total: e.verification.checks.length })}</span>
                  <ul className="flex flex-col gap-1">
                    {e.verification.checks.map((c) => (
                      <li key={c.label.en} className="flex items-center gap-1.5 text-xs">
                        <StatusDot tone={c.passed ? "verified" : "missing"} />
                        <span className={c.passed ? "text-muted" : "text-fg"}>{lt(c.label, locale)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs leading-relaxed text-muted">{lt(e.verification.summary, locale)}</p>
                </div>
              </Td>
              <Td><StatusPill status={e.status} subtle /></Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export async function RiskList({ risks, currency = "SAR" }: { risks: Risk[]; currency?: string }) {
  const locale = await getLocale();
  const t = await getTranslations("app.risks");
  const st = await getTranslations("status");
  const sev = await getTranslations("severity");
  if (!risks.length) return <Empty>—</Empty>;

  return (
    <ul className="divide-y divide-line">
      {risks.map((r) => {
        const tone = r.severity === "critical" || r.severity === "high" ? "missing" : r.severity === "medium" ? "at_risk" : "pending";
        return (
          <li key={r.id} className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className={cn("flex items-center gap-1.5 font-medium", tone === "missing" ? "text-missing" : tone === "at_risk" ? "text-at-risk" : "text-muted")}>
                  <StatusDot tone={tone} /> {sev(r.severity)}
                </span>
                <span>· {t("linkedClause", { ref: r.clauseRef })}</span>
                <span>· {st(r.status)}</span>
              </div>
              <span className="text-sm font-medium">{lt(r.title, locale)}</span>
              <p className="max-w-[80ch] text-sm leading-relaxed text-muted">{lt(r.description, locale)}</p>
            </div>
            <div className="flex flex-row items-center gap-6 md:flex-col md:items-end md:gap-1">
              <div className="flex flex-col md:items-end">
                <span className="text-[11px] text-muted">{t("exposure")}</span>
                <Mono className="text-base text-at-risk">{formatMoney(r.exposure, locale, currency)}</Mono>
              </div>
              <span className={cn("text-xs", r.daysToImpact <= 7 ? "text-missing" : "text-muted")}>{t("daysToImpact", { days: r.daysToImpact })}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export async function ClaimCard({ claim, contractTitle }: { claim: Claim; contractTitle?: string }) {
  const locale = await getLocale();
  const t = await getTranslations("app.claims");
  const st = await getTranslations("status");
  const f = await getFormatter();
  const r = claimReadiness(claim);
  const blocking = claim.requirements.filter((q) => q.status !== "verified");
  const verified = claim.requirements.filter((q) => q.status === "verified");

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-5 border-b border-line p-5 md:flex-row md:items-center">
        <Ring value={r} size={88} stroke={7} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium">{t("claim", { number: claim.number })}</span>
            <StatusPill status={claim.status} subtle />
            {blocking.length > 0 && (
              <span className="rounded-sm bg-partial/10 px-2 py-0.5 text-[11px] font-medium text-partial">
                {t("blockersRemaining", { count: blocking.length })}
              </span>
            )}
          </div>
          <span className="text-sm text-muted">{lt(claim.period, locale)}{contractTitle && <> · {contractTitle}</>}</span>
          <span className="text-xs text-muted">
            {t("target", { date: f.dateTime(new Date(claim.targetDate), "medium") })} · {t("requirements", { count: claim.requirements.length })}
          </span>
        </div>
        <div className="flex flex-col md:items-end">
          <span className="text-[11px] text-muted">{t("readiness")}</span>
          <Mono className="text-xl">{formatMoney(claim.amount, locale, claim.currency)}</Mono>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="border-b border-line p-5">
          <h3 className="text-sm font-medium">{blocking.length ? t("blockersFirst", { count: blocking.length }) : t("nothingBlocking")}</h3>
          {blocking.length > 0 && (
            <ol className="mt-3 flex flex-col gap-3">
              {blocking.map((q, i) => (
                <li key={q.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-partial/15 font-mono text-[10px] text-partial">{i + 1}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm"><Mono className="me-1.5">{q.clauseRef}</Mono>{lt(q.label, locale)}</span>
                    {q.note && <span className="text-xs leading-relaxed text-muted">{lt(q.note, locale)}</span>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-2 px-5 py-3 text-xs text-muted hover:text-fg">
            <StatusDot tone="verified" />
            {t("verifiedCollapsed", { count: verified.length })}
            <span className="ms-auto font-mono text-[10px] group-open:rotate-90">›</span>
          </summary>
          <Table className="min-w-0 border-t border-line">
            <tbody className="divide-y divide-line">
              {verified.map((q) => (
                <tr key={q.id}>
                  <Td className="py-2"><Mono>{q.clauseRef}</Mono></Td>
                  <Td className="py-2 text-sm text-muted">{lt(q.label, locale)}</Td>
                  <Td className="py-2">
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <StatusDot tone={statusTone[q.status]} />{st(q.status)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </details>
      </div>
    </div>
  );
}
