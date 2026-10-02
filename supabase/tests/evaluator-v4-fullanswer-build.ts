/**
 * HYBRID REVIEWER — FULL-ANSWER VALIDATION: PACKAGE + REQUEST BUILDER
 *
 * Builds 24 full-answer packages from SAVED Officer reports only (no new
 * Officer run, no database access), applies any CONTROLLED PERTURBATION to the
 * answer text only (sources untouched), verifies every reference span and
 * source reference, and builds the exact reviewer request bodies with the
 * FROZEN reviewer configuration (reviewer-frozen-v1.json).
 *
 * With --count it also calls Anthropic's /v1/messages/count_tokens endpoint,
 * which performs no generation and is not billed. No generation request is
 * ever sent by this file.
 *
 * Run:
 *   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx \
 *     supabase/tests/evaluator-v4-fullanswer-build.ts [--count]
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const protoDir = join(here, "..", "benchmarks", "evaluator-v4-proto");
const reportsDir = join(here, "..", "benchmarks", "contract-officer-benchmark-v3", "reports");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const doCount = process.argv.includes("--count");

type Unit = { span: string; assertion: string; sourceRef?: string; verdict: string; required: boolean; referenceStatus: string };
type HistoricalContext = { key: string; receivedByOfficerAtAnswerTime: boolean; origin: string; content: string };
type Spec = { id: string; group: string; origin: string; report: string; run: number; scenario: string; locale: string; clock?: string; perturbation?: { find: string; replace: string; change: string }; units: Unit[]; historicalContext?: HistoricalContext[] };
type Trace = { tool: string; args: unknown; ok: boolean; payload: string };
type Turn = { question: string; text: string; trace: Trace[]; citations: unknown[]; actionsDelta: number; proposedActionIds: string[]; uncertainty: unknown };

// --refs=v2 selects the reference version; default v1 keeps the original build reproducible
const refsVersion = process.argv.find((a) => a.startsWith("--refs="))?.slice(7) ?? "v1";
const specFile = join(protoDir, `fullanswer-validation-${refsVersion}.references.json`);
const specBytes = readFileSync(specFile);
const spec: { study: string; cases: Spec[] } = JSON.parse(specBytes.toString("utf8"));
const frozenBytes = readFileSync(join(protoDir, "reviewer-frozen-v1.json"));
const frozen = JSON.parse(frozenBytes.toString("utf8"));
const promptPath = frozen.artifacts["prompt (system instructions + output schema)"].path.replace(/^supabase\/benchmarks\/evaluator-v4-proto\//, "");
const promptText = readFileSync(join(protoDir, promptPath), "utf8");
if (sha(promptText) !== frozen.artifacts["prompt (system instructions + output schema)"].sha256) throw new Error("frozen prompt hash mismatch");

const reportCache = new Map<string, { runs: { fixtureIdentity?: { timezone?: string; today?: string }; results: { run: number; id: string; locale: string; referenceDate?: string; turns: Turn[] }[] }[] }>();
function load(report: string) {
  if (!reportCache.has(report)) reportCache.set(report, JSON.parse(readFileSync(join(reportsDir, report), "utf8")));
  return reportCache.get(report)!;
}

function resolvePath(root: Record<string, unknown>, path: string): boolean {
  let cur: unknown = root;
  for (const p of path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[p];
    else return false;
  }
  return true;
}

const problems: string[] = [];
const packages = spec.cases.map((c) => {
  const rep = load(c.report);
  const run = rep.runs.find((r) => r.results.some((x) => x.run === c.run && x.id === c.scenario))!;
  const res = run.results.find((x) => x.run === c.run && x.id === c.scenario)!;
  if (res.turns.length !== 1) problems.push(`${c.id}: multi-turn source — conversation context must be added`);
  const t = res.turns[0];

  let answer = t.text;
  if (c.perturbation) {
    const n = answer.split(c.perturbation.find).length - 1;
    if (n !== 1) problems.push(`${c.id}: perturbation target occurs ${n} times`);
    answer = answer.replace(c.perturbation.find, c.perturbation.replace);
  }

  const sources: Record<string, unknown> = {};
  t.trace.forEach((tr, i) => {
    let result: unknown;
    try { result = JSON.parse(tr.payload); } catch { result = tr.payload; }
    sources[`t${i + 1}:${tr.tool}`] = { args: tr.args, ok: tr.ok, result };
  });
  // audit context: never a tool result; each entry states whether the Officer received it
  for (const h of c.historicalContext ?? []) {
    sources[`historical-context:${h.key}`] = { receivedByOfficerAtAnswerTime: h.receivedByOfficerAtAnswerTime, origin: h.origin, content: h.content };
  }
  const receipts = [{ turn: 1, actionsDelta: t.actionsDelta, proposedActionIds: t.proposedActionIds }];
  const tz = run.fixtureIdentity?.timezone ?? "Asia/Riyadh";
  const date = c.clock ?? res.referenceDate ?? run.fixtureIdentity?.today ?? null;
  const referenceClock = date ? `${date} (${tz})` : null;

  for (const u of c.units) {
    if (!answer.includes(u.span)) problems.push(`${c.id}: reference span not verbatim in answer: "${u.span.slice(0, 50)}"`);
    if (u.assertion === "ASSERTED" && u.sourceRef && !u.sourceRef.startsWith("(")) {
      const ok = u.sourceRef.startsWith("receipts.") ? resolvePath({ receipts }, u.sourceRef) : resolvePath(sources, u.sourceRef);
      if (!ok) problems.push(`${c.id}: reference sourceRef does not resolve: ${u.sourceRef}`);
    }
  }

  const reviewerInput = { caseId: c.id, request: t.question, referenceClock, answer, sources, receipts };
  const body = {
    model: frozen.model,
    max_tokens: frozen.settings.max_tokens,
    thinking: frozen.settings.thinking,
    output_config: frozen.settings.output_config,
    system: promptText,
    messages: [{ role: "user", content: JSON.stringify(reviewerInput) }],
  };
  return {
    id: c.id, group: c.group, origin: c.origin, locale: c.locale,
    provenance: { report: c.report, run: c.run, scenario: c.scenario },
    perturbation: c.perturbation ?? null,
    originalAnswer: c.perturbation ? t.text : undefined,
    citations: t.citations,
    package: reviewerInput,
    requestSha256: sha(JSON.stringify(body)),
    body,
    referenceUnits: c.units.length,
    requiredAssertedUnits: c.units.filter((u) => u.required && u.assertion === "ASSERTED").length,
    proposedReferenceUnits: c.units.filter((u) => u.referenceStatus.startsWith("PROPOSED")).length,
    unitOffsets: c.units.map((u) => ({ span: u.span, answerOffset: answer.indexOf(u.span) })),
    derivedCaseVerdict: caseVerdict(c.units),
  };
});

function caseVerdict(units: Unit[]): string {
  const v = units.filter((u) => u.assertion === "ASSERTED").map((u) => u.verdict);
  if (v.includes("CONTRADICTED")) return "CONTRADICTED";
  if (v.includes("INSUFFICIENT_EVIDENCE")) return "INSUFFICIENT_EVIDENCE";
  return v.length ? "SUPPORTED" : "NON_ASSERTION";
}

// leakage audit on what would be sent: no reference labels, no origin tag
const leakTerms = ["CONTROLLED PERTURBATION", "referenceStatus", "\"verdict\":\"SUPPORTED\"", "expectedVerdict", "group\":", "basisAndLimits", "correctionNote", "INDEPENDENT REVIEWER"];
for (const p of packages) {
  const sent = p.body.messages[0].content;
  for (const term of leakTerms) if (sent.includes(term)) problems.push(`${p.id}: leakage term in request: ${term}`);
  if (/"(temperature|top_p|top_k|budget_tokens)"/.test(JSON.stringify(p.body))) problems.push(`${p.id}: forbidden sampling parameter`);
}

async function count() {
  for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  const key = process.env.VAZORA_ANTHROPIC_API_KEY;
  if (!key) throw new Error("VAZORA_ANTHROPIC_API_KEY not configured");
  const counts: Record<string, number> = {};
  for (const p of packages) {
    const res = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: p.body.model, system: p.body.system, thinking: p.body.thinking, messages: p.body.messages }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`count_tokens ${p.id}: HTTP ${res.status} ${text.slice(0, 200)}`);
    counts[p.id] = (JSON.parse(text) as { input_tokens: number }).input_tokens;
  }
  return counts;
}

async function main() {
  const counts = doCount ? await count() : null;
  const builtAt = new Date().toISOString();
  const out = {
    builtAt,
    study: spec.study,
    generationRequests: 0,
    referencesSha256: sha(specBytes),
    frozenReviewerSha256: sha(frozenBytes),
    promptSha256: sha(promptText),
    model: frozen.model,
    settings: frozen.settings,
    problems,
    inputTokensCounted: counts,
    packages: packages.map((p) => ({ ...p, countedInputTokens: counts?.[p.id] ?? null })),
  };
  const file = join(protoDir, "reports", `${builtAt.replace(/[:.]/g, "-")}-fullanswer-${refsVersion}-requests.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`generation requests 0 · references ${refsVersion} · packages ${packages.length} · problems ${problems.length}`);
  for (const pr of problems) console.log(`  PROBLEM ${pr}`);
  for (const p of out.packages) {
    console.log(`  ${p.id} [${p.locale}/${p.group}/${p.origin === "HISTORICAL" ? "hist" : "PERTURB"}] units=${p.referenceUnits} required=${p.requiredAssertedUnits} proposed=${p.proposedReferenceUnits} case=${p.derivedCaseVerdict} in=${p.countedInputTokens ?? "-"} sha=${p.requestSha256.slice(0, 12)}`);
  }
  if (counts) console.log(`input tokens total ${Object.values(counts).reduce((a, b) => a + b, 0)} · max ${Math.max(...Object.values(counts))}`);
  console.log(`written ${file}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
