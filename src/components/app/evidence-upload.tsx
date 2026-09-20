import { Upload } from "lucide-react";

import { Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import type { Obligation } from "@/domain/types";
import { lt } from "@/lib/utils";

import { uploadNewEvidence } from "@/app/[locale]/app/evidence/actions";

export const EVIDENCE_TYPES = [
  "document", "report", "record", "spreadsheet", "signature",
  "acknowledgement", "approval", "photo", "certificate", "invoice",
  "kpi", "log", "meeting_minutes", "system_record", "other",
] as const;

type Labels = {
  title: string;
  hint: string;
  nameField: string;
  typeField: string;
  obligationField: string;
  noObligation: string;
  submit: string;
  types: Record<string, string>;
};

/**
 * Evidence intake: creates the logical item and uploads version 1 in one step.
 * Server-side validation rejects spoofed MIME/extension; the file lands in the
 * private `contract-evidence` bucket under the tenant path. Verification is a
 * separate step — uploading never marks anything verified.
 */
export function EvidenceUpload({
  contractId,
  locale,
  obligations,
  canUpload,
  labels,
}: {
  contractId: string;
  locale: string;
  obligations: Obligation[];
  canUpload: boolean;
  labels: Labels;
}) {
  return (
    <Panel tone="graphite" title={labels.title} hint={labels.hint}>
      {canUpload ? (
        <form action={uploadNewEvidence} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="contractId" value={contractId} />
          <input
            name="title"
            required
            maxLength={200}
            placeholder={labels.nameField}
            className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg placeholder:text-faint"
          />
          <select
            name="evidenceType"
            defaultValue="document"
            className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg"
            aria-label={labels.typeField}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>{labels.types[t] ?? t}</option>
            ))}
          </select>
          <select
            name="obligationId"
            defaultValue=""
            className="rounded-md border border-line bg-bg px-3 py-2 text-xs text-fg"
            aria-label={labels.obligationField}
          >
            <option value="">{labels.noObligation}</option>
            {obligations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.clauseRef ? `[${o.clauseRef}] ` : ""}{lt(o.requirement, locale).slice(0, 80)}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-3">
            <input
              type="file"
              name="file"
              required
              accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/csv,.csv,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp"
              className="block w-full text-xs text-muted file:me-3 file:rounded-md file:border file:border-line file:bg-bg file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg"
            />
            <Button type="submit" size="sm" className="shrink-0">
              <Upload size={14} strokeWidth={1.5} />
              {labels.submit}
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}
