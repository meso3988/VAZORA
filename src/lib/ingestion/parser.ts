import "server-only";

/**
 * Text extraction from uploaded contract documents.
 *
 * untrusted input boundary: every byte here is contract content (data), and
 * downstream AI extraction must never treat document text as instructions.
 *
 * Supported: digital PDF, DOCX. Scanned PDFs with no text layer are detected
 * and marked OCR_REQUIRED — never silently dropped.
 */
export type ParsedDocument = {
  fileName: string;
  kind: "pdf" | "docx";
  text: string;
  pageCount: number | null;
  /** character offsets per page so snippets can keep their page number */
  pageOffsets: { page: number; start: number; end: number }[];
  emptyText: boolean;
};

export async function parseDocumentBytes(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return parsePdf(fileName, bytes);
  if (lower.endsWith(".docx")) return parseDocx(fileName, bytes);
  throw new Error(`UNSUPPORTED_DOC_TYPE:${fileName}`);
}

async function parsePdf(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const pageOffsets: ParsedDocument["pageOffsets"] = [];
  let text = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .filter(Boolean)
      .join(" ");
    const start = text.length;
    text += pageText + "\n\n";
    pageOffsets.push({ page: p, start, end: text.length });
  }
  return { fileName, kind: "pdf", text: text.trim(), pageCount: doc.numPages, pageOffsets, emptyText: text.trim().length < 40 };
}

async function parseDocx(fileName: string, bytes: Buffer): Promise<ParsedDocument> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  return { fileName, kind: "docx", text: value.trim(), pageCount: null, pageOffsets: [], emptyText: value.trim().length < 40 };
}
