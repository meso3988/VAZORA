"use client";

import { useLocale } from "next-intl";
import { useState } from "react";
import { UserCheck } from "lucide-react";

import { Panel } from "@/components/app/primitives";
import type { Assignment } from "@/data/mock/queues";
import { cn, lt } from "@/lib/utils";

/** Owner assignment review: high-confidence suggestions approved in bulk, exceptions decided individually. */
export function AssignmentReview({ assignments, total, confident }: { assignments: Assignment[]; total: number; confident: number }) {
  const locale = useLocale();
  const [resolved, setResolved] = useState<string[]>([]);
  const live = assignments.filter((a) => !resolved.includes(a.id));
  const bulkLeft = confident - assignments.filter((a) => a.confidence === "high" && resolved.includes(a.id)).length;

  return (
    <Panel>
      <div className="panel-header-tonal flex items-center justify-between gap-4 border-b border-line rounded-t-md bg-sky-800 px-5 py-3 text-sky-50">
        <div className="flex min-w-0 flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <UserCheck size={15} className="shrink-0 opacity-80" strokeWidth={1.5} />
            {locale === "ar" ? `تعيينات تتطلب مراجعتك — ${live.length}` : `Assignments requiring your review — ${live.length}`}
          </h2>
          <p className="text-[11px] opacity-80">
            {locale === "ar"
              ? `استُخرج ${total} التزاماً · اقتُرح ${confident} بثقة عالية · راجع الاستثناءات`
              : `${total} obligations extracted · ${confident} confidently suggested · review the exceptions`}
          </p>
        </div>
        <span className="rounded-full bg-sky-950/60 px-2.5 py-0.5 font-mono text-xs text-sky-100 tabular">{live.length}</span>
      </div>
      {live.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{locale === "ar" ? "كل التعيينات معتمدة." : "All assignments are approved."}</p>
      ) : (
        <>
          {bulkLeft > 0 && (
            <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
              <span className="text-xs text-muted">
                {locale === "ar" ? `${bulkLeft} تعييناً بثقة عالية` : `${bulkLeft} high-confidence assignments`}
              </span>
              <button
                type="button"
                onClick={() => setResolved(items => [...items, ...assignments.filter(a => a.confidence === "high").map(a => a.id)])}
                className="h-8 rounded-md bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-600"
              >
                {locale === "ar" ? "اعتمدها جميعاً" : "Approve all"}
              </button>
            </div>
          )}
          <ol className="divide-y divide-line">
            {live.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span dir="ltr" className="font-mono text-xs text-muted">§{a.clause}</span>
                    <span className={cn("text-xs", "rounded-sm px-1.5 py-0.5", a.confidence === "high" ? "bg-verified/10 text-verified" : "bg-partial/10 text-partial")}>
                      {a.confidence === "high" ? (locale === "ar" ? "ثقة عالية" : "High confidence") : (locale === "ar" ? "يتطلب قرارك" : "Needs decision")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{lt(a.person, locale)} · {lt(a.role, locale)}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-faint">{lt(a.reason, locale)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setResolved((r) => [...r, a.id])}
                    className="h-8 rounded-md bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-600"
                  >
                    {locale === "ar" ? "اعتماد" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResolved((r) => [...r, a.id])}
                    className="h-8 rounded-md border border-line px-3 text-xs text-muted hover:bg-fg/5"
                  >
                    {locale === "ar" ? "تغيير" : "Change"}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}
