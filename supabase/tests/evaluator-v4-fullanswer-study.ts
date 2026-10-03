/**
 * HYBRID REVIEWER — FULL-ANSWER VALIDATION: BUILD + SCORE
 *
 *   build   takes the 24 request bodies from the locked v4 build, applies the
 *           single approved settings change (max_tokens 8000), verifies that
 *           everything else is byte-identical to the approved v3 build, scans
 *           for reference leakage, counts input tokens with the free
 *           /v1/messages/count_tokens endpoint (no generation) and writes a
 *           requests file in the calibration runner's format. The run itself is
 *           done by evaluator-v4-reviewer-pilot-v2-run.ts `run`.
 *   score   offline; reads the committed raw JSONL only. Writes the automatic
 *           score, or with --adjudication <file> the adjudicated score; both
 *           keep the automatic result visible.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-fullanswer-study.ts build
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-fullanswer-study.ts score <raw.jsonl> [--adjudication <file>]
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { type Adjudication, type RefCase, scoreCase, summarize } from "../benchmarks/evaluator-v4-proto/fullanswer-scoring";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const manifestFile = join(protoDir, "fullanswer-study-v1.json");
const manifestBytes = readFileSync(manifestFile);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const at = (p: string) => join(root, p);

function loadReference(): RefCase[] {
  const bytes = readFileSync(at(manifest.reference.file));
  if (sha(bytes) !== manifest.reference.sha256) throw new Error("reference hash mismatch");
  return JSON.parse(bytes.toString("utf8")).cases;
}

type Pkg = { id: string; body: { model: string; max_tokens: number; system: string; thinking: unknown; output_config: unknown; messages: { role: string; content: string }[] } };

async function build() {
  const refs = loadReference();
  const v4Bytes = readFileSync(at(manifest.requestSource.v4Build));
  const v3Bytes = readFileSync(at(manifest.requestSource.approvedV3Build));
  if (sha(v4Bytes) !== manifest.requestSource.v4BuildSha256 || sha(v3Bytes) !== manifest.requestSource.approvedV3BuildSha256) throw new Error("request source hash mismatch");
  const v4: Pkg[] = JSON.parse(v4Bytes.toString("utf8")).packages;
  const v3 = new Map<string, Pkg>((JSON.parse(v3Bytes.toString("utf8")).packages as Pkg[]).map((p) => [p.id, p]));
  const promptSha = manifest.reviewer.promptSha256;
  const P = manifest.reviewer.parameters;

  const problems: string[] = [];
  // `required` is a native field of evidence payloads, so it is checked structurally (allowed keys) instead of by string
  const leakTerms = ["UNDECIDABLE", "materialRequired", "\"verdict\":\"SUPPORTED\"", "referenceStatus", "rationale", "independentSources", "absorbedSpans", "previousSealed", "CONTROLLED PERTURBATION", "LOCKED"];
  const allowedKeys = "answer,caseId,receipts,referenceClock,request,sources";
  const requests = refs.map((c) => {
    const p = v4.find((x) => x.id === c.id);
    const old = v3.get(c.id);
    if (!p || !old) throw new Error(`missing package ${c.id}`);
    const same = (k: keyof Pkg["body"]) => JSON.stringify(p.body[k]) === JSON.stringify(old.body[k]);
    for (const k of ["model", "system", "thinking", "output_config", "messages"] as const) if (!same(k)) problems.push(`${c.id}: ${k} differs from approved v3 body`);
    if (sha(p.body.system) !== promptSha) problems.push(`${c.id}: prompt hash mismatch`);
    if (p.body.model !== manifest.reviewer.model) problems.push(`${c.id}: model mismatch`);
    const body = { ...p.body, max_tokens: P.max_tokens, thinking: P.thinking, output_config: P.output_config };
    const sent = body.messages[0].content;
    for (const t of leakTerms) if (sent.includes(t)) problems.push(`${c.id}: leakage term ${t}`);
    if (Object.keys(JSON.parse(sent)).sort().join(",") !== allowedKeys) problems.push(`${c.id}: unexpected input keys`);
    if (/"(temperature|top_p|top_k|budget_tokens)"/.test(JSON.stringify(body))) problems.push(`${c.id}: forbidden sampling parameter`);
    return { caseId: c.id, requestSha256: sha(JSON.stringify(body)), v3BodyWithoutMaxTokensIdentical: true, countedInputTokens: 0, body };
  });
  if (problems.length) { for (const pr of problems) console.log(`PROBLEM ${pr}`); console.error("BLOCKED: build checks failed"); process.exit(2); }

  for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  const key = process.env.VAZORA_ANTHROPIC_API_KEY;
  if (!key) { console.error("BLOCKED: VAZORA_ANTHROPIC_API_KEY not configured"); process.exit(2); }
  for (const r of requests) {
    const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: r.body.model, system: r.body.system, thinking: r.body.thinking, messages: r.body.messages }),
    });
    const text = await res.text();
    if (!res.ok) { console.error(`BLOCKED: count_tokens ${r.caseId} HTTP ${res.status} ${text.slice(0, 200)}`); process.exit(2); }
    r.countedInputTokens = (JSON.parse(text) as { input_tokens: number }).input_tokens;
  }
  const builtAt = new Date().toISOString();
  const out = {
    builtAt, generationRequests: 0,
    manifestPath: relative(root, manifestFile), manifestSha256: sha(manifestBytes),
    referenceSha256: manifest.reference.sha256, promptSha256: promptSha, model: manifest.reviewer.model,
    settings: P, limits: manifest.limits, pricing: manifest.pricing, leakageFindings: 0,
    inputTokensTotal: requests.reduce((a, r) => a + r.countedInputTokens, 0),
    requests,
  };
  const file = join(protoDir, "reports", `${builtAt.replace(/[:.]/g, "-")}-fullanswer-study-requests.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`generation requests 0 · requests ${requests.length} · leakage 0 · v3 parity OK · input ${out.inputTokensTotal}`);
  console.log(`written ${file}`);
}

function score(rawPath: string, adjPath?: string) {
  const refs = loadReference();
  const built = JSON.parse(readFileSync(rawPath.replace(/-raw\.jsonl$/, "-requests.json"), "utf8"));
  const input = new Map<string, { answer: string; sources: Record<string, unknown>; receipts: unknown }>(
    built.requests.map((r: { caseId: string; body: { messages: { content: string }[] } }) => [r.caseId, JSON.parse(r.body.messages[0].content)]),
  );
  const raw = new Map(readFileSync(rawPath, "utf8").trim().split("\n").filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.caseId, j]; }));
  const adj: Adjudication = adjPath ? JSON.parse(readFileSync(adjPath, "utf8")).units : {};
  const run = (a: Adjudication) => {
    const scores = refs.map((c) => { const i = input.get(c.id)!; return scoreCase(c, i.sources, i.receipts, i.answer, raw.get(c.id), a); });
    return { scores, summary: summarize(refs, scores) };
  };
  const automatic = run({});
  const result = adjPath ? { automatic: automatic.summary, adjudicated: run(adj).summary, adjudicationFile: adjPath, adjudicationSha256: sha(readFileSync(adjPath)), cases: run(adj).scores } : { automatic: automatic.summary, cases: automatic.scores };
  const file = rawPath.replace(/-raw\.jsonl$/, adjPath ? "-final-score.json" : "-auto-score.json");
  writeFileSync(file, JSON.stringify(result, null, 2));
  const s = adjPath ? (result as { adjudicated: ReturnType<typeof summarize> }).adjudicated : automatic.summary;
  console.log(JSON.stringify({ verdict: s.verdict, agreement: s.agreement, verdictCoverage: s.verdictCoverage, responseCompleteness: s.responseCompleteness, claimCoverage: s.claimCoverage, criteria: s.criteria, errorCounts: Object.fromEntries(Object.entries(s.errors).map(([k, v]) => [k, v.length])) }, null, 2));
  console.log(`written ${file}`);
}

const mode = process.argv[2];
if (mode === "build") build().catch((e) => { console.error(e); process.exit(1); });
else if (mode === "score" && process.argv[3]) score(process.argv[3], process.argv.includes("--adjudication") ? process.argv[process.argv.indexOf("--adjudication") + 1] : undefined);
else { console.error("usage: build | score <raw.jsonl> [--adjudication <file>]"); process.exit(2); }
