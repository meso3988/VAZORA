import "server-only";

import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

/**
 * Read-only XLSX parser — values and coordinates only.
 *
 * Safety contract:
 *   - .xlsx containers only (zip + workbook.xml); legacy binary XLS is
 *     rejected by the caller before reaching here.
 *   - Macros and active content are REJECTED: vbaProject, activeX,
 *     control properties, Excel-4 macro/dialog sheets.
 *   - Formulas are never executed. A cell with <f> contributes its cached
 *     <v> value and is flagged cached_formula_value so the provenance
 *     record is honest about where the number came from.
 *   - Passive-but-sensitive features (external links, connections,
 *     query tables, pivot caches) are recorded in `flags`, not loaded.
 *   - Hard caps on entries/size/sheets/cells keep hostile zip bombs
 *     and pathological workbooks from exhausting memory.
 */

export type XlsxCellType = "s" | "n" | "b" | "str" | "e" | "inline" | "empty";

export type XlsxCell = {
  ref: string;
  row: number;
  col: number;
  value: string;
  type: XlsxCellType;
  formula?: string;
  cached?: boolean;
};

export type XlsxSheet = { name: string; cells: XlsxCell[] };

export type XlsxWorkbook =
  | { ok: true; sheets: XlsxSheet[]; flags: string[] }
  | { ok: false; reason: "malformed" | "unsafe_content" | "empty" };

const MAX_ENTRIES = 512;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_SHEETS = 100;
const MAX_CELLS = 200_000;

const UNSAFE_ENTRY = /vbaProject|activeX|ctrlProps|macrosheets|dialogsheets/i;
const FLAGGED_ENTRY: [RegExp, string][] = [
  [/xl\/externalLinks\//i, "external_links"],
  [/xl\/connections\.xml/i, "data_connections"],
  [/xl\/queryTables\//i, "query_tables"],
  [/xl\/pivotCache\//i, "pivot_cache"],
];

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref);
  if (!m) return null;
  return { row: Number(m[2]), col: colToNum(m[1]) };
}

export function parseA1Range(a1: string): { from: { row: number; col: number }; to: { row: number; col: number } } | null {
  const [a, b] = a1.split(":");
  const from = a ? parseCellRef(a) : null;
  const to = b ? parseCellRef(b) : from;
  if (!from || !to) return null;
  return {
    from: { row: Math.min(from.row, to.row), col: Math.min(from.col, to.col) },
    to: { row: Math.max(from.row, to.row), col: Math.max(from.col, to.col) },
  };
}

export function sheetByName(wb: XlsxWorkbook & { ok: true }, name: string): XlsxSheet | null {
  return wb.sheets.find((s) => s.name === name) ?? null;
}

export function cellsInRange(sheet: XlsxSheet, a1: string): XlsxCell[] {
  const range = parseA1Range(a1);
  if (!range) return [];
  return sheet.cells
    .filter((c) => c.row >= range.from.row && c.row <= range.to.row && c.col >= range.from.col && c.col <= range.to.col)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

/** `Sheet: KPI Summary · Cells: B4:I4` — the provenance anchor for spreadsheets. */
export function rangeProvenance(sheet: XlsxSheet, a1: string): { sheet: string; cells: string; text: string } | null {
  const cells = cellsInRange(sheet, a1);
  if (!cells.length) return null;
  const range = parseA1Range(a1);
  const normalized = range ? `${numToCol(range.from.col)}${range.from.row}:${numToCol(range.to.col)}${range.to.row}` : a1;
  return {
    sheet: sheet.name,
    cells: normalized,
    text: `Sheet: ${sheet.name}\nCells: ${normalized}\n${cells.map((c) => `${c.ref}="${c.value}"`).join(" | ")}`,
  };
}

/** Locate cells whose value contains the (normalized) excerpt — provenance check for citations. */
export function cellsMatchingExcerpt(sheet: XlsxSheet, excerpt: string): string[] {
  const needle = excerpt.replace(/\s+/g, " ").trim().toLowerCase();
  if (needle.length < 2) return [];
  return sheet.cells.filter((c) => c.value.toLowerCase().includes(needle)).map((c) => c.ref);
}

function textOf(el: Element | null): string {
  if (!el) return "";
  return el.textContent ?? "";
}

function firstChild(el: Element, tag: string): Element | null {
  const found = el.getElementsByTagName(tag);
  return found.length ? (found.item(0) as Element) : null;
}

function doc(xml: string): Document | null {
  try {
    const d = new DOMParser().parseFromString(xml, "text/xml");
    return d.getElementsByTagName("parsererror").length ? null : d;
  } catch {
    return null;
  }
}

export async function parseXlsx(bytes: Buffer): Promise<XlsxWorkbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  if (!paths.length) return { ok: false, reason: "malformed" };
  if (paths.length > MAX_ENTRIES) return { ok: false, reason: "unsafe_content" };
  if (paths.some((p) => UNSAFE_ENTRY.test(p))) return { ok: false, reason: "unsafe_content" };

  const flags = new Set<string>();
  for (const [re, flag] of FLAGGED_ENTRY) {
    if (paths.some((p) => re.test(p))) flags.add(flag);
  }

  const read = async (path: string): Promise<string | null> => {
    const f = zip.file(path);
    if (!f) return null;
    // Refuse oversized entries BEFORE decompression — the header's declared
    // size is trustworthy enough to reject; the post-check covers lies.
    const declared = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared === "number" && declared > MAX_ENTRY_BYTES) return null;
    const text = await f.async("string");
    if (text.length > MAX_ENTRY_BYTES) return null;
    return text;
  };

  const workbookXml = await read("xl/workbook.xml");
  if (!workbookXml) return { ok: false, reason: "malformed" };
  const wb = doc(workbookXml);
  if (!wb) return { ok: false, reason: "malformed" };

  const relsXml = await read("xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  if (relsXml) {
    const rd = doc(relsXml);
    if (rd) {
      for (const rel of Array.from(rd.getElementsByTagName("Relationship"))) {
        const id = rel.getAttribute("Id");
        const target = rel.getAttribute("Target");
        const type = rel.getAttribute("Type") ?? "";
        if (/macrosheet|dialogsheet/i.test(type)) return { ok: false, reason: "unsafe_content" };
        if (id && target) rels.set(id, target);
      }
    }
  }

  const sharedStrings: string[] = [];
  const ssXml = await read("xl/sharedStrings.xml");
  if (ssXml) {
    const sd = doc(ssXml);
    if (sd) {
      for (const si of Array.from(sd.getElementsByTagName("si"))) {
        sharedStrings.push(
          Array.from(si.getElementsByTagName("t"))
            .map((t) => t.textContent ?? "")
            .join(""),
        );
      }
    }
  }

  const sheets: XlsxSheet[] = [];
  const sheetEls = Array.from(wb.getElementsByTagName("sheet"));
  if (sheetEls.length > MAX_SHEETS) return { ok: false, reason: "unsafe_content" };
  let totalCells = 0;

  for (const sheetEl of sheetEls) {
    const name = sheetEl.getAttribute("name") ?? "";
    const rid = sheetEl.getAttribute("r:id") ?? sheetEl.getAttribute("id");
    const target = rid ? rels.get(rid) : null;
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    const sheetXml = await read(path);
    // A declared-but-unreadable sheet means the workbook we hand the verifier
    // would be silently incomplete — fail closed rather than verify a subset.
    if (!sheetXml) return { ok: false, reason: "malformed" };
    const sd = doc(sheetXml);
    if (!sd) return { ok: false, reason: "malformed" };

    const cells: XlsxCell[] = [];
    for (const c of Array.from(sd.getElementsByTagName("c"))) {
      const ref = c.getAttribute("r") ?? "";
      const pos = parseCellRef(ref);
      if (!pos) continue;
      totalCells += 1;
      if (totalCells > MAX_CELLS) return { ok: false, reason: "unsafe_content" };

      const t = (c.getAttribute("t") ?? "n") as XlsxCellType;
      const fEl = firstChild(c, "f");
      const vEl = firstChild(c, "v");
      const formula = fEl ? textOf(fEl) : undefined;
      const v = vEl ? textOf(vEl) : "";

      let value = "";
      const type = t;
      switch (t) {
        case "s":
          value = sharedStrings[Number(v)] ?? "";
          break;
        case "b":
          value = v === "1" ? "TRUE" : "FALSE";
          break;
        case "inline": {
          const is = firstChild(c, "is");
          value = is
            ? Array.from(is.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("")
            : "";
          break;
        }
        case "e":
          value = v ? `#${v}` : "#ERROR";
          break;
        default:
          value = v;
      }

      let cached: boolean | undefined;
      if (formula !== undefined) {
        flags.add("contains_formulas");
        cached = v !== "";
        if (!cached) flags.add("formula_without_cached_value");
      }

      cells.push({ ref: ref.toUpperCase(), ...pos, value, type: value === "" && !formula ? "empty" : type, formula, cached });
    }
    sheets.push({ name, cells });
  }

  if (!sheets.length) return { ok: false, reason: "empty" };
  return { ok: true, sheets, flags: [...flags] };
}

/**
 * Deterministic serialization for extraction + verbatim grounding.
 * Rows are emitted as `ref="value"` pairs separated by " | " so a cited
 * range like B4:I4 has a contiguous, quoteable text form.
 */
export function workbookToText(wb: XlsxWorkbook & { ok: true }): string {
  const out: string[] = [];
  for (const sheet of wb.sheets) {
    out.push(`Sheet: ${sheet.name}`);
    const byRow = new Map<number, XlsxCell[]>();
    for (const c of sheet.cells) {
      if (c.value === "") continue;
      const row = byRow.get(c.row) ?? [];
      row.push(c);
      byRow.set(c.row, row);
    }
    for (const [row, cells] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
      const span = `${cells[0].ref}:${cells[cells.length - 1].ref}`;
      out.push(`Row ${row} (${span}) | ${cells.map((c) => `${c.ref}="${c.value}"`).join(" | ")}`);
    }
  }
  return out.join("\n");
}
