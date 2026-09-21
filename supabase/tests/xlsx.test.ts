/**
 * xlsx.test.ts — safe read-only XLSX parsing.
 * Fixtures are built in-memory with JSZip so tests exercise the real zip/XML path.
 */
import {
  cellsInRange,
  cellsMatchingExcerpt,
  colToNum,
  numToCol,
  parseA1Range,
  parseCellRef,
  parseXlsx,
  rangeProvenance,
  sheetByName,
  workbookToText,
} from "../../src/lib/evidence/xlsx";
import JSZip from "jszip";

async function main() {
  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, detail?: string) {
    if (cond) { passed++; }
    else { failed++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
  }

  const CT = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
  const ROOT_RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  function workbookXml(sheetNames: string[]) {
    const sheets = sheetNames.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    return `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
  }
  function workbookRels(sheetNames: string[]) {
    const rels = sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
    return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  }
  function sheetXml(rows: string) {
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  }
  function sstXml(strings: string[]) {
    const sis = strings.map((s) => `<si><t>${s}</t></si>`).join("");
    return `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sis}</sst>`;
  }

  async function buildXlsx(opts: {
    sheets: { name: string; rows: string }[];
    sharedStrings?: string[];
    extra?: Record<string, string>;
  }): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", CT);
    zip.file("_rels/.rels", ROOT_RELS);
    zip.file("xl/workbook.xml", workbookXml(opts.sheets.map((s) => s.name)));
    zip.file("xl/_rels/workbook.xml.rels", workbookRels(opts.sheets.map((s) => s.name)));
    if (opts.sharedStrings) zip.file("xl/sharedStrings.xml", sstXml(opts.sharedStrings));
    opts.sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));
    for (const [p, c] of Object.entries(opts.extra ?? {})) zip.file(p, c);
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }

  // ---------- coordinate helpers ----------
  check("colToNum A", colToNum("A") === 1);
  check("colToNum I", colToNum("I") === 9);
  check("colToNum AA", colToNum("AA") === 27);
  check("numToCol roundtrip", numToCol(colToNum("BC")) === "BC");
  check("parseCellRef B4", parseCellRef("B4")?.row === 4 && parseCellRef("B4")?.col === 2);
  check("parseCellRef invalid", parseCellRef("4B") === null);
  check("parseA1Range single", parseA1Range("B4")?.to.col === 2);
  check("parseA1Range range", parseA1Range("B4:I4")?.to.col === 9);
  check("parseA1Range reversed normalizes", parseA1Range("I4:B4")?.from.col === 2);

  // ---------- normal XLSX ----------
  const wb1 = await parseXlsx(
    await buildXlsx({
      sharedStrings: ["KPI", "Availability", "Monthly Report", "أداء التشغيل"],
      sheets: [{
        name: "KPI Summary",
        rows: `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>98.2</v></c></row>
               <row r="4"><c r="B4" t="s"><v>2</v></c><c r="C4"><v>42</v></c><c r="D4" t="b"><v>1</v></c><c r="E4" t="s"><v>3</v></c></row>`,
      }],
    }),
  );
  check("normal xlsx ok", wb1.ok, JSON.stringify(wb1));
  if (wb1.ok) {
    const sheet = sheetByName(wb1, "KPI Summary");
    check("sheet found", sheet !== null);
    check("missing sheet → null", sheetByName(wb1, "Nope") === null);
    check("cell count", (sheet?.cells.length ?? 0) === 7);
    check("shared string A1", sheet?.cells.find((c) => c.ref === "A1")?.value === "KPI");
    check("number C1", sheet?.cells.find((c) => c.ref === "C1")?.value === "98.2");
    check("bool D4", sheet?.cells.find((c) => c.ref === "D4")?.value === "TRUE");
    check("arabic E4", sheet?.cells.find((c) => c.ref === "E4")?.value === "أداء التشغيل");
    const range = cellsInRange(sheet!, "B4:D4");
    check("range B4:D4 → 3 cells", range.length === 3);
    const prov = rangeProvenance(sheet!, "B4:E4");
    check("provenance sheet name", prov?.sheet === "KPI Summary");
    check("provenance cells", prov?.cells === "B4:E4");
    check("provenance text contains values", prov?.text.includes('B4="Monthly Report"') === true);
    check("cellsMatchingExcerpt", cellsMatchingExcerpt(sheet!, "Availability").join(",") === "B1");
    const text = workbookToText(wb1);
    check("text has Sheet header", text.includes("Sheet: KPI Summary"));
    check("text has row serialization", text.includes('B4="Monthly Report"'));
  }

  // ---------- multiple sheets ----------
  const wb2 = await parseXlsx(
    await buildXlsx({
      sheets: [
        { name: "First", rows: `<row r="1"><c r="A1"><v>1</v></c></row>` },
        { name: "Second ورقة", rows: `<row r="1"><c r="A1"><v>2</v></c></row>` },
      ],
    }),
  );
  check("multi-sheet ok", wb2.ok);
  if (wb2.ok) {
    check("two sheets", wb2.sheets.length === 2);
    check("sheet order kept", wb2.sheets[0].name === "First" && wb2.sheets[1].name === "Second ورقة");
  }

  // ---------- formulas: cached values, never executed ----------
  const wb3 = await parseXlsx(
    await buildXlsx({
      sheets: [{
        name: "Calc",
        rows: `<row r="1">
          <c r="A1"><v>10</v></c>
          <c r="B1"><f>A1*2</f><v>20</v></c>
          <c r="C1"><f>HYPERLINK("http://evil","x")</f><v>click</v></c>
          <c r="D1"><f>SUM(A1:A9)</f></c>
        </row>`,
      }],
    }),
  );
  check("formula wb ok", wb3.ok);
  if (wb3.ok) {
    const s = wb3.sheets[0];
    check("cached formula value used", s.cells.find((c) => c.ref === "B1")?.value === "20");
    check("formula recorded not executed", s.cells.find((c) => c.ref === "B1")?.formula === "A1*2");
    check("cached flag set", s.cells.find((c) => c.ref === "B1")?.cached === true);
    check("formula without cache → empty value", s.cells.find((c) => c.ref === "D1")?.value === "");
    check("contains_formulas flag", wb3.flags.includes("contains_formulas"));
    check("uncached flag", wb3.flags.includes("formula_without_cached_value"));
  }

  // ---------- malformed ----------
  check("garbage bytes → malformed", (await parseXlsx(Buffer.from("not a zip at all"))).ok === false);
  check("empty zip → malformed", (await parseXlsx(await new JSZip().generateAsync({ type: "nodebuffer" }))).ok === false);
  const noWb = new JSZip();
  noWb.file("random.txt", "hi");
  check("zip without workbook → malformed", (await parseXlsx(await noWb.generateAsync({ type: "nodebuffer" }))).ok === false);

  // ---------- unsafe content ----------
  const macro = await parseXlsx(
    await buildXlsx({
      sheets: [{ name: "S", rows: `<row r="1"><c r="A1"><v>1</v></c></row>` }],
      extra: { "xl/vbaProject.bin": "MZ\x90\x00fake" },
    }),
  );
  check("vbaProject → unsafe_content", !macro.ok && macro.reason === "unsafe_content");

  const activeX = await parseXlsx(
    await buildXlsx({
      sheets: [{ name: "S", rows: `<row r="1"><c r="A1"><v>1</v></c></row>` }],
      extra: { "xl/activeX/activeX1.bin": "bin" },
    }),
  );
  check("activeX → unsafe_content", !activeX.ok && activeX.reason === "unsafe_content");

  const macroSheet = await parseXlsx(
    await buildXlsx({
      sheets: [{ name: "S", rows: `<row r="1"><c r="A1"><v>1</v></c></row>` }],
      extra: { "xl/macrosheets/sheet1.xml": "<worksheet/>" },
    }),
  );
  check("excel4 macro sheet → unsafe_content", !macroSheet.ok && macroSheet.reason === "unsafe_content");

  // ---------- legacy binary XLS ----------
  const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(64).fill(0)]);
  check("legacy .xls → malformed", (await parseXlsx(xls)).ok === false);

  // ---------- flagged-but-allowed ----------
  const ext = await parseXlsx(
    await buildXlsx({
      sheets: [{ name: "S", rows: `<row r="1"><c r="A1"><v>1</v></c></row>` }],
      extra: { "xl/externalLinks/externalLink1.xml": "<externalLink/>" },
    }),
  );
  check("external links → parsed + flagged", ext.ok && ext.flags.includes("external_links"));

  console.log(`\nxlsx tests: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);

}

main().catch((e) => { console.error(e); process.exit(1); });
