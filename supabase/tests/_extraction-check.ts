import { readFileSync } from "node:fs";
import { extractEvidenceText } from "../../src/lib/evidence/deterministic";

async function main() {
  const dir = "supabase/benchmarks/evidence-intelligence-benchmark-v1/files";
  for (const [name, mime] of [
    ["en-kpis.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["mixed-kpi-log.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["en-monthly-report.pdf", "application/pdf"],
    ["ar-report-v1.txt", "text/plain"],
    ["mixed-supervisor-note.csv", "text/csv"],
  ] as const) {
    const r = await extractEvidenceText(name, mime, readFileSync(`${dir}/${name}`));
    if (!r.ok) { console.log(`${name}: FAIL ${r.reason}`); continue; }
    const pages = r.pageOffsets.map((p) => p.page).join(",");
    console.log(`${name}: ok — ${r.text.length} chars${pages ? `, pages ${pages}` : ""}`);
    console.log(`  excerpt: ${r.text.split("\n").slice(0, 3).join(" | ").slice(0, 160)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
