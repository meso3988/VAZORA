"use client";

import { ArrowUpRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Mono } from "@/components/app/primitives";
import { StatusDot, StatusPill } from "@/components/ui/status";
import type { Evidence, Obligation } from "@/domain/types";
import { Link } from "@/i18n/navigation";
import { cn, lt } from "@/lib/utils";

type Tone = "verified" | "partial" | "missing" | "at_risk" | "pending";
const STATUS_TONE: Record<string, Tone> = { verified: "verified", partial: "partial", rejected: "missing", pending: "pending" };
const ROW_ACTIVE: Record<Tone, string> = {
  verified: "bg-emerald-50 shadow-[inset_3px_0_0_#0b7455]",
  partial: "bg-amber-500/5 shadow-[inset_3px_0_0_#d4a24a]",
  missing: "bg-rose-50 shadow-[inset_3px_0_0_#b8352f]",
  at_risk: "bg-amber-50 shadow-[inset_3px_0_0_#c2603e]",
  pending: "bg-fg/4 shadow-[inset_3px_0_0_var(--color-line-strong)]",
};
const PANEL_ACCENT: Record<Tone, string> = {
  verified: "bg-emerald-50/60",
  partial: "bg-amber-500/10",
  missing: "bg-rose-50/80",
  at_risk: "bg-amber-50/70",
  pending: "bg-fg/3",
};

/**
 * Evidence scanner + inspector. Rows stay lean; selecting a row opens the
 * decision detail: requirement → evidence → verification → result → next action.
 */
export function EvidenceScanner({
  evidence,
  obligations,
}: {
  evidence: Evidence[];
  obligations: Obligation[];
}) {
  const t = useTranslations("app.evidence");
  const st = useTranslations("status");
  const locale = useLocale();
  const byId = new Map(obligations.map((o) => [o.id, o]));
  const [selectedId, setSelectedId] = useState(evidence[0]?.id ?? "");
  const selected = evidence.find((e) => e.id === selectedId);
  const selectedObligation = selected ? byId.get(selected.obligationId) : undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <ul className="divide-y divide-line lg:border-e lg:border-line">
        {evidence.map((e) => {
          const o = byId.get(e.obligationId);
          const active = selectedId === e.id;
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSelectedId(e.id)}
                aria-pressed={active}
                className={cn(
                  "flex w-full items-center gap-4 px-5 py-3.5 text-start transition-colors hover:bg-fg/3",
                  active && ROW_ACTIVE[STATUS_TONE[e.status]],
                )}
              >
                <StatusDot tone={STATUS_TONE[e.status]} className="shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Mono className="truncate text-sm text-fg">{e.fileName}</Mono>
                  <span className="truncate text-xs text-muted">
                    {o && <><span dir="ltr" className="font-mono">§{o.clauseRef}</span> · {lt(o.requirement, locale)}</>}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                  <span>{new Date(e.uploadedAt).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { month: "short", day: "numeric" })}</span>
                  <span>{o?.ownerName}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <aside aria-live="polite" className="flex flex-col">
        {!selected || !selectedObligation ? (
          <p className="px-5 py-10 text-sm text-muted">{t("inspector.closeHint")}</p>
        ) : (
          <div className="flex flex-col">
            <div className={cn("flex items-center justify-between border-b border-line px-5 py-3.5", PANEL_ACCENT[STATUS_TONE[selected.status]])}>
              <h3 className="text-sm font-semibold">{t("inspector.title")}</h3>
              <StatusPill status={selected.status} subtle />
            </div>
            <dl className="flex flex-col px-5 py-4">
              <InspectorBlock label={t("inspector.requirement")}>
                <p className="text-sm">{lt(selectedObligation.requirement, locale)}</p>
                <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted">
                  {selectedObligation.requiredEvidence.map((r) => (
                    <li key={r.en} className="flex items-center gap-1.5">
                      <span className="size-1 rounded-full bg-line-strong" />
                      {lt(r, locale)}
                    </li>
                  ))}
                </ul>
              </InspectorBlock>
              <InspectorBlock label={t("inspector.submitted")}>
                <p className="text-sm"><Mono>{selected.fileName}</Mono></p>
                <p className="mt-1 text-xs text-muted">{t("uploadedBy", { name: selected.uploadedBy })} · v{selected.version}</p>
              </InspectorBlock>
              <InspectorBlock label={t("inspector.inspected")}>
                <ul className="flex flex-col gap-1.5">
                  {selected.verification.checks.map((c) => (
                    <li key={c.label.en} className="flex items-center gap-2 text-xs">
                      <StatusDot tone={c.passed ? "verified" : "missing"} />
                      <span className={c.passed ? "text-muted" : "text-fg"}>{lt(c.label, locale)}</span>
                    </li>
                  ))}
                </ul>
              </InspectorBlock>
              <InspectorBlock label={t("inspector.why")}>
                <p className="text-xs leading-relaxed text-muted">{lt(selected.verification.summary, locale)}</p>
              </InspectorBlock>
              <InspectorBlock label={t("inspector.proofChain")}>
                <p className="font-mono text-[11px] leading-relaxed text-muted" dir={locale === "ar" ? "rtl" : "ltr"}>
                  <span dir="ltr">§{selectedObligation.clauseRef}</span> → {lt(selectedObligation.requirement, locale).slice(0, 48)} → <span dir="ltr">{selected.fileName}</span> → {st(selected.status)}
                </p>
              </InspectorBlock>
              <InspectorBlock label={t("inspector.next")}>
                {selected.status === "verified" ? (
                  <p className="text-xs text-verified">{st("verified")}</p>
                ) : (
                  <p className="text-xs text-partial">{lt(selectedObligation.requiredEvidence[selectedObligation.requiredEvidence.length - 1], locale)}</p>
                )}
              </InspectorBlock>
            </dl>
            <div className="border-t border-line px-5 py-3">
              <Link
                href={`/app/contracts/${selected.contractId}/obligations`}
                className="flex items-center gap-1 text-xs font-medium text-fg hover:underline"
              >
                {t("inspector.openObligation")} <ArrowUpRight size={12} className="rtl:-scale-x-100" />
              </Link>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function InspectorBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line py-3 first:pt-0 last:border-b-0">
      <dt className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
