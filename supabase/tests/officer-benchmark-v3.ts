/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A.2 — contract-officer-benchmark-v3 harness.
//
// Differences from v2 (v2 harness + historical report stay unchanged):
//   • provenance per run: product commit + dirty flag, evaluator commit,
//     prompt/tools/converse fingerprints, model config, manifest hash+revision
//   • full answer text AND authorized tool traces persisted → offline re-scoring
//   • failure classes: product · security · efficiency · provider/infra ·
//     evaluator · recovery retries · NOT ASSESSED
//   • scoring rules from the frozen scoring.ts (M1–M8), verdict from gate.ts
//   • MANDATORY budget (BENCH_MAX_TOKENS + BENCH_MAX_CALLS); aborts at once on
//     credit/quota/auth errors; never overwrites a report
//   • manifest revisions: refreeze requires a recorded reason and is flagged
//     when a report already exists for the current revision
//
// Run (diagnostic):  BENCH_ONLY=A01,A04 BENCH_MAX_TOKENS=200000 BENCH_MAX_CALLS=40 \
//   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v3.ts
// Run (gate):        BENCH_RUNS=3 BENCH_MAX_TOKENS=… BENCH_MAX_CALLS=… (same command)
// Offline:           BENCH_VERIFY_ONLY=1 (manifest integrity only; no provider calls)

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  BENCHMARK_VERSION, seedBenchmarkOrganization, seedWindowedChanges,
  teardownBenchmarkOrganization, verifyBenchmarkCleanup, type BenchmarkFixture,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import * as gtModule from "../benchmarks/contract-officer-benchmark-v3/ground-truth";
import { EXPECTATIONS, SWEEP_EXPECTATIONS, type Expectation } from "../benchmarks/contract-officer-benchmark-v3/ground-truth";
import * as ledgerModule from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import { buildEntityMap } from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";
import * as scoringModule from "../benchmarks/contract-officer-benchmark-v3/scoring";
import { gapInvariant, type Assessment } from "../benchmarks/contract-officer-benchmark-v3/scoring";
import {
  SECURITY_CRITERIA, CORRECTNESS_CRITERIA, BUDGET_CRITERIA, type GateVerdict,
} from "../benchmarks/contract-officer-benchmark-v3/gate";
import { scoreAnswer } from "../benchmarks/contract-officer-benchmark-v3/evaluate";

const RULES = { ledger: ledgerModule, scoring: scoringModule, gt: gtModule };

import { validateCitations } from "../../src/lib/officer/citations";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer, OFFICER_MAX_ROUNDS, type ConverseOutcome } from "../../src/lib/officer/converse";
import { listObservations } from "../../src/lib/officer/observations";
import { getOfficerProvider } from "../../src/lib/officer/provider";
import { runContractSweep } from "../../src/lib/officer/sweep";

const BENCH_DIR = join(root, "supabase", "benchmarks", BENCHMARK_VERSION);
// Scripted/plumbing runs must never land among real-model reports.
const REPORT_DIR = process.env.BENCH_REPORT_DIR ?? join(BENCH_DIR, "reports");
const HARNESS_FILE = join(here, "officer-benchmark-v3.ts");
const FROZEN_FILES = [
  "fixture.ts", "ground-truth.ts", "fact-ledger.ts", "scoring.ts", "gate.ts", "evaluate.ts",
  // r4: the frozen revision-3 rules, kept byte-identical for re-scoring
  "revisions/r3/fact-ledger.ts", "revisions/r3/scoring.ts", "revisions/r3/ground-truth.ts", "revisions/r3/gate.ts",
  // r5: the frozen revision-4 rules and scoring core, byte-identical
  "revisions/r4/fact-ledger.ts", "revisions/r4/scoring.ts", "revisions/r4/ground-truth.ts", "revisions/r4/gate.ts", "revisions/r4/evaluate.ts",
];
const RUNS = Number(process.env.BENCH_RUNS ?? 1);
const ONLY = (process.env.BENCH_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const MODE = ONLY.length || RUNS < 3 ? "diagnostic" : "gate";
const KEEP_TENANT = process.env.BENCH_KEEPTENANT === "1";
const MAX_TOKENS = Number(process.env.BENCH_MAX_TOKENS ?? 0);
const MAX_CALLS = Number(process.env.BENCH_MAX_CALLS ?? 0);
// A turn may issue up to OFFICER_MAX_ROUNDS provider requests; it only starts
// when that many requests AND the token reserve (observed v2 per-turn max
// 20,368) still fit, so a turn can never push the run past its caps.
const TURN_TOKEN_RESERVE = Number(process.env.BENCH_TURN_TOKEN_RESERVE ?? 21_000);
const FATAL_PROVIDER = /credit|quota|insufficient|billing|\b401\b|\b403\b|invalid api key|incorrect api key|unauthori[sz]ed|authentication/i;

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex");
const git = (cmd: string) => { try { return execSync(`git ${cmd}`, { cwd: root, encoding: "utf8" }).trim(); } catch { return "unavailable"; } };

// ---------- manifest (revisioned, never silent) ---------------------------------

type Manifest = {
  benchmark: string; revision: number; frozenAt: string; scenarioCount: number;
  files: { file: string; bytes: number; sha256: string }[];
  revisions: { revision: number; at: string; reason: string; afterResults: boolean }[];
  note: string;
};

function fingerprint() {
  const entries = FROZEN_FILES.map((f) => {
    const buf = readFileSync(join(BENCH_DIR, f));
    return { file: f, bytes: buf.length, sha256: sha256(buf) };
  });
  const h = readFileSync(HARNESS_FILE);
  entries.push({ file: "../../../tests/officer-benchmark-v3.ts", bytes: h.length, sha256: sha256(h) });
  return entries;
}

function reportsForRevision(rev: number): string[] {
  if (!existsSync(REPORT_DIR)) return [];
  return readdirSync(REPORT_DIR).filter((f) => f.includes(`-r${rev}-`));
}

function verifyOrReviseManifest(): Manifest {
  const path = join(BENCH_DIR, "manifest.json");
  const entries = fingerprint();
  const existing: Manifest | null = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  if (existing && process.env.BENCH_REFREEZE !== "1") {
    const frozen = new Map(existing.files.map((f) => [f.file, f.sha256]));
    const drifted = entries.filter((e) => frozen.get(e.file) !== e.sha256);
    if (drifted.length || existing.scenarioCount !== EXPECTATIONS.length) {
      console.error(`FROZEN BENCHMARK DRIFT (revision ${existing.revision}) — refusing to run:`);
      for (const d of drifted) console.error(`  ${d.file}: hash no longer matches manifest.json`);
      console.error("Record an explicit revision: BENCH_REFREEZE=1 BENCH_REVISION_REASON=\"…\"");
      process.exit(1);
    }
    return existing;
  }
  const reason = (process.env.BENCH_REVISION_REASON ?? "").trim();
  if (!reason) {
    console.error("A manifest revision requires BENCH_REVISION_REASON — silent refreezes are not allowed.");
    process.exit(1);
  }
  const revision = (existing?.revision ?? 0) + 1;
  const afterResults = existing ? reportsForRevision(existing.revision).length > 0 : false;
  if (afterResults && process.env.BENCH_REVISION_AFTER_RESULTS !== "1") {
    console.error(`Revision ${existing!.revision} already has run reports. Revising after seeing results must be`);
    console.error("explicit: set BENCH_REVISION_AFTER_RESULTS=1 (it is recorded permanently in the manifest).");
    process.exit(1);
  }
  const manifest: Manifest = {
    benchmark: BENCHMARK_VERSION, revision, frozenAt: new Date().toISOString(),
    scenarioCount: EXPECTATIONS.length, files: entries,
    revisions: [...(existing?.revisions ?? []), { revision, at: new Date().toISOString(), reason, afterResults }],
    note: "Ground truth, scoring and gate criteria are frozen. Changes require a recorded revision; never edit to improve a score.",
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest revision ${revision} recorded: ${reason}${afterResults ? " (AFTER RESULTS)" : ""}`);
  return manifest;
}

function provenance(manifest: Manifest, provider: { id: string; model: string } | null) {
  const productFiles = ["src/lib/officer/prompt.ts", "src/lib/officer/tools.ts", "src/lib/officer/converse.ts"];
  return {
    productCommit: git("rev-parse HEAD"),
    productDirty: git("status --porcelain -- src").length > 0,
    evaluatorCommit: git(`log -1 --format=%H -- supabase/benchmarks/${BENCHMARK_VERSION} supabase/tests/officer-benchmark-v3.ts`),
    evaluatorDirty: git(`status --porcelain -- supabase/benchmarks/${BENCHMARK_VERSION} supabase/tests/officer-benchmark-v3.ts`)
      .split("\n").filter((l) => l && !l.includes("/reports/")).length > 0,
    productFingerprints: Object.fromEntries(productFiles.map((f) => [f, sha256(readFileSync(join(root, f))).slice(0, 16)])),
    model: {
      provider: provider?.id ?? null, model: provider?.model ?? null,
      reasoningEffort: process.env.VAZORA_OFFICER_REASONING_EFFORT ?? null,
      baseUrl: process.env.VAZORA_AI_BASE_URL ?? null,
    },
    manifest: { revision: manifest.revision, sha256: sha256(readFileSync(join(BENCH_DIR, "manifest.json"))) },
    budget: { maxTokens: MAX_TOKENS, maxCalls: MAX_CALLS, turnTokenReserve: TURN_TOKEN_RESERVE, turnCallReserve: OFFICER_MAX_ROUNDS,
      transportRetries: process.env.VAZORA_OFFICER_MAX_RETRIES ?? "default" },
    mode: MODE, runs: RUNS, only: ONLY,
  };
}

// ---------- DB invariants ---------------------------------------------------------

async function gapSnapshot(fx: any): Promise<Map<string, string>> {
  const { data } = await fx.client.from("evidence_gaps").select("id,status").eq("organization_id", fx.orgId);
  return new Map((data ?? []).map((g: any) => [g.id as string, g.status as string]));
}

async function checkInvariant(name: string, fx: any, gapsBefore: Map<string, string>) {
  const c = fx.client;
  switch (name) {
    case "gaps_unchanged":
      return gapInvariant(gapsBefore, await gapSnapshot(fx));
    case "obligation_due_unchanged": {
      const { data } = await c.from("contract_obligations").select("id,due_date_normalized").eq("organization_id", fx.orgId);
      const expected = new Map(Object.values<any>(fx.contracts).map((k) => [k.obligationId, k.dueDate ?? fx.today]));
      const drift = (data ?? []).filter((o: any) => { const want = expected.get(o.id); return want && o.due_date_normalized !== want; });
      return { pass: drift.length === 0, detail: drift.map((o: any) => o.id).join(",") };
    }
    case "no_executed_actions": {
      const { count } = await c.from("officer_actions").select("id", { count: "exact", head: true })
        .eq("organization_id", fx.orgId).not("executed_at", "is", null);
      return { pass: (count ?? 0) === 0, detail: `executed=${count}` };
    }
    case "proposals_only": {
      const { data } = await c.from("officer_actions").select("id,status,executed_at").eq("organization_id", fx.orgId);
      const bad = (data ?? []).filter((a: any) => !["suggested", "waiting_for_approval"].includes(a.status) || a.executed_at);
      return { pass: bad.length === 0, detail: bad.map((a: any) => a.status).join(",") };
    }
    case "no_external_actions": {
      const { count } = await c.from("officer_actions").select("id", { count: "exact", head: true })
        .eq("organization_id", fx.orgId).not("action_type", "like", "officer.%");
      return { pass: (count ?? 0) === 0, detail: `non-internal=${count}` };
    }
    default:
      return { pass: false, detail: `unknown invariant ${name}` };
  }
}

async function countActions(fx: any): Promise<number> {
  const { count } = await fx.client.from("officer_actions").select("id", { count: "exact", head: true }).eq("organization_id", fx.orgId);
  return count ?? 0;
}

// ---------- citation scopes (unchanged from v2) ---------------------------------

function buildEntityCitations(fx: any): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const put = (key: string, ids: (string | null | undefined)[]) => m.set(key, new Set(ids.filter(Boolean) as string[]));
  for (const c of Object.values<any>(fx.contracts)) {
    const reqIds = [c.req, c.kpiReq].filter(Boolean).flatMap((r: any) => [r.reqId, r.itemId, r.checkId, r.versionId]);
    put(`contract:${c.number}`, [c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqIds]);
    put(`clause:${c.clauseId}`, [c.clauseId, c.docId]);
    put(`obligation:${c.obligationId}`, [c.obligationId, c.clauseId, c.discrepancyId, ...reqIds]);
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      put(`requirement:${r.reqId}`, [r.reqId, r.itemId, r.checkId, r.versionId, c.obligationId, c.discrepancyId]);
      if (r.itemId) put(`evidence_item:${r.itemId}`, [r.itemId, r.versionId, r.checkId, r.reqId, c.obligationId, c.discrepancyId]);
      put(`evidence_item:${r.reqId}`, [r.reqId, c.obligationId]);
    }
  }
  for (const e of fx.memberEmails ?? []) put(`member:${e}`, [fx.userId]);
  return m;
}

function buildCitationFamilies(fx: any, gapRows: any[]): Map<string, Set<string>> {
  const fam = new Map<string, Set<string>>();
  const add = (id: string | null | undefined, ...ids: (string | null | undefined)[]) => {
    if (!id) return;
    fam.set(id, new Set([id, ...(fam.get(id) ?? []), ...(ids.filter(Boolean) as string[])]));
  };
  for (const c of Object.values<any>(fx.contracts)) {
    const reqItems: string[] = [];
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      const rIds = [r.reqId, r.itemId, r.checkId, r.versionId, r.runId].filter(Boolean) as string[];
      reqItems.push(...rIds);
      add(r.reqId, r.itemId, r.checkId, r.versionId, r.runId);
      for (const x of rIds) if (x !== r.reqId) add(x, r.reqId);
    }
    add(c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqItems);
    add(c.obligationId, c.clauseId, c.discrepancyId, ...reqItems);
    add(c.clauseId, c.docId);
    if (c.discrepancyId) add(c.discrepancyId, c.obligationId);
  }
  for (const g of gapRows) {
    add(g.id);
    add(g.evidence_requirement_id, g.id);
    add(g.obligation_id, g.id);
    if (g.contract_id) {
      const c = Object.values<any>(fx.contracts).find((x) => x.contractId === g.contract_id);
      if (c) add(c.contractId, g.id);
    }
  }
  return fam;
}

// ---------- scenario result -------------------------------------------------------

type Status = "answered" | "provider_error" | "provider_abort" | "infra_error" | "evaluator_error" | "budget_stop";

type ScenarioResult = {
  run: number; id: string; label: string; locale: string; status: Status;
  correctnessPass: boolean | null;
  productFailures: string[]; securityFailures: string[]; efficiencyFindings: string[];
  notAssessed: string[]; infraRetries: number; error?: string;
  metrics: Record<string, number | boolean | null>;
  assessments: Record<string, Assessment>;
  turns: { question: string; text: string; trace: unknown[]; citations: unknown[]; toolInvocations: unknown[];
           usage: { inputTokens: number; outputTokens: number }; rounds: number; durationMs: number; actionsDelta: number;
           uncertainty?: boolean; proposedActionIds?: string[]; rejectedCitations?: unknown[] }[];
  /** r4: citations the server removed before disclosure, with whether the id was in tool results */
  blockedCitations?: { id?: string; reason?: string; idSeenInToolResults: boolean | null }[];
};

// ---------- budget / fatal provider --------------------------------------------

const budget = { tokens: 0, calls: 0, callsUpperBound: false };
let abortReason: string | null = null;
/** true when the NEXT turn could exceed either cap in the worst case */
const overBudget = () =>
  MAX_TOKENS - budget.tokens < TURN_TOKEN_RESERVE || MAX_CALLS - budget.calls < OFFICER_MAX_ROUNDS;

async function officerTurn(fx: any, locale: "en" | "ar", question: string, retries: { n: number }) {
  let ctx = null as Awaited<ReturnType<typeof buildOfficerContext>>;
  for (let attempt = 1; attempt <= 4 && !ctx; attempt++) {
    ctx = await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale });
    if (!ctx) { retries.n++; await new Promise((r) => setTimeout(r, 1500 * attempt)); }
  }
  if (!ctx) return { ctx: null, outcome: null as ConverseOutcome | null };
  const outcome = await converseWithOfficer({ ctx, question, collectTrace: true });
  if (outcome.ok) {
    // completion tokens already include any billed reasoning tokens
    budget.tokens += outcome.answer.usage.inputTokens + outcome.answer.usage.outputTokens;
    budget.calls += Math.max(1, outcome.answer.rounds);
  } else {
    // A failed turn hides how many rounds ran: count the worst case.
    budget.calls += OFFICER_MAX_ROUNDS;
    budget.callsUpperBound = true;
    if (FATAL_PROVIDER.test(outcome.error)) abortReason = `provider: ${outcome.error.slice(0, 160)}`;
  }
  return { ctx, outcome };
}

// ---------- tenant drain (unchanged from v2) --------------------------------------
const pendingTenants = new Set<BenchmarkFixture>();
let draining = false;
async function drainTenants() {
  if (draining) return;
  draining = true;
  for (const fx of [...pendingTenants]) {
    try {
      const td = await teardownBenchmarkOrganization(fx);
      const vf = await verifyBenchmarkCleanup(fx);
      if (!td.ok || !vf.clean) console.error(`CLEANUP FAIL org=${fx.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",")}`);
    } catch (e) { console.error(`CLEANUP THREW org=${fx.orgId}: ${e}`); }
    pendingTenants.delete(fx);
  }
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => { drainTenants().finally(() => process.exit(sig === "SIGINT" ? 130 : 143)); });
}
process.once("uncaughtException", (e) => { console.error(e); drainTenants().finally(() => process.exit(1)); });

// ---------- one scenario ------------------------------------------------------------

async function scoreScenario(
  run: number, exp: Expectation, fx: any, env: {
    entityMap: ReturnType<typeof buildEntityMap>; entityToIds: Map<string, Set<string>>; families: Map<string, Set<string>>;
  },
): Promise<ScenarioResult> {
  const locale = exp.locale ?? "en";
  const question = exp.question(fx);
  const base: ScenarioResult = {
    run, id: exp.id, label: exp.label, locale, status: "answered", correctnessPass: null,
    productFailures: [], securityFailures: [], efficiencyFindings: [], notAssessed: [], infraRetries: 0,
    metrics: {}, assessments: {}, turns: [],
  };
  if (abortReason) return { ...base, status: "provider_abort", notAssessed: ["scenario"], error: abortReason };
  if (overBudget()) return { ...base, status: "budget_stop", notAssessed: ["scenario"], error: "budget reached before scenario" };

  const gapsBefore = await gapSnapshot(fx);
  const retries = { n: 0 };
  const turnCount = exp.repeatTurns ?? 1;
  const deltas: number[] = [];
  let first: { ctx: any; outcome: ConverseOutcome } | null = null;
  for (let t = 0; t < turnCount; t++) {
    const before = await countActions(fx);
    const { ctx, outcome } = await officerTurn(fx, locale, question, retries);
    base.infraRetries = retries.n;
    if (!ctx || !outcome) return { ...base, status: "infra_error", notAssessed: ["scenario"], error: "officer context unavailable after retries" };
    if (!outcome.ok) {
      return { ...base, status: FATAL_PROVIDER.test(outcome.error) ? "provider_abort" : "provider_error", notAssessed: ["scenario"], error: outcome.error.slice(0, 300) };
    }
    const delta = (await countActions(fx)) - before;
    deltas.push(delta);
    base.turns.push({
      question, text: outcome.answer.text, trace: outcome.trace ?? [], citations: outcome.answer.citations,
      toolInvocations: outcome.answer.toolInvocations, usage: outcome.answer.usage,
      rounds: outcome.answer.rounds, durationMs: outcome.answer.durationMs, actionsDelta: delta,
      uncertainty: outcome.answer.uncertainty, proposedActionIds: outcome.answer.proposedActionIds,
      rejectedCitations: outcome.answer.rejectedCitations,
    });
    if (t === 0) first = { ctx, outcome };
    if (t + 1 < turnCount && (abortReason || overBudget())) break;
  }

  try {
    return await evaluate(base, exp, fx, env, first!.ctx, first!.outcome as Extract<ConverseOutcome, { ok: true }>, question, gapsBefore);
  } catch (e) {
    return { ...base, status: "evaluator_error", correctnessPass: null, notAssessed: ["scenario"], error: `evaluator: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function evaluate(
  r: ScenarioResult, exp: Expectation, fx: any,
  env: { entityMap: ReturnType<typeof buildEntityMap>; entityToIds: Map<string, Set<string>>; families: Map<string, Set<string>> },
  ctx: any, outcome: Extract<ConverseOutcome, { ok: true }>, question: string,
  gapsBefore: Map<string, string>,
): Promise<ScenarioResult> {
  const a = outcome.answer;
  // Live-only facts: citation re-validation, the server's blocked list, DB state.
  const revalidated = await validateCitations(ctx, a.citations.map((c) => ({ target: c.target, id: c.id })));
  const dbInvariants: { name: string; pass: boolean; detail: string }[] = [];
  for (const name of exp.dbInvariant ?? []) dbInvariants.push({ name, ...(await checkInvariant(name, fx, gapsBefore)) });
  const s = scoreAnswer({
    mods: RULES, exp, fx, question, turns: r.turns as any, env, r4: true,
    live: {
      displayedInvalid: revalidated.rejected, displayedValidCount: revalidated.valid.length,
      blocked: a.rejectedCitations.map((b: any) => ({ id: b.id, target: b.target, reason: b.reason })),
      dbInvariants, orgId: fx.orgId,
    },
  });
  r.productFailures.push(...s.productFailures);
  r.securityFailures.push(...s.securityFailures);
  r.efficiencyFindings.push(...s.efficiencyFindings);
  r.notAssessed.push(...s.notAssessed);
  Object.assign(r.assessments, s.assessments);
  r.blockedCitations = s.blockedDetail;
  r.correctnessPass = s.correctnessPass;
  r.metrics = {
    ...s.metrics,
    inputTokens: r.turns.reduce((n, t) => n + t.usage.inputTokens, 0),
    outputTokens: r.turns.reduce((n, t) => n + t.usage.outputTokens, 0),
    durationMs: r.turns[0]?.durationMs ?? 0,
  };
  return r;
}

// ---------- one run -----------------------------------------------------------------

async function runOnce(run: number) {
  const fx = await seedBenchmarkOrganization({ label: `v3r${run}` });
  if (!KEEP_TENANT) pendingTenants.add(fx);
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
  const baseCtx = await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" });
  if (!baseCtx) throw new Error("context build failed");

  const entityMap = buildEntityMap(fx);
  const entityToIds = buildEntityCitations(fx);
  const { data: gapRows } = await fx.client.from("evidence_gaps").select("id,evidence_requirement_id,obligation_id,contract_id").eq("organization_id", fx.orgId);
  const families = buildCitationFamilies(fx, gapRows ?? []);
  for (const g of gapRows ?? []) {
    for (const key of [`requirement:${g.evidence_requirement_id}`, `obligation:${g.obligation_id}`,
      g.contract_id && `contract:${Object.values<any>(fx.contracts).find((c) => c.contractId === g.contract_id)?.number}`,
    ].filter(Boolean) as string[]) entityToIds.set(key, new Set([...(entityToIds.get(key) ?? []), g.id]));
  }

  // deterministic sweep — exact expected observation set (unchanged from v2)
  const sweep = await runContractSweep({ ctx: baseCtx, trigger: "manual" });
  const observations = await listObservations(baseCtx);
  const obsFor = (key: string) => observations.filter((o) => o.contractId === (fx.contracts as any)[key]?.contractId);
  const sweepFindings: { check: string; pass: boolean; detail: string }[] = [];
  sweepFindings.push({ check: "healthy-contract-silent", pass: obsFor(SWEEP_EXPECTATIONS.healthyContractSilent).length === 0, detail: obsFor("a").map((o) => o.kind).join(",") });
  for (const e of SWEEP_EXPECTATIONS.mustDetect) {
    const found = obsFor(e.contract).find((o) => o.kind === e.kind);
    sweepFindings.push({ check: `detect-${e.contract}-${e.kind}`, pass: !!found && (!e.severity || found.severity === e.severity) && (!e.bucket || found.timeBucket === e.bucket), detail: found ? `${found.severity}/${found.timeBucket}` : "not found" });
  }
  for (const e of SWEEP_EXPECTATIONS.mustNotDetect) sweepFindings.push({ check: `never-${e.contract}-${e.kind}`, pass: !obsFor(e.contract).some((o) => o.kind === e.kind), detail: "" });
  for (const [key, allowed] of Object.entries(SWEEP_EXPECTATIONS.allowedKinds)) {
    const extra = obsFor(key).filter((o) => !allowed.includes(o.kind));
    sweepFindings.push({ check: `exact-set-${key}`, pass: extra.length === 0, detail: extra.map((o) => o.kind).join(",") });
  }

  // M7 — windowed change events AFTER the sweep
  await new Promise((r) => setTimeout(r, 1500));
  await seedWindowedChanges(fx);

  const results: ScenarioResult[] = [];
  for (const exp of EXPECTATIONS.filter((e) => !ONLY.length || ONLY.includes(e.id))) {
    const res = await scoreScenario(run, exp, fx, { entityMap, entityToIds, families });
    results.push(res);
    const tag = res.status !== "answered" ? res.status.toUpperCase() : res.correctnessPass ? "PASS" : "FAIL";
    console.log(`${tag.padEnd(15)} r${run} ${exp.id} ${exp.label} [${res.locale}]`);
    for (const f of res.securityFailures) console.log(`        · SECURITY ${f}`);
    for (const f of res.productFailures) console.log(`        · ${f}`);
    for (const f of res.efficiencyFindings) console.log(`        · (efficiency) ${f}`);
    for (const n of res.notAssessed) console.log(`        · NOT ASSESSED ${n}`);
    if (res.error) console.log(`        · ${res.error}`);
    if (abortReason) { console.log(`ABORT — ${abortReason}`); break; }
    if (overBudget()) console.log(`BUDGET REACHED — tokens ${budget.tokens}/${MAX_TOKENS} calls ${budget.calls}/${MAX_CALLS}`);
  }

  let cleanup = { ok: true, error: null as string | null, leftovers: [] as string[] };
  if (!KEEP_TENANT) {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    cleanup = { ok: td.ok, error: td.error, leftovers: vf.leftovers };
    if (td.ok && vf.clean) pendingTenants.delete(fx);
    else console.log(`CLEANUP FAIL org=${fx.orgId} ${td.error} leftovers=${vf.leftovers}`);
  }
  // r4: persist the synthetic tenant's identity (ids/labels only — no client,
  // no password) so saved answers can be re-scored offline without guessing.
  const { client: _client, password: _password, ...identity } = fx as any;
  void _client; void _password;
  return { sweep: { status: sweep.status, created: sweep.created }, sweepFindings, results, cleanup, fixtureIdentity: identity };
}

// ---------- aggregation + gate -----------------------------------------------------

function aggregate(runs: Awaited<ReturnType<typeof runOnce>>[]) {
  const all = runs.flatMap((r) => r.results);
  const answered = all.filter((r) => r.status === "answered");
  const sum = (k: string) => answered.reduce((n, r) => n + (Number(r.metrics[k]) || 0), 0);
  const ratio = (a: number, b: number) => (b === 0 ? null : +(a / b).toFixed(3));
  const unknowns = answered.filter((r) => r.metrics.unknownExpected);
  const proposals = answered.filter((r) => r.metrics.proposalExpected);
  const idem = answered.map((r) => r.assessments.idempotency).filter(Boolean) as Assessment[];
  const changeRuns = answered.filter((r) => r.metrics.changeRecall !== null && r.metrics.changeRecall !== undefined);
  const byId = new Map<string, boolean[]>();
  for (const r of answered) byId.set(r.id, [...(byId.get(r.id) ?? []), !!r.correctnessPass]);

  const m = {
    scenarioRuns: all.length, answered: answered.length,
    statusCounts: all.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] ?? 0) + 1 }), {} as Record<string, number>),
    infraRetries: all.reduce((n, r) => n + r.infraRetries, 0),
    scenarioCorrectnessPassRate: ratio(answered.filter((r) => r.correctnessPass).length, answered.length),
    groundedFactPrecision: ratio(sum("claimsSupported"), sum("claimsAsserted")),
    groundedFactRecall: ratio(sum("expectedFactsHit"), sum("expectedFactsTotal")),
    unsupportedStructuredClaims: sum("unsupportedClaims"),
    forbiddenFactsAsserted: sum("forbiddenFacts"),
    unknownHonestyRate: ratio(unknowns.filter((r) => r.metrics.unknownHonest).length, unknowns.length),
    financialInventions: sum("financialInventions"),
    citationValidity: ratio(sum("citationsValid"), sum("citationsValid") + sum("citationsRejected")),
    citationsRejected: sum("citationsRejected"),
    // r4 — citation outcomes reported separately
    invalidCitationsProposed: sum("invalidCitationsProposed"),
    blockedBeforeDisclosure: sum("blockedBeforeDisclosure"),
    unsupportedCitationsDisplayed: sum("unsupportedCitationsDisplayed"),
    unauthorizedDisclosures: sum("unauthorizedDisclosures"),
    unauthorizedReads: answered.some((r) => r.metrics.unauthorizedReads === null || r.metrics.unauthorizedReads === undefined)
      ? null : sum("unauthorizedReads"),
    citationClaimSupport: ratio(sum("claimSupportSatisfied"), sum("claimSupportTotal")),
    citationCoverage: ratio(answered.filter((r) => Number(r.metrics.expectedCitationsTotal) > 0 && r.metrics.expectedCitationsHit === r.metrics.expectedCitationsTotal).length,
      answered.filter((r) => Number(r.metrics.expectedCitationsTotal) > 0).length),
    citationRelevance: ratio(sum("citationsRelevant"), sum("citationsTotal")),
    toolRecall: ratio(sum("toolRecallHit"), sum("toolRecallTotal")),
    toolPrecision: ratio(sum("toolCalls") - sum("unnecessaryTools") - sum("forbiddenTools"), sum("toolCalls")),
    toolArgAccuracy: ratio(sum("argChecksPassed"), sum("argChecksTotal")),
    unnecessaryToolCalls: sum("unnecessaryTools"),
    forbiddenToolCalls: sum("forbiddenTools"),
    dbChecksPassed: sum("dbChecksPassed"), dbChecksTotal: sum("dbChecksTotal"),
    unauthorizedDbMutations: sum("dbChecksTotal") - sum("dbChecksPassed"),
    proposalSuccess: ratio(proposals.filter((r) => r.metrics.proposalCreated && !r.productFailures.some((f) => f.startsWith("arg mismatch"))).length, proposals.length),
    idempotency: { assessed: idem.filter((x) => x !== "not_assessed").length, passed: idem.filter((x) => x === "pass").length, failed: idem.filter((x) => x === "fail").length, notAssessed: idem.filter((x) => x === "not_assessed").length },
    changeRecall: changeRuns.length ? +(changeRuns.reduce((n, r) => n + Number(r.metrics.changeRecall), 0) / changeRuns.length).toFixed(3) : null,
    changePrecision: (() => { const p = changeRuns.filter((r) => r.metrics.changePrecision !== null); return p.length ? +(p.reduce((n, r) => n + Number(r.metrics.changePrecision), 0) / p.length).toFixed(3) : null; })(),
    tenantsLeaked: runs.filter((r) => !r.cleanup.ok || r.cleanup.leftovers.length > 0).length,
    sweepChecksPassed: runs.flatMap((r) => r.sweepFindings).filter((s) => s.pass).length,
    sweepChecksTotal: runs.flatMap((r) => r.sweepFindings).length,
    unstableScenarios: [...byId.entries()].filter(([, xs]) => new Set(xs).size > 1).map(([id]) => id),
    tokensIn: sum("inputTokens"), tokensOut: sum("outputTokens"),
    avgInputTokensPerScenario: answered.length ? Math.round(sum("inputTokens") / answered.length) : null,
    medianLatencyMs: (() => { const xs = answered.map((r) => Number(r.metrics.durationMs)).filter((x) => x > 0).sort((p, q) => p - q); return xs.length ? xs[Math.floor(xs.length / 2)] : null; })(),
    maxLatencyMs: answered.length ? Math.max(...answered.map((r) => Number(r.metrics.durationMs))) : null,
    modelCalls: budget.calls,
    failureClasses: {
      product: answered.filter((r) => r.productFailures.length).length,
      security: answered.filter((r) => r.securityFailures.length).length,
      efficiencyOnly: answered.filter((r) => r.efficiencyFindings.length && r.correctnessPass).length,
      providerOrInfra: all.filter((r) => ["provider_error", "provider_abort", "infra_error"].includes(r.status)).length,
      evaluator: all.filter((r) => r.status === "evaluator_error").length,
      budgetStops: all.filter((r) => r.status === "budget_stop").length,
    },
  };
  return m;
}

function verdict(m: ReturnType<typeof aggregate>): { verdict: GateVerdict | "DIAGNOSTIC"; reasons: string[]; notAssessed: string[] } {
  const reasons: string[] = [];
  const notAssessed: string[] = [];
  const need = (name: string, value: number | null, ok: (v: number) => boolean, blocking = true) => {
    if (value === null) { if (blocking) notAssessed.push(name); return; }
    if (!ok(value)) reasons.push(`${name}=${value}`);
  };
  need("forbiddenToolCalls", m.forbiddenToolCalls, (v) => v <= SECURITY_CRITERIA.forbiddenToolCalls);
  need("unauthorizedDbMutations", m.unauthorizedDbMutations, (v) => v <= SECURITY_CRITERIA.unauthorizedDbMutations);
  need("unauthorizedDisclosures", m.unauthorizedDisclosures, (v) => v <= SECURITY_CRITERIA.unauthorizedDisclosures);
  need("unauthorizedReads", m.unauthorizedReads, (v) => v <= SECURITY_CRITERIA.unauthorizedReads);
  need("tenantsLeaked", m.tenantsLeaked, (v) => v <= SECURITY_CRITERIA.tenantsLeaked);
  need("financialInventions", m.financialInventions, (v) => v <= SECURITY_CRITERIA.financialInventions);
  need("forbiddenFactsAsserted", m.forbiddenFactsAsserted, (v) => v <= SECURITY_CRITERIA.forbiddenFactsAsserted);
  need("scenarioCorrectnessPassRate", m.scenarioCorrectnessPassRate, (v) => v >= CORRECTNESS_CRITERIA.scenarioCorrectnessPassRate);
  need("unsupportedStructuredClaims", m.unsupportedStructuredClaims, (v) => v <= CORRECTNESS_CRITERIA.unsupportedStructuredClaims);
  need("unknownHonestyRate", m.unknownHonestyRate, (v) => v >= CORRECTNESS_CRITERIA.unknownHonestyRate);
  need("citationClaimSupport", m.citationClaimSupport, (v) => v >= CORRECTNESS_CRITERIA.citationClaimSupport);
  need("citationCoverage", m.citationCoverage, (v) => v >= CORRECTNESS_CRITERIA.citationCoverage);
  need("toolRecall", m.toolRecall, (v) => v >= CORRECTNESS_CRITERIA.toolRecall);
  need("toolArgAccuracy", m.toolArgAccuracy, (v) => v >= CORRECTNESS_CRITERIA.toolArgAccuracy);
  need("proposalSuccess", m.proposalSuccess, (v) => v >= CORRECTNESS_CRITERIA.proposalSuccess);
  need("idempotencyViolations", m.idempotency.assessed ? m.idempotency.failed : null, (v) => v <= CORRECTNESS_CRITERIA.idempotencyViolations);
  need("changeRecall", m.changeRecall, (v) => v >= CORRECTNESS_CRITERIA.changeRecall);
  need("changePrecision", m.changePrecision, (v) => v >= CORRECTNESS_CRITERIA.changePrecision);
  need("avgInputTokensPerScenario", m.avgInputTokensPerScenario, (v) => v <= BUDGET_CRITERIA.maxAvgInputTokensPerScenario);
  if (m.failureClasses.providerOrInfra || m.failureClasses.evaluator || m.failureClasses.budgetStops) {
    notAssessed.push(`${m.failureClasses.providerOrInfra} provider/infra, ${m.failureClasses.evaluator} evaluator, ${m.failureClasses.budgetStops} budget-stopped scenario-runs`);
  }
  if (MODE !== "gate") return { verdict: "DIAGNOSTIC", reasons, notAssessed };
  if (reasons.length) return { verdict: "FAIL", reasons, notAssessed };
  return { verdict: notAssessed.length ? "INCOMPLETE" : "PASS", reasons, notAssessed };
}

// ---------- main -------------------------------------------------------------------

async function main() {
  const manifest = verifyOrReviseManifest();
  if (process.env.BENCH_VERIFY_ONLY === "1") {
    console.log(`${BENCHMARK_VERSION} revision ${manifest.revision} verified — ${manifest.files.length} frozen files intact`);
    return;
  }
  const provider = getOfficerProvider();
  if (!provider) { console.error("FATAL: VAZORA_OFFICER_PROVIDER not configured"); process.exit(1); }
  if (!(MAX_TOKENS > 0 && MAX_CALLS > 0)) {
    console.error("Refusing a paid run without an agreed budget: set BENCH_MAX_TOKENS and BENCH_MAX_CALLS.");
    process.exit(1);
  }
  // Hidden transport retries would be real requests the budget cannot see.
  if (process.env.VAZORA_OFFICER_MAX_RETRIES !== "0") {
    console.error("Refusing a paid run with transport retries enabled: set VAZORA_OFFICER_MAX_RETRIES=0 so every request is counted.");
    process.exit(1);
  }
  const prov = provenance(manifest, provider);
  console.log(`${BENCHMARK_VERSION} r${manifest.revision} · ${MODE} · ${RUNS} run(s) · ${ONLY.length ? ONLY.join(",") : "all"} scenarios`);
  console.log(`provider ${provider.id} · model ${provider.model} · product ${prov.productCommit.slice(0, 8)}${prov.productDirty ? "+dirty" : ""} · evaluator ${prov.evaluatorCommit.slice(0, 8)}${prov.evaluatorDirty ? "+dirty" : ""}`);
  console.log(`budget ≤ ${MAX_TOKENS} tokens, ≤ ${MAX_CALLS} model calls\n`);

  const runs: Awaited<ReturnType<typeof runOnce>>[] = [];
  try {
    for (let i = 1; i <= RUNS && !abortReason && !overBudget(); i++) {
      console.log(`──── run ${i}/${RUNS} ────`);
      runs.push(await runOnce(i));
    }
  } finally {
    await drainTenants();
  }

  const metrics = aggregate(runs);
  const gate = verdict(metrics);
  mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(REPORT_DIR, `${stamp}-r${manifest.revision}-${MODE}.json`);
  writeFileSync(reportPath, `${JSON.stringify({
    benchmark: BENCHMARK_VERSION, provenance: prov, ranAt: new Date().toISOString(), abortReason,
    budgetUsed: budget, metrics, gate, runs,
  }, null, 2)}\n`, { flag: "wx" });

  console.log(`\n──── ${BENCHMARK_VERSION} r${manifest.revision} (${MODE}) ────`);
  console.log(JSON.stringify(metrics, null, 2));
  console.log(`\nreport: ${reportPath}`);
  console.log(`VERDICT: ${gate.verdict}`);
  for (const r of gate.reasons) console.log(`  failed: ${r}`);
  for (const n of gate.notAssessed) console.log(`  NOT ASSESSED: ${n}`);
  if (abortReason) { console.log(`ABORTED: ${abortReason}`); process.exitCode = 2; }
  else if (gate.verdict !== "PASS") process.exitCode = 1;
}

// Offline re-scoring of a saved v3 report is intentionally NOT implemented as
// a silent path: it requires the tenant's citation re-validation and DB state,
// which no longer exist after teardown. Saved traces allow re-running the
// PURE ledger/scoring rules; anything needing live state is NOT ASSESSED.

main().catch(async (e) => { console.error(e); await drainTenants(); process.exit(1); });
