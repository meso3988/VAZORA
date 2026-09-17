"use client";

import { useLocale } from "next-intl";
import { useState } from "react";
import { CheckCircle, AlertTriangle } from "lucide-react";

import { Panel } from "@/components/app/primitives";
import type { QueueItem } from "@/data/mock/queues";
import { cn, lt } from "@/lib/utils";

const ACTION_TONES: Record<string, string> = {
  approve: "bg-emerald-700 text-white hover:bg-emerald-600",
  review: "bg-emerald-700 text-white hover:bg-emerald-600",
  reject: "bg-rose-600/10 text-rose-700 border border-rose-300 hover:bg-rose-600/15",
  resolve: "bg-emerald-700 text-white hover:bg-emerald-600",
  request: "bg-emerald-700 text-white hover:bg-emerald-600",
};

/**
 * Decision surface: AI proposes – the human approves. Colored title bands and
 * action buttons distinguish waiting-for-approval (amber) from action (emerald).
 */
export function QueueBoard({
  items,
  empty,
  kind,
  title,
}: {
  items: QueueItem[];
  empty: string;
  kind: "approval" | "action";
  title: string;
}) {
  const locale = useLocale();
  const [resolved, setResolved] = useState<string[]>([]);
  const live = items.filter((item) => !resolved.includes(item.id));
  const accent = kind === "approval" ? "border-l-amber-500" : "border-l-emerald-600";
  const header = cn(
    "panel-header-tonal rounded-t-md",
    kind === "approval"
      ? "bg-amber-800 text-amber-50"
      : "bg-emerald-800 text-emerald-50",
  );
  const badge = kind === "approval" ? "bg-amber-950/50 text-amber-50" : "bg-emerald-950/60 text-emerald-100";

  return (
    <Panel>
      <div className={cn("flex items-center justify-between gap-4 border-b border-line px-5 py-3", header)}>
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          {kind === "approval" ? <CheckCircle size={15} className="shrink-0 opacity-80" strokeWidth={1.5} /> : <AlertTriangle size={15} className="shrink-0 opacity-80" strokeWidth={1.5} />}
          {title}
        </h2>
        <span className={cn("rounded-full px-2.5 py-0.5 font-mono text-xs tabular", badge)}>{live.length}</span>
      </div>
      {live.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{empty}</p>
      ) : (
        <ol className="divide-y divide-line">
          {live.map((item) => (
            <li key={item.id} className={cn("border-l-4 px-5 py-4", accent)}>
              <div className="flex flex-col gap-1 md:flex-row md:items-start md:gap-6">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{lt(item.title, locale)}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{lt(item.detail, locale)}</p>
                  {item.meta && (
                    <p className="mt-1 font-mono text-[11px] text-verified">{lt(item.meta, locale)}</p>
                  )}
                </div>
                <div className="mt-2 flex shrink-0 items-center gap-2 md:mt-0">
                  {item.actions.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      title={lt({ en: "Demo: records your choice locally", ar: "عرض تجريبي: يسجّل اختيارك محلياً" }, locale)}
                      onClick={() => setResolved((r) => [...r, item.id])}
                      className={cn(
                        "h-8 rounded-md px-3 text-xs font-medium transition-colors",
                        ACTION_TONES[action.key] ?? "border border-line text-muted hover:bg-fg/5",
                      )}
                    >
                      {lt(action.label, locale)}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
