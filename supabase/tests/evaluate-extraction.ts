// VAZORA — extraction evaluation harness (live + test-fixture capabilities)
//
// Run:
//   # TEST FIXTURE (default, no live AI needed)
//   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/evaluate-extraction.ts
//
//   # LIVE MODEL
//   VAZORA_EVAL_LIVE=1 VAZORA_EXTRACTION_PROVIDER=openai-compat \
//   VAZORA_EXTRACTION_MODEL=gpt-4o-mini VAZORA_AI_API_KEY=sk-... \
//   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/evaluate-extraction.ts
//
// Output clearly prefixes TEST FIXTURE vs LIVE MODEL. Fixture reports are
// labeled and never pretend to be live. No API keys are committed; config is
// read from env only — never echoed.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractChunkValidated, getExtractionProvider } from "../../src/lib/ingestion/extractor";
import { hardenExtraction, dedupeAcross } from "../../src/lib/ingestion/harden";
import { testFixtureProvider } from "../../src/lib/ingestion/test-fixture-provider";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const BENCH_VERSION = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")).benchmark_version;

type GT = {
  benchmark: string;
  language: "ar" | "en" | "mixed";
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
  addendumConflict?: { mainClause: string; requirement: string; addendumDueRule: string }[];
};

const norm = (s: string | null | undefined) => (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");
const eq = (a: unknown, b: unknown) => norm(a as string) === norm(b as string);
const has = (v: unknown) => v !== null && v !== undefined && v !== "";

const BENCHES = ["bench-ar-om", "bench-en-svc", "bench-mixed-dc"];

interface EvalChoice {
  id: string;
  model: string;
  live: boolean;
  provider: ReturnType<typeof getExtractionProvider>;
}

const IS_LIVE = process.env.VAZORA_EVAL_LIVE === "1";
const REPEATS = Math.max(1, Number(process.env.VAZORA_EVAL_REPEATS ?? 1));

async function main() {
  let choice: EvalChoice;
  if (!IS_LIVE) {
    choice = { id: "test-fixture", model: "fixture/ground-truth", live: false, provider: testFixtureProvider };
  } else {
    await import("../../src/lib/ingestion/openai-compat");
    await import("../../src/lib/ingestion/anthropic");
    await import("../../src/lib/ingestion/gemini");
    const p = getExtractionProvider();
    if (!p) {
      console.error("LIVE MODE requires VAZORA_EXTRACTION_PROVIDER + VAZORA_AI_API_KEY. Configure and retry.");
      process.exit(2);
    }
    choice = { id: p.id, model: p.model, live: true, provider: p };
  }

  console.log(`VAZORA extraction evaluation — ${choice.live ? "LIVE MODEL" : "TEST FIXTURE"} mode`);
  console.log(`Provider: ${choice.id} · Model: ${choice.model} · Benchmark: ${BENCH_VERSION} · Repeats: ${REPEATS}`);
  console.log("—".repeat(60));

  for (const id of BENCHES) {
    await evalBench(id, choice.provider as NonNullable<typeof choice.provider>, choice.live);
  }
}

async function evalBench(id: string, provider: NonNullable<ReturnType<typeof getExtractionProvider>>, live: boolean) {
  const gt = JSON.parse(readFileSync(join(fixtures, `${id}.ground-truth.json`), "utf8")) as GT;

  // per-repeat aggregate
  let recallOk = 0, sourceOk = 0, sourceMiss = 0, sourceWrong = 0, hallucinations = 0;
  let freqOk = 0, dueOk = 0, evCountEq = 0, evNamesOk = 0, payOk = 0, finOk = 0, extOk = 0, subOk = 0;
  let conflictSeen = 0;
  let durationMs = 0, inTokens = 0, outTokens = 0, failures = 0;
  const unstable = new Set<string>();
  let prevSig = "";

  for (let rep = 0; rep < REPEATS; rep++) {
    const t0 = Date.now();
    const variantResults: (Awaited<ReturnType<typeof extractChunkValidated>> & { _docId?: string })[] = [];

    for (const file of gt.files) {
      const bytes = readFileSync(join(fixtures, file));
      const parsed = await (await import("../../src/lib/ingestion/parser")).parseDocumentBytes(file, bytes);
      const segments = (await import("../../src/lib/ingestion/segment")).segmentDocument(parsed);
      const chunkModule = await import("../../src/lib/ingestion/segment");
      for (const chunk of chunkModule.chunkSegments(segments)) {
        const res = await extractChunkValidated(provider, {
          organizationId: "bench",
          contractId: `${id}-eval-${rep}`,
          contractTitle: id,
          chunk: {
            chunkIndex: rep * 100 + chunk[0].sequence,
            documentIds: [file],
            documentNames: [file],
            segments: chunk.map((x) => ({ clauseNumber: x.clauseNumber, heading: x.heading, text: x.text, pageNumber: x.pageNumber })),
          },
        });
        variantResults.push(Object.assign(res, { _docId: file }));
      }
    }
    durationMs += Date.now() - t0;

    // flatten + harden (same as the real pipeline)
    const oks = variantResults.filter((v): v is Extract<typeof v, { ok: true }> => v.ok);
    failures += variantResults.length - oks.length;
    for (const v of variantResults) {
      if (v.ok) {
        inTokens += v.usage?.inputTokens ?? 0;
        outTokens += v.usage?.outputTokens ?? 0;
      } else {
        hallucinations += 0; // failure ≠ hallucination; failure is counted in `failures`
      }
    }

    // Build clause pool for source validation, and apply the hardened gate + dedupe.
    const clauseTextsAll: { text: string; clauseNumber: string | null; documentId: string }[] = [];
    for (const file of gt.files) {
      const bytes = readFileSync(join(fixtures, file));
      const parsed = await (await import("../../src/lib/ingestion/parser")).parseDocumentBytes(file, bytes);
      const segs = (await import("../../src/lib/ingestion/segment")).segmentDocument(parsed);
      for (const s of segs) clauseTextsAll.push({ documentId: file, clauseNumber: s.clauseNumber, text: s.text });
    }

    const hardened: { extraction: import("../../src/lib/ingestion/schema").ObligationExtraction; documentId: string }[] = [];
    let rejectedByGate = 0;
    for (const v of oks) {
      for (const ob of v.obligations) {
        const h = hardenExtraction({ extraction: ob, documentId: v._docId ?? gt.files[0], clauseTexts: clauseTextsAll });
        if (h) hardened.push({ extraction: h, documentId: v._docId ?? gt.files[0] });
        else rejectedByGate += 1;
      }
    }
    const deduped = dedupeAcross(hardened);
    const observations = deduped.map((d) => d.extraction);

    console.error(`  [${id}] gate: rejected=${rejectedByGate} kept=${deduped.length}`);
    // dedupe across chunks by requirement text.
    const seenReq = new Set<string>();
    const unique = observations.filter((o) => {
      const k = norm(o.title) + "|" + norm(o.requirement_text);
      if (seenReq.has(k)) return false;
      seenReq.add(k);
      return true;
    });

    let runRecall = 0, runSrc = 0;
    for (const expected of gt.obligations) {
      const got = unique.find((o) =>
        (has(o.source_clause_number) && eq(o.source_clause_number, expected.clause)) ||
        norm(o.requirement_text).includes(norm(expected.requirement).slice(0, 24)),
      );
      if (!got) continue;
      runRecall += 1;
      if (has(got.source_clause_number)) {
        if (eq(got.source_clause_number, expected.clause)) runSrc += 1;
        else sourceWrong += 1;
      } else sourceMiss += 1;

      if (has(got.frequency) && has(expected.frequency) && eq(got.frequency, expected.frequency)) freqOk += 1;
      if (has(got.due_rule_normalized) && has(expected.due_rule) && eq(got.due_rule_normalized, expected.due_rule)) dueOk += 1;
      if (got.evidence_requirements.length === expected.evidence.length) evCountEq += 1;
      if (expected.evidence.every((n) => got.evidence_requirements.some((e) => norm(e.name).includes(norm(n).slice(0, 8))))) evNamesOk += 1;
      if ((got.payment_linked ?? null) === (expected.payment_linked ?? null) || (got.payment_linked === null && expected.payment_linked === null)) payOk += 1;
      if ((got.financial_condition !== null) === (expected.financial !== null)) finOk += 1;
      if ((got.external_dependency !== null) === (expected.external_dependency !== null)) extOk += 1;
      if ((got.submission_required === true) === (expected.submission !== null)) subOk += 1;
    }
    recallOk += runRecall;
    sourceOk += runSrc;

    // hallucination audit
    hallucinations += unique.filter((o) =>
      !gt.obligations.some((e) => norm(o.source_snippet).includes(norm(e.requirement).slice(0, 24))),
    ).length;

    // conflict
    if (gt.addendumConflict?.length) {
      const variant = unique.find((o) => o.due_rule_normalized === gt.addendumConflict![0].addendumDueRule);
      if (variant) conflictSeen += 1;
    }

    // consistency signature
    const sig = unique
      .map((o) => `${norm(o.title)}|${norm(o.frequency)}|${norm(o.due_rule_normalized)}|${o.evidence_requirements.length}`)
      .sort()
      .join(";");
    if (prevSig && sig !== prevSig) {
      prevSig.split(";").forEach((v, i) => {
        if (sig.split(";")[i] !== v) unstable.add(`run-variance@${i}`);
      });
    }
    prevSig = sig;
  }

  const N = gt.obligations.length * REPEATS || 1;
  const usageNote = inTokens || outTokens ? ` in=${inTokens} out=${outTokens}` : " (no usage metadata)";

  console.log(`\n${id} — ${live ? "LIVE" : "TEST FIXTURE"}`);
  console.log(`  recall           ${recallOk}/${N}`);
  console.log(`  source accuracy  ${sourceOk}/${N} (missing ${sourceMiss / REPEATS >= 0 ? Math.round(sourceMiss) : 0}, wrong ${sourceWrong})`);
  console.log(`  hallucinations   ${hallucinations}`);
  console.log(`  freq      ${freqOk}/${N} | due ${dueOk}/${N} | evid.count ${evCountEq}/${N} | evid.names ${evNamesOk}/${N}`);
  console.log(`  pay-link  ${payOk}/${N} | financial ${finOk}/${N} | ext-dep ${extOk}/${N} | submission ${subOk}/${N}`);
  console.log(`  conflict detected (when addendum modifies due rule): ${conflictSeen}/${REPEATS}`);
  if (unstable.size) console.log(`  instability markers: ${[...unstable].slice(0, 5).join(", ")}`);
  console.log(`  schema failures  ${failures}`);
  console.log(`  duration total   ${(durationMs / 1000).toFixed(1)}s (${(durationMs / REPEATS / 1000).toFixed(1)}s per run)`);
  console.log(`  usage           ${usageNote}`);
}

main().catch((e) => { console.error("evaluate failed:", e); process.exit(1); });
