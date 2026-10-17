// Generates the binary benchmark fixtures (real PDF + XLSX) into
// supabase/benchmarks/evidence-intelligence-benchmark-v1/files/ and writes
// manifest.json with SHA-256 fingerprints of every frozen file.
// Run once when the benchmark is (re)frozen — never during evaluation.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "benchmarks", "evidence-intelligence-benchmark-v1");
const filesDir = join(dir, "files");

// ---------- minimal text-layer PDF ----------
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
function buildPdf(pages: string[][]): Buffer {
  // objects: 1 catalog, 2 pages, then per page: page obj + content obj, +1 font
  const fontObj = 3 + pages.length * 2;
  const objects: string[] = [];
  objects[0] = "<</Type/Catalog/Pages 2 0 R>>";
  objects[1] = `<</Type/Pages/Kids[${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}]/Count ${pages.length}>>`;
  pages.forEach((lines, i) => {
    const pageObj = 3 + i * 2;
    const stream = `BT /F1 10.5 Tf 48 760 Td 15 TL ${lines.map((l) => `(${pdfEscape(l)}) Tj T*`).join(" ")} ET`;
    objects[pageObj - 1] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 ${fontObj} 0 R>>>>/Contents ${pageObj + 1} 0 R>>`;
    objects[pageObj] = `<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}\nendstream`;
  });
  objects[fontObj - 1] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets[i] = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += `${String(o).padStart(10, "0")} 00000 n \n`));
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------- XLSX builder ----------
const { default: JSZip } = await import("jszip");
const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type SheetCell = { ref: string; value: string | number };
async function buildXlsx(sheets: { name: string; cells: SheetCell[] }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CT);
  zip.file("_rels/.rels", ROOT_RELS);
  const strings: string[] = [];
  const sIdx = new Map<string, number>();
  const si = (s: string) => {
    if (!sIdx.has(s)) { sIdx.set(s, strings.length); strings.push(s); }
    return sIdx.get(s)!;
  };
  const sheetXml = (cells: SheetCell[]) => {
    const byRow = new Map<number, SheetCell[]>();
    for (const c of cells) {
      const r = Number(c.ref.replace(/^[A-Z]+/, ""));
      byRow.set(r, [...(byRow.get(r) ?? []), c]);
    }
    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([r, cs]) =>
      `<row r="${r}">${cs.map((c) =>
        typeof c.value === "number" ? `<c r="${c.ref}"><v>${c.value}</v></c>` : `<c r="${c.ref}" t="s"><v>${si(c.value)}</v></c>`,
      ).join("")}</row>`,
    ).join("");
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  };
  zip.file("xl/workbook.xml",
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`);
  // Serialize sheets first — si() populates the shared-string table as a
  // side effect, so sharedStrings.xml must be written after them.
  const sheetXmls = sheets.map((s) => sheetXml(s.cells));
  zip.file("xl/sharedStrings.xml",
    `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  sheets.forEach((_, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXmls[i]));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ---------- fixture contents ----------
mkdirSync(filesDir, { recursive: true });

const enPdf = buildPdf([
  [
    "MONTHLY PERFORMANCE REPORT - SEPTEMBER 2025",
    "Contract: EN-O&M-2025-441 Regional facilities O&M",
    "Contractor: Meridian Facilities Services Ltd",
    "",
    "REPORTING PERIOD",
    "This report covers the period 2025-09-01 to 2025-09-30.",
    "",
    "EXECUTIVE SUMMARY",
    "All contractual KPIs for the period were met or exceeded.",
    "Detailed KPI values are reported in the attached KPI Summary workbook.",
  ],
  [
    "APPROVALS AND SIGNATURES",
    "",
    "Contractor signature: signed - D. Mercer, Contract Director (signed 2025-10-02)",
    "",
    "Client acknowledgement: reviewed and accepted - R. Whitfield,",
    "Client Representative, Property Directorate (signed 2025-10-05)",
  ],
]);
writeFileSync(join(filesDir, "en-monthly-report.pdf"), enPdf);

const enKpis: SheetCell[] = [
  { ref: "B2", value: "KPI Summary - September 2025" },
  ...["KPI-1", "KPI-2", "KPI-3", "KPI-4", "KPI-5", "KPI-6", "KPI-7", "KPI-8"].map((k, i) => ({ ref: `${"BCDEFGHI"[i]}3`, value: k })),
  ...[98.2, 3.8, 96.4, 24, -4.1, 94.7, 18, 100].map((v, i) => ({ ref: `${"BCDEFGHI"[i]}4`, value: v })),
  { ref: "B6", value: "All eight KPI values reported for period 2025-09" },
];
writeFileSync(join(filesDir, "en-kpis.xlsx"), await buildXlsx([
  { name: "KPI Summary", cells: enKpis },
  { name: "Notes", cells: [{ ref: "A1", value: "Prepared by Meridian performance team" }] },
]));

const mixedKpis: SheetCell[] = [
  { ref: "B2", value: "Daily KPI Log - September 2025 (O&M-2025-207)" },
  ...["KPI-1", "KPI-2", "KPI-3", "KPI-4", "KPI-5", "KPI-6", "KPI-7", "KPI-8"].map((k, i) => ({ ref: `${"BCDEFGHI"[i]}3`, value: k })),
  ...[97.9, 4.1, 95.8, 24, -3.6, 61.2, 17, 100].map((v, i) => ({ ref: `${"BCDEFGHI"[i]}4`, value: v })),
  { ref: "B6", value: "KPI-6 below the 90% contractual target this period" },
];
writeFileSync(join(filesDir, "mixed-kpi-log.xlsx"), await buildXlsx([
  { name: "Daily Log", cells: mixedKpis },
]));

// ---------- manifest ----------
const manifestFiles = readdirSync(filesDir).sort().map((name) => {
  const bytes = readFileSync(join(filesDir, name));
  return { path: `files/${name}`, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
});
const gtBytes = readFileSync(join(dir, "ground-truth.json"));
const manifest = {
  benchmark: "evidence-intelligence-benchmark-v1",
  version: "1.0.0",
  frozen_at: new Date().toISOString(),
  ground_truth: { path: "ground-truth.json", sha256: createHash("sha256").update(gtBytes).digest("hex") },
  files: manifestFiles,
};
writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("fixtures written:", manifestFiles.map((f) => f.path).join(", "));
console.log("manifest.json updated");
