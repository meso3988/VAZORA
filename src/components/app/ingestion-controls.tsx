import { FileSearch, Loader2, TriangleAlert, Check } from "lucide-react";

import { Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";

import { analyzeContract } from "@/app/[locale]/app/contracts/[id]/analysis-actions";

type AnalysisState = {
  obligations: number;
  needsReview: number;
  conflictCount: number;
  paymentLinked: number;
  financial: number;
  externalDeps: number;
  recurring: number;
};

/**
 * Ingestion control on the contract workspace. Live tenants with documents can
 * analyze; the button is hidden for demo and contracts without files. States
 * surface real outcomes: running, ready, failed with a code, unavailable.
 */
export function IngestionControls({
  contractId,
  locale,
  hasDocuments,
  canRun,
  currentRun,
  analysis,
  labels,
}: {
  contractId: string;
  locale: string;
  hasDocuments: boolean;
  canRun: boolean;
  currentRun: { id: string; status: string; error_code: string | null; obligations: number } | null;
  analysis: AnalysisState | null;
  labels: Record<string, string>;
}) {
  const running = currentRun && ["queued", "parsing", "parsed", "extracting", "consolidating"].includes(currentRun.status);
  const ready = currentRun?.status === "ready_for_review";

  return (
    <Panel tone="emerald" title={labels.title}>
      <div className="flex flex-col gap-4 px-5 py-4">
        {!canRun ? (
          <p className="text-xs text-faint">{labels.unavailable}</p>
        ) : !hasDocuments ? (
          <p className="text-xs text-faint">{labels.needDocuments}</p>
        ) : (
          <form action={analyzeContract} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="contractId" value={contractId} />
            <Button type="submit" size="sm" className="gap-1.5">
              <FileSearch size={14} /> {labels.analyze}
            </Button>
            {analysis && running === false && (
              <span className="text-[11px] text-muted">{labels.lastCounts}</span>
            )}
          </form>
        )}

        {running && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" />
            {labels.running.replace("{status}", currentRun?.status ?? "")}
            <span className="text-faint">· {labels.stages}</span>
          </div>
        )}

        {currentRun?.status === "failed" && (
          <div className="flex items-start gap-2 rounded-md border border-missing/30 bg-missing/10 px-3 py-2">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-missing" />
            <div className="text-xs">
              <p className="font-medium text-missing">{labels.failed}</p>
              {currentRun.error_code && <p className="mt-0.5 text-faint">{currentRun.error_code}</p>}
            </div>
          </div>
        )}

        {ready && analysis && (
          <div className="grid grid-cols-2 gap-2 rounded-md border border-verified/30 bg-verified/5 p-3 sm:grid-cols-3">
            <Metric k={labels.total} v={analysis.obligations} big />
            <Metric k={labels.recurring} v={analysis.recurring} />
            <Metric k={labels.payment} v={analysis.paymentLinked} />
            <Metric k={labels.financial} v={analysis.financial} />
            <Metric k={labels.external} v={analysis.externalDeps} />
            <Metric k={labels.needsReview} v={analysis.needsReview} warn={analysis.needsReview > 0} />
          </div>
        )}
        {ready && analysis && (
          <div className="flex items-center gap-2 text-xs text-verified">
            <Check size={13} /> {labels.readyHint}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Metric({ k, v, big, warn }: { k: string; v: number; big?: boolean; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{k}</span>
      <span className={`font-mono tabular font-bold ${big ? "text-2xl" : "text-lg"} ${warn ? "text-partial" : "text-fg"}`}>{v}</span>
    </div>
  );
}
