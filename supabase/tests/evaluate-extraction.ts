// VAZORA Phase-2B evaluator — TS entry (loaded with tsx so `"server-only"`
// stub applied by harness-cjs-preload.cjs applies to TS too).
import { extractChunkValidated } from "../../src/lib/ingestion/extractor";
import { testFixtureProvider } from "../../src/lib/ingestion/test-fixture-provider";
import { parseDocumentBytes } from "../../src/lib/ingestion/parser";
import { segmentDocument } from "../../src/lib/ingestion/segment";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");

const BENCHES = ["bench-ar-om", "bench-en-svc", "bench-mixed-dc"] as const;

type GT = {
  benchmark: string;
  language: string;
  files: string[];
  obligations: {
    clause: string;
    requirement: string;
    frequency: string | null;
    due_rule: string | null;
    evidence: string[];
    payment_linked: boolean | null;
    financial: string | null;
    external_dependency: string | null;
    submission: { destination: string; channel: string; deadline_rule: string } | null;
    owner_role: string | null;
  }[];
};

const norm = (s: string | null | undefined) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
const eq = (a: unknown, b: unknown) => norm(a as string) === norm(b as string);

const main = async () => {
  console.log("VAZORA extraction evaluation\n");
  console.log("Mode: TEST FIXTURE — deterministic provider, not a live model.\n");

  const results: unknown[] = [];
  let totalTime = 0;

  for (const id of BENCHES) {
    const gt = JSON.parse(readFileSync(join(fixtures, `${id}.ground-truth.json`), "utf8")) as GT;
    const first = gt.files[0];
    const bytes = readFileSync(join(fixtures, first));
    const parsed = await parseDocumentBytes(first, bytes);
    const segments = segmentDocument(parsed);

    const t0 = Date.now();
    const result = await extractChunkValidated(testFixtureProvider, {
      organizationId: "bench",
      contractId: `${id}-qa`,
      contractTitle: id,
      chunk: {
        chunkIndex: 0,
        documentIds: [first],
        documentNames: [first],
        segments: segments.map((x) => ({ clauseNumber: x.clauseNumber, heading: x.heading, text: x.text, pageNumber: x.pageNumber })),
      },
    });
    const elapsed = Date.now() - t0;
    totalTime += elapsed;

    if (!result.ok) {
      results.push({ bench: id, fatal: result.error });
      continue;
    }

    let recall = 0, sourceOk = 0;
    const fields: Record<string, [number, number]> = {
      frequency: [0, 0],
      due_rule: [0, 0],
      evidence_count: [0, 0],
      evidence_names: [0, 0],
      payment_link: [0, 0],
      financial: [0, 0],
      external_dep: [0, 0],
      submission: [0, 0],
    };
    const hallucinations: string[] = [];

    for (const expected of gt.obligations) {
      const got = result.obligations.find((o) =>
        expected.clause === o.source_clause_number ||
        norm(o.title).includes(norm(expected.requirement).slice(0, 20)),
      );
      if (!got) continue;
      recall += 1;
      if (eq(got.source_clause_number, expected.clause)) sourceOk += 1;

      if (got.frequency && expected.frequency && eq(got.frequency, expected.frequency)) fields.frequency[0] += 1;
      fields.frequency[1] += 1;
      if (got.due_rule_normalized && expected.due_rule && eq(got.due_rule_normalized, expected.due_rule)) fields.due_rule[0] += 1;
      fields.due_rule[1] += 1;
      if (got.evidence_requirements.length === expected.evidence.length) fields.evidence_count[0] += 1;
      fields.evidence_count[1] += 1;
      if (expected.evidence.every((n) => got.evidence_requirements.some((e) => norm(e.name).includes(norm(n).slice(0, 8))))) fields.evidence_names[0] += 1;
      fields.evidence_names[1] += 1;
      const payOk = got.payment_linked === null && expected.payment_linked === null ? true : got.payment_linked === expected.payment_linked;
      if (payOk) fields.payment_link[0] += 1;
      fields.payment_link[1] += 1;
      if ((got.financial_condition !== null) === (expected.financial !== null)) fields.financial[0] += 1;
      fields.financial[1] += 1;
      if ((got.external_dependency !== null) === (expected.external_dependency !== null)) fields.external_dep[0] += 1;
      fields.external_dep[1] += 1;
      if ((got.submission_required === true) === (expected.submission !== null)) fields.submission[0] += 1;
      fields.submission[1] += 1;
    }

    for (const got of result.obligations) {
      const known = gt.obligations.some((e) => norm(got.source_snippet).includes(norm(e.requirement).slice(0, 20)));
      if (!known) hallucinations.push(got.title);
    }

    results.push({
      bench: id,
      files: gt.files.length,
      extracted: result.obligations.length,
      recall: `${recall}/${gt.obligations.length}`,
      source_accuracy: `${sourceOk}/${gt.obligations.length}`,
      field_accuracy: Object.fromEntries(Object.entries(fields).map(([k, [a, b]]) => [k, `${a}/${b}`])),
      hallucinations: hallucinations.length,
      duration_ms: elapsed,
      tokens: null,
      note: "TEST-FIXTURE — deterministic provider, not a live model",
    });
  }

  console.log(JSON.stringify(results, null, 2));

  const broken = results.filter((r) => (r as { fatal?: unknown; hallucinations?: number }).fatal || ((r as { hallucinations?: number }).hallucinations ?? 0) > 0);
  if (broken.length) {
    console.error("HARNESS SANITY FAILED:", broken.map((b) => (b as { bench: string }).bench).join(", "));
    process.exitCode = 1;
    return;
  }
  console.log(`\nTotal: ${totalTime}ms across ${BENCHES.length} benchmarks`);
  console.log("HARNESS SANITY PASSED — pipeline deterministic against fixture ground truth.");
};

void main();
