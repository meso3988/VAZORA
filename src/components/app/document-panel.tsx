import { FileText, Upload } from "lucide-react";

import { Mono, Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import type { ContractDocument } from "@/domain/types";

import { getDocumentUrl, uploadDocument } from "@/app/[locale]/app/contracts/[id]/actions";

type Labels = {
  title: string;
  hint: string;
  upload: string;
  empty: string;
  open: string;
  uploaded: string;
  demoReadonly: string;
  errors: { noFile: string; tooLarge: string; type: string; upload: string };
};

/**
 * Contract documents: private-storage upload (PDF/DOCX) with 60s signed-URL
 * open links. In demo mode the upload input is disabled — the tenancy goal is
 * live users; the demo stays read-only for documents.
 */
export function DocumentPanel({
  contractId,
  locale,
  documents,
  canUpload,
  labels,
  error,
}: {
  contractId: string;
  locale: string;
  documents: ContractDocument[];
  canUpload: boolean;
  labels: Labels;
  error?: string;
}) {
  return (
    <Panel tone="graphite" title={labels.title} hint={labels.hint}>
      {canUpload ? (
        <form action={uploadDocument} className="flex items-center gap-3 border-b border-line px-5 py-3">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="contractId" value={contractId} />
          <label className="flex flex-1 items-center gap-3">
            <Upload size={15} className="shrink-0 text-muted" strokeWidth={1.5} />
            <input
              type="file"
              name="file"
              required
              accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
              className="block w-full text-xs text-muted file:me-3 file:rounded-md file:border file:border-line file:bg-bg file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg"
            />
          </label>
          <Button type="submit" size="sm">{labels.upload}</Button>
        </form>
      ) : (
        <p className="border-b border-line px-5 py-2.5 text-xs text-faint">{labels.demoReadonly}</p>
      )}

      {error === "uploaded" && (
        <p className="border-b border-line bg-verified/10 px-5 py-2 text-xs text-verified">{labels.uploaded}</p>
      )}
      {error && error !== "uploaded" && labels.errors[error as keyof Labels["errors"]] && (
        <p className="border-b border-line bg-missing/10 px-5 py-2 text-xs text-missing">
          {labels.errors[error as keyof Labels["errors"]]}
        </p>
      )}

      {documents.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">{labels.empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-5 py-3">
              <FileText size={15} className="shrink-0 text-muted" strokeWidth={1.5} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{d.fileName}</span>
                <span className="text-[11px] text-faint">
                  <Mono className="text-[11px]">{(d.fileSize / 1024 / 1024).toFixed(2)} MB</Mono> · {d.mimeType}
                </span>
              </div>
              <form action={getDocumentUrl}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="documentId" value={d.id} />
                <button type="submit" className="text-xs text-muted underline hover:text-fg">
                  {labels.open}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
