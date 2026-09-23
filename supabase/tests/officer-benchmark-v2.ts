/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A.1 — contract-officer-benchmark-v2 HARDENED harness.
//
// The primary truth is now a STRUCTURED FACT LEDGER: every answer is
// decomposed into typed claims, each validated against the evidence corpus
// (tool payloads the model actually saw + question + authorized context).
// Citation scoring is split into validity / relevance / claim-support.
// Tool scoring is strict precision+recall with argument matching. Action
// scenarios verify database state. Each repetition runs on a FRESH seeded
// tenant which is torn down afterwards.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-benchmark-v2.ts
//      BENCH_RUNS=3 · BENCH_VERIFY_ONLY=1 · BENCH_KEEPTENANT=1 (debug)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  BENCHMARK_VERSION, seedBenchmarkOrganization,
  teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v2/fixture";
import { EXPECTATIONS, SWEEP_EXPECTATIONS, TOOL_UNIVERSE } from "../benchmarks/contract-officer-benchmark-v2/ground-truth";
import {
  buildEntityMap, buildCorpus, extractClaims, scoreClaims, bindCitationsToClaims,
  norm,
} from "../benchmarks/contract-officer-benchmark-v2/fact-ledger";

import { validateCitations } from "../../src/lib/officer/citations";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer } from "../../src/lib/officer/converse";
import { listObservations } from "../../src/lib/officer/observations";
import { getOfficerProvider } from "../../src/lib/officer/provider";
import { runContractSweep } from "../../src/lib/officer/sweep";

const BENCH_DIR = join(root, "supabase", "benchmarks", BENCHMARK_VERSION);
const RUNS = Number(process.env.BENCH_RUNS ?? 1);
const KEEP_TENANT = process.env.BENCH_KEEPTENANT === "1";

const says = (text: string, needle: string) => norm(text).includes(norm(needle));

// ---------- DB invariant checks ----------------------------------------------

async function checkInvariant(name: string, fx: any): Promise<{ pass: boolean; detail: string }> {
  const c = fx.client;
  switch (name) {
    case "gaps_unchanged": {
      const { data } = await c.from("evidence_gaps")
        .select("id,status").eq("organization_id", fx.orgId);
      const closed = (data ?? []).filter((g: any) => g.status !== "open");
      return { pass: closed.length === 0, detail: closed.map((g: any) => g.status).join(",") };
    }
    case "obligation_due_unchanged": {
      const { data } = await c.from("contract_obligations")
        .select("id,due_date_normalized").eq("organization_id", fx.orgId);
      const expected = new Map(
        Object.values<any>(fx.contracts).map((k) => [k.obligationId, k.dueDate ?? fx.today]),
      );
      const drift = (data ?? []).filter((o: any) => {
        const want = expected.get(o.id);
        return want && o.due_date_normalized !== want;
      });
      return { pass: drift.length === 0, detail: drift.map((o: any) => o.id).join(",") };
    }
    case "no_executed_actions": {
      const { count } = await c.from("officer_actions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", fx.orgId).not("executed_at", "is", null);
      return { pass: (count ?? 0) === 0, detail: `executed=${count}` };
    }
    case "proposals_only": {
      const { data } = await c.from("officer_actions")
        .select("id,status,executed_at").eq("organization_id", fx.orgId);
      const bad = (data ?? []).filter((a: any) =>
        !["suggested", "waiting_for_approval"].includes(a.status) || a.executed_at);
      return { pass: bad.length === 0, detail: bad.map((a: any) => a.status).join(",") };
    }
    case "no_external_actions": {
      const { count } = await c.from("officer_actions")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", fx.orgId)
        .not("action_type", "like", "officer.%");
      return { pass: (count ?? 0) === 0, detail: `external=${count}` };
    }
    default:
      return { pass: false, detail: `unknown invariant ${name}` };
  }
}

/** entityKey → the citation ids that legitimately support claims about it. */
function buildEntityCitations(fx: any): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const put = (key: string, ids: (string | null | undefined)[]) =>
    m.set(key, new Set(ids.filter(Boolean) as string[]));
  for (const c of Object.values<any>(fx.contracts)) {
    const reqIds = [c.req, c.kpiReq].filter(Boolean)
      .flatMap((r: any) => [r.reqId, r.itemId, r.checkId, r.versionId]);
    put(`contract:${c.number}`, [c.contractId, c.clauseId, c.docId, c.obligationId, c.discrepancyId, ...reqIds]);
    put(`clause:${c.clauseId}`, [c.clauseId, c.contractId]);
    put(`obligation:${c.obligationId}`, [c.obligationId, c.clauseId, c.contractId, c.discrepancyId, ...reqIds]);
    for (const r of [c.req, c.kpiReq].filter(Boolean) as any[]) {
      put(`requirement:${r.reqId}`, [r.reqId, r.itemId, r.checkId, r.versionId, c.obligationId, c.contractId, c.discrepancyId]);
      if (r.itemId) put(`evidence_item:${r.itemId}`, [r.itemId, r.versionId, r.checkId, r.reqId, c.obligationId, c.discrepancyId]);
      // requirement-without-item claims bind through the requirement key
      put(`evidence_item:${r.reqId}`, [r.reqId, c.obligationId, c.contractId]);
    }
  }
  for (const e of fx.memberEmails ?? []) put(`member:${e}`, [fx.userId]);
  return m;
}

// ---------- scenario result ---------------------------------------------------

type ScenarioResult = {
  id: string; label: string; locale: string; pass: boolean;
  tools: string[]; toolErrors: string[];
  toolRecallHit: number; toolRecallTotal: number;
  unnecessaryTools: string[]; forbiddenTools: string[];
  argChecksTotal: number; argChecksPassed: number; argFailures: string[];
  claimsAsserted: number; claimsSupported: number;
  unsupportedClaims: string[];
  expectedFactsTotal: number; expectedFactsHit: number; missingFacts: string[];
  forbiddenFactsHit: string[];
  unknownExpected: boolean; unknownHonest: boolean;
  citationsValid: number; citationsRejected: number;
  citationsRelevant: number; citationsTotal: number;
  claimSupportSatisfied: number; claimSupportTotal: number;
  expectedCitationsHit: number; expectedCitationsTotal: number;
  dbInvariantResults: { name: string; pass: boolean; detail: string }[];
  changesMentioned: number; changesMentionedTotal: number; neverMentionViolations: string[];
  proposalExpected: boolean; proposalCreated: boolean; actionsDelta: number;
  mustSayMissing: string[];
  /** provider/transport failure — excluded from quality metrics */
  providerError?: boolean;
  durationMs: number; inputTokens: number; outputTokens: number;
  toolSchemasSent: number; escalated: boolean; rounds: number;
  text: string;
};

function argMatches(actual: Record<string, unknown>, expected: Record<string, unknown | unknown[]>): boolean {
  for (const [k, v] of Object.entries(expected)) {
    const a = actual[k];
    if (Array.isArray(v)) { if (!v.some((x) => x === a)) return false; }
    else if (a !== v) return false;
  }
  return true;
}

async function runOnce(runIndex: number) {
  const provider = getOfficerProvider();
  if (!provider) throw new Error("no Officer provider configured (VAZORA_OFFICER_PROVIDER)");

  const fx = await seedBenchmarkOrganization({ label: `r${runIndex}` });
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
  const baseCtx = await buildOfficerContext({
    supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en",
  });
  if (!baseCtx) throw new Error("context build failed");

  const entityMap = buildEntityMap(fx);
  const entityToIds = buildEntityCitations(fx);

  // Gap rows support the same claims as their requirement — a citation to the
  // evidence_gap is a valid support for a missing-evidence claim.
  const { data: gapRows } = await fx.client.from("evidence_gaps")
    .select("id,evidence_requirement_id,obligation_id,contract_id")
    .eq("organization_id", fx.orgId);
  const reqGapIds = new Map<string, string[]>();
  const oblGapIds = new Map<string, string[]>();
  for (const g of gapRows ?? []) {
    if (g.evidence_requirement_id) {
      reqGapIds.set(g.evidence_requirement_id, [...(reqGapIds.get(g.evidence_requirement_id) ?? []), g.id]);
    }
    if (g.obligation_id) {
      oblGapIds.set(g.obligation_id, [...(oblGapIds.get(g.obligation_id) ?? []), g.id]);
    }
    for (const key of [
      `requirement:${g.evidence_requirement_id}`,
      `obligation:${g.obligation_id}`,
      g.contract_id && `contract:${Object.values<any>(fx.contracts).find((c) => c.contractId === g.contract_id)?.number}`,
    ].filter(Boolean) as string[]) {
      entityToIds.set(key, new Set([...(entityToIds.get(key) ?? []), g.id]));
    }
  }

  // ---- deterministic sweep: EXACT expected observation set -------------------
  const sweep = await runContractSweep({ ctx: baseCtx, trigger: "manual" });
  const observations = await listObservations(baseCtx);
  const obsFor = (key: string) =>
    observations.filter((o) => o.contractId === (fx.contracts as any)[key]?.contractId);

  const sweepFindings: { check: string; pass: boolean; detail: string }[] = [];
  sweepFindings.push({
    check: "healthy-contract-silent",
    pass: obsFor(SWEEP_EXPECTATIONS.healthyContractSilent).length === 0,
    detail: obsFor("a").map((o) => o.kind).join(","),
  });
  for (const exp of SWEEP_EXPECTATIONS.mustDetect) {
    const found = obsFor(exp.contract).find((o) => o.kind === exp.kind);
    const sevOk = !exp.severity || found?.severity === exp.severity;
    const bucketOk = !exp.bucket || found?.timeBucket === exp.bucket;
    sweepFindings.push({
      check: `detect-${exp.contract}-${exp.kind}`,
      pass: !!found && sevOk && bucketOk,
      detail: found ? `${found.severity}/${found.timeBucket}` : "not found",
    });
  }
  for (const exp of SWEEP_EXPECTATIONS.mustNotDetect) {
    sweepFindings.push({
      check: `never-${exp.contract}-${exp.kind}`,
      pass: !obsFor(exp.contract).some((o) => o.kind === exp.kind),
      detail: "",
    });
  }
  // Exactness: no observation kind outside the allowed set per contract.
  for (const [key, allowed] of Object.entries(SWEEP_EXPECTATIONS.allowedKinds)) {
    const extra = obsFor(key).filter((o) => !allowed.includes(o.kind));
    sweepFindings.push({
      check: `exact-set-${key}`,
      pass: extra.length === 0,
      detail: extra.map((o) => o.kind).join(","),
    });
  }
  sweepFindings.push({
    check: "observations-all-cited",
    pass: observations.filter((o) => o.kind !== "action_waiting_for_approval").every((o) => o.citations.length > 0),
    detail: "",
  });
  sweepFindings.push({
    check: "observations-no-invented-money",
    pass: observations.every((o) =>
      !/(SAR|USD|ريال)\s?[\d,.]+/i.test(`${o.title} ${o.detail ?? ""} ${JSON.stringify(o.supportingFacts)}`)),
    detail: "",
  });
  sweepFindings.push({
    check: "bucket-integrity",
    pass: observations.every((o) =>
      (o.kind !== "overdue" || o.timeBucket === "critical") &&
      (o.status !== "resolved" || o.timeBucket === "resolved")),
    detail: "",
  });

  // ---- model scenarios --------------------------------------------------------
  const results: ScenarioResult[] = [];
  for (const exp of EXPECTATIONS) {
    const locale = exp.locale ?? "en";
    const ctx = await buildOfficerContext({
      supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale,
    });
    if (!ctx) throw new Error("ctx");
    const question = exp.question(fx);

    const beforeActions = await countActions(fx, fx.orgId);
    const outcome = await converseWithOfficer({ ctx, question, collectTrace: true });

    const blank: ScenarioResult = {
      id: exp.id, label: exp.label, locale, pass: false,
      tools: [], toolErrors: [], toolRecallHit: 0,
      toolRecallTotal: (exp.requiredTools?.length ?? 0) + (exp.requiredAny?.length ? 1 : 0),
      unnecessaryTools: [], forbiddenTools: [],
      argChecksTotal: 0, argChecksPassed: 0, argFailures: [],
      claimsAsserted: 0, claimsSupported: 0, unsupportedClaims: [],
      expectedFactsTotal: 0, expectedFactsHit: 0, missingFacts: [],
      forbiddenFactsHit: [], unknownExpected: !!exp.expectUnknown, unknownHonest: false,
      citationsValid: 0, citationsRejected: 0, citationsRelevant: 0, citationsTotal: 0,
      claimSupportSatisfied: 0, claimSupportTotal: 0,
      expectedCitationsHit: 0, expectedCitationsTotal: exp.expectedCitations?.(fx).length ?? 0,
      dbInvariantResults: [], changesMentioned: 0, changesMentionedTotal: 0,
      neverMentionViolations: [], proposalExpected: !!exp.expectProposal,
      proposalCreated: false, actionsDelta: 0, mustSayMissing: [],
      durationMs: 0, inputTokens: 0, outputTokens: 0,
      toolSchemasSent: 0, escalated: false, rounds: 0, text: "",
    };
    if (!outcome.ok) {
      // Provider outages are infrastructure failures, not model behavior —
      // flag them so metrics can exclude the scenario instead of scoring a
      // silent zero (which would fabricate a quality signal).
      blank.unsupportedClaims = [`provider_error: ${outcome.error}`];
      blank.providerError = true;
      results.push(blank);
      console.log(`FAIL  ${exp.id} ${exp.label} — ${outcome.error}`);
      continue;
    }

    const a = outcome.answer;
    const trace = outcome.trace ?? [];
    const tools = a.toolInvocations.map((t) => t.tool);
    const toolErrors = a.toolInvocations.filter((t) => !t.ok).map((t) => `${t.tool}:${t.summary}`);

    // --- tool recall / precision ---
    const allowed = new Set([
      ...(exp.requiredTools ?? []), ...(exp.requiredAny ?? []), ...(exp.optionalTools ?? []),
    ]);
    // Recall requires a SUCCESSFUL call — an attempt rejected by validation
    // does not satisfy a requirement (it still counts in toolErrors).
    const okTools = a.toolInvocations.filter((t) => t.ok).map((t) => t.tool);
    const missingRequired = (exp.requiredTools ?? []).filter((t) => !okTools.includes(t));
    const requiredAnyHit = !exp.requiredAny?.length || exp.requiredAny.some((t) => okTools.includes(t));
    const recallTotal = (exp.requiredTools?.length ?? 0) + (exp.requiredAny?.length ? 1 : 0);
    const recallHit = (exp.requiredTools?.length ?? 0) - missingRequired.length + (requiredAnyHit && exp.requiredAny?.length ? 1 : 0);
    const forbiddenTools = (exp.forbidTools ?? []).filter((t) => tools.includes(t));
    const unnecessaryTools = tools.filter((t) => !allowed.has(t) && TOOL_UNIVERSE.has(t) && !forbiddenTools.includes(t));

    // --- tool argument accuracy ---
    const argGroups = exp.expectedArgs?.(fx) ?? [];
    let argPassed = 0;
    const argFailures: string[] = [];
    for (const alternatives of argGroups) {
      const hit = alternatives.some((alt) =>
        trace.some((c: any) => c.tool === alt.tool && c.ok && argMatches(c.args as Record<string, unknown>, alt.args)));
      if (hit) argPassed++;
      else argFailures.push(alternatives.map((x) => `${x.tool}(${JSON.stringify(x.args)})`).join(" OR "));
    }

    // --- structured fact ledger ---
    const claims = extractClaims(a.text, entityMap);
    const corpus = buildCorpus({
      toolPayloads: trace.map((c: any) => ({ tool: c.tool, payload: c.payload })),
      question,
      contextValues: [fx.today, fx.email, ...(fx.memberEmails ?? []),
        ...Object.values<any>(fx.contracts).flatMap((k) => [k.number, k.title])],
      entities: entityMap,
    });
    const scored = scoreClaims(claims, corpus);
    const asserted = scored.filter((c) => c.polarity === "asserted");
    const supported = asserted.filter((c) => c.supported);
    const unsupportedClaims = scored.filter((c) => !c.supported)
      .map((c) => `${c.type} "${c.raw}" → ${c.value}${c.entityKey ? ` @${c.entityKey}` : ""}`);

    // expected facts: asserted + supported + value/entity match
    const expectedFacts = exp.expectedFacts?.(fx) ?? [];
    const missingFacts: string[] = [];
    let factsHit = 0;
    for (const f of expectedFacts) {
      const keys = f.entityKey ? [f.entityKey].flat() : null;
      const hit = asserted.some((c) =>
        c.type === f.type && c.supported &&
        (!f.value || c.value === norm(f.value)) &&
        (!keys || (c.entityKey && keys.includes(c.entityKey))));
      if (hit) factsHit++;
      else missingFacts.push(`${f.type}${f.value ? `=${f.value}` : ""}${keys ? ` @${keys.join("|")}` : ""}`);
    }
    // forbidden facts: never ASSERTED (supported or not)
    const forbiddenFacts = exp.forbiddenFacts?.(fx) ?? [];
    const forbiddenHit = forbiddenFacts
      .filter((f) => asserted.some((c) =>
        c.type === f.type &&
        (!f.value || c.value === norm(f.value)) &&
        (!f.entityKey || (c.entityKey && [f.entityKey].flat().includes(c.entityKey)))))
      .map((f) => `${f.type}${f.value ? `=${f.value}` : ""}`);

    // unknown honesty: no asserted claim of the forbidden types + honesty signal
    const expectUnknown = exp.expectUnknown ?? [];
    const unknownViolations = asserted.filter((c) => expectUnknown.includes(c.type));
    for (const v of unknownViolations) {
      unsupportedClaims.push(`unknown-asserted ${v.type} "${v.raw}"`);
    }
    const unknownHonest = expectUnknown.length === 0 ||
      (unknownViolations.length === 0 && (a.uncertainty || isHonestUnknown(a.text)));

    // --- citations: validity / relevance / claim support ---
    const revalidated = await validateCitations(ctx, a.citations.map((c) => ({ target: c.target, id: c.id })));
    const expectedCites = exp.expectedCitations?.(fx) ?? [];
    // A citation to the requirement's gap row or the obligation's gap row
    // supports the same claim — they are the same semantic entity.
    const expectedCitesHit = expectedCites.filter((e) =>
      a.citations.some((c) =>
        c.id === e.id ||
        (reqGapIds.get(e.id) ?? []).includes(c.id) ||
        (oblGapIds.get(e.id) ?? []).includes(c.id))).length;
    const claimChecks = bindCitationsToClaims(
      scored.filter((c) => c.supported),
      a.citations.map((c) => ({ target: c.target, id: c.id })),
      entityToIds,
    );
    const relevantIds = new Set<string>();
    for (const c of scored) {
      if (!c.entityKey) continue;
      for (const id of entityToIds.get(c.entityKey) ?? []) relevantIds.add(id);
    }
    for (const e of expectedCites) relevantIds.add(e.id);
    const relevantCites = a.citations.filter((c) => relevantIds.has(c.id)).length;

    // --- db invariants / side effects ---
    const dbInvariantResults: { name: string; pass: boolean; detail: string }[] = [];
    for (const name of exp.dbInvariant ?? []) {
      dbInvariantResults.push({ name, ...(await checkInvariant(name, fx)) });
    }
    const afterActions = await countActions(fx, fx.orgId);
    const actionsDelta = afterActions - beforeActions;
    const proposalCreated = actionsDelta > 0 || a.proposedActionIds.length > 0;

    // --- change set ---
    const mentionHits = (exp.expectedChanges?.mention ?? []).filter((re) => re.test(a.text)).length;
    const neverViolations = (exp.expectedChanges?.neverMention ?? []).filter((re) => re.test(a.text)).map(String);

    const mustSayMissing = (exp.mustSay?.(fx) ?? []).filter((s) => !says(a.text, s));
    const lexicalViolations = (exp.mustNotAssert?.(fx) ?? []).filter((s) => assertsClaim(a.text, s));
    unsupportedClaims.push(...lexicalViolations.map((s) => `lexical "${s}"`));

    const pass =
      missingRequired.length === 0 && requiredAnyHit &&
      forbiddenTools.length === 0 && unnecessaryTools.length === 0 &&
      argFailures.length === 0 &&
      missingFacts.length === 0 && forbiddenHit.length === 0 &&
      unsupportedClaims.length === 0 && unknownHonest &&
      revalidated.rejected.length === 0 &&
      claimChecks.every((c) => c.satisfied) &&
      expectedCitesHit === expectedCites.length &&
      dbInvariantResults.every((d) => d.pass) &&
      mentionHits === (exp.expectedChanges?.mention.length ?? 0) &&
      neverViolations.length === 0 &&
      mustSayMissing.length === 0 &&
      (!exp.expectProposal || proposalCreated) &&
      (!exp.noNewActions || actionsDelta === 0);

    results.push({
      ...blank,
      pass, tools, toolErrors,
      toolRecallHit: recallHit, toolRecallTotal: recallTotal,
      unnecessaryTools, forbiddenTools,
      argChecksTotal: argGroups.length, argChecksPassed: argPassed, argFailures,
      claimsAsserted: asserted.length, claimsSupported: supported.length,
      unsupportedClaims, expectedFactsTotal: expectedFacts.length,
      expectedFactsHit: factsHit, missingFacts, forbiddenFactsHit: forbiddenHit,
      unknownHonest,
      citationsValid: revalidated.valid.length,
      citationsRejected: revalidated.rejected.length + a.rejectedCitations.length,
      citationsRelevant: relevantCites, citationsTotal: a.citations.length,
      claimSupportSatisfied: claimChecks.filter((c) => c.satisfied).length,
      claimSupportTotal: claimChecks.length,
      expectedCitationsHit: expectedCitesHit, expectedCitationsTotal: expectedCites.length,
      dbInvariantResults, changesMentioned: mentionHits,
      changesMentionedTotal: exp.expectedChanges?.mention.length ?? 0,
      neverMentionViolations: neverViolations,
      proposalExpected: !!exp.expectProposal, proposalCreated, actionsDelta,
      mustSayMissing,
      durationMs: a.durationMs, inputTokens: a.usage.inputTokens, outputTokens: a.usage.outputTokens,
      toolSchemasSent: a.toolSchemasSent, escalated: a.escalatedToFullToolset, rounds: a.rounds,
      text: a.text.slice(0, 500),
    });

    console.log(`${pass ? "PASS" : "FAIL"}  ${exp.id} ${exp.label} [${locale}]`);
    if (missingRequired.length) console.log(`        · MISSING required tools: ${missingRequired.join(", ")}`);
    if (!requiredAnyHit) console.log(`        · none of requiredAny [${exp.requiredAny?.join(", ")}] called; got [${tools.join(", ") || "none"}]`);
    for (const t of unnecessaryTools) console.log(`        · UNNECESSARY tool: ${t}`);
    for (const t of forbiddenTools) console.log(`        · FORBIDDEN tool: ${t}`);
    for (const f of argFailures) console.log(`        · ARG mismatch: expected ${f}`);
    for (const m of missingFacts) console.log(`        · missing fact: ${m}`);
    for (const m of forbiddenHit) console.log(`        · FORBIDDEN fact asserted: ${m}`);
    for (const u of unsupportedClaims) console.log(`        · UNSUPPORTED: ${u}`);
    for (const d of dbInvariantResults.filter((x) => !x.pass)) console.log(`        · DB invariant FAIL: ${d.name} ${d.detail}`);
    for (const v of neverViolations) console.log(`        · never-mention violation: ${v}`);
    for (const m of mustSayMissing) console.log(`        · missing lexical anchor: "${m}"`);
    if (expectedCitesHit < expectedCites.length) console.log(`        · citation coverage ${expectedCitesHit}/${expectedCites.length}`);
    for (const c of claimChecks.filter((x) => !x.satisfied)) console.log(`        · claim unsupported by citation: ${c.claimEntity}`);
    if (exp.expectProposal && !proposalCreated) console.log(`        · expected an approval proposal`);
    if (exp.noNewActions && actionsDelta !== 0) console.log(`        · idempotency: actions delta ${actionsDelta} != 0`);
    if (revalidated.rejected.length) console.log(`        · INVALID citation surfaced: ${JSON.stringify(revalidated.rejected)}`);
  }

  // ---- cleanup: benchmark tenant is removed unless explicitly kept -----------
  let cleanup = { ok: true, error: null as string | null, leftovers: [] as string[] };
  if (!KEEP_TENANT) {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    cleanup = { ok: td.ok, error: td.error, leftovers: vf.leftovers };
    if (!td.ok || !vf.clean) console.log(`CLEANUP FAIL org=${fx.orgId} ${td.error} leftovers=${vf.leftovers}`);
  }

  return { fx, sweep, sweepFindings, results, observations: observations.length, cleanup };
}

async function countActions(fx: any, orgId: string): Promise<number> {
  const { count } = await fx.client
    .from("officer_actions")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId);
  return count ?? 0;
}

// ---------- retained secondary signals (phrase-level) --------------------------
const NEGATIONS = [
  "no verified record", "no record", "not recorded", "no evidence", "cannot", "can't", "could not",
  "there is no", "i have no", "do not have", "don't have", "not able", "unable",
  "لا يوجد", "لا أملك", "ليس هناك", "غير مسجل", "غير مسجّل", "لا يمكنني", "لم يُسجّل",
];
function assertsClaim(text: string, needle: string): boolean {
  const l = text.toLowerCase();
  const n = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const at = l.indexOf(n, from);
    if (at === -1) return false;
    const window = l.slice(Math.max(0, at - 70), at);
    if (!NEGATIONS.some((neg) => window.includes(neg))) return true;
    from = at + n.length;
  }
}
const UNKNOWN_PATTERNS: RegExp[] = [
  /\bno\b[^.]{0,30}\b(verified )?record/i,
  /\bnot recorded\b/i,
  /\bno\b[^.]{0,30}\b(evidence|documentation|entry|log)\b[^.]{0,20}\b(of|that|for)\b/i,
  /\b(cannot|can't|could not|unable to)\b[^.]{0,25}\b(determine|confirm|verify|find|quantif|calculat|establish)/i,
  /\bnot\b[^.]{0,20}\b(quantifiab|calculab|determinab|verifiab)/i,
  /\bno\b[^.]{0,40}\b(amount|figure|sum|exposure)\b/i,
  /\bi (do not|don't) have\b/i,
  /\bno reliable\b/i,
  /لا يوجد[^.]{0,40}(سجل|دليل|مبلغ|ما يثبت)/,
  /(لا أملك|لا يمكن(ني)?)[^.]{0,30}(تحديد|تأكيد|تقدير|إثبات)/,
  /(غير مسجّل|غير مسجل|غير قابل للتحديد|غير موثّق)/,
];
const isHonestUnknown = (text: string) => UNKNOWN_PATTERNS.some((p) => p.test(text));

// ---------- frozen manifest ----------------------------------------------------

function fingerprint() {
  const files = ["fixture.ts", "ground-truth.ts", "fact-ledger.ts"];
  return files.map((f) => {
    const buf = readFileSync(join(BENCH_DIR, f));
    return { file: f, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
  });
}

function verifyOrWriteManifest() {
  const entries = fingerprint();
  const path = join(BENCH_DIR, "manifest.json");
  const existing = (() => {
    try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
  })();
  if (existing && process.env.BENCH_REFREEZE !== "1") {
    const frozen = new Map<string, string>(
      (existing.files ?? []).map((f: any) => [f.file, f.sha256]),
    );
    const drifted = entries.filter((e) => frozen.get(e.file) !== e.sha256);
    if (drifted.length) {
      console.error("FROZEN BENCHMARK TAMPERED — refusing to run:");
      for (const d of drifted) console.error(`  ${d.file}: hash no longer matches manifest.json`);
      console.error("Cut a new benchmark version; never edit ground truth to change a score.");
      process.exit(1);
    }
    if (existing.scenarioCount !== EXPECTATIONS.length) {
      console.error(`FROZEN BENCHMARK TAMPERED — scenarioCount ${existing.scenarioCount} != ${EXPECTATIONS.length}`);
      process.exit(1);
    }
    return existing;
  }
  const manifest = {
    benchmark: BENCHMARK_VERSION,
    frozenAt: new Date().toISOString().slice(0, 10),
    scenarioCount: EXPECTATIONS.length,
    files: entries,
    note: "Ground truth is frozen. Never edit it to improve a model score — cut a new benchmark version instead.",
  };
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

// ---------- main ----------------------------------------------------------------

async function main() {
  const provider = getOfficerProvider();
  if (!provider) { console.error("FATAL: VAZORA_OFFICER_PROVIDER not configured"); process.exit(1); }
  const manifest = verifyOrWriteManifest();
  if (process.env.BENCH_VERIFY_ONLY === "1") {
    console.log(`${BENCHMARK_VERSION} manifest verified — ${manifest.files.length} frozen files intact`);
    return;
  }
  console.log(`${BENCHMARK_VERSION} · ${EXPECTATIONS.length} scenarios · ${RUNS} run(s) · fresh tenant per run`);
  console.log(`provider ${provider.id} · model ${provider.model}\n`);

  const runs: Awaited<ReturnType<typeof runOnce>>[] = [];
  for (let i = 1; i <= RUNS; i++) {
    console.log(`──── run ${i}/${RUNS} ────`);
    runs.push(await runOnce(i));
  }

  const attempted = runs.flatMap((r) => r.results);
  const providerErrors = attempted.filter((r) => r.providerError).length;
  // Quality metrics score only scenarios the provider actually answered.
  const all = attempted.filter((r) => !r.providerError);
  const sweepAll = runs.flatMap((r) => r.sweepFindings);
  const unknowns = all.filter((r) => r.unknownExpected);
  const sum = (f: (r: ScenarioResult) => number) => all.reduce((n, r) => n + f(r), 0);
  const pct = (a: number, b: number) => (b === 0 ? 1 : +(a / b).toFixed(3));

  const byId = new Map<string, boolean[]>();
  for (const r of attempted) byId.set(r.id, [...(byId.get(r.id) ?? []), r.pass]);
  const unstable = [...byId.entries()].filter(([, xs]) => new Set(xs).size > 1).map(([id]) => id);

  const dbChecks = all.flatMap((r) => r.dbInvariantResults);
  const citedScenarios = all.filter((r) => r.expectedCitationsTotal > 0);

  const metrics = {
    scenariosPassed: all.filter((r) => r.pass).length,
    scenariosTotal: all.length,
    providerErrors,
    scenarioAttempts: attempted.length,
    // structured fact ledger
    groundedFactPrecision: pct(sum((r) => r.claimsSupported), sum((r) => r.claimsAsserted)),
    groundedFactRecall: pct(sum((r) => r.expectedFactsHit), sum((r) => r.expectedFactsTotal)),
    unsupportedStructuredClaims: sum((r) => r.unsupportedClaims.length),
    forbiddenFactsAsserted: sum((r) => r.forbiddenFactsHit.length),
    unknownHonestyRate: unknowns.length ? pct(unknowns.filter((r) => r.unknownHonest).length, unknowns.length) : 1,
    financialInventions: sum((r) => r.unsupportedClaims.filter((c) => /monetary|percentage|amount/.test(c)).length),
    // citations
    citationValidity: pct(sum((r) => r.citationsValid), sum((r) => r.citationsValid + r.citationsRejected)),
    citationRelevance: pct(sum((r) => r.citationsRelevant), sum((r) => r.citationsTotal)),
    citationClaimSupport: pct(sum((r) => r.claimSupportSatisfied), sum((r) => r.claimSupportTotal)),
    citationCoverage: citedScenarios.length
      ? pct(citedScenarios.filter((r) => r.expectedCitationsHit === r.expectedCitationsTotal).length, citedScenarios.length)
      : 1,
    citationsValid: sum((r) => r.citationsValid),
    citationsRejected: sum((r) => r.citationsRejected),
    // tools
    toolRecall: pct(sum((r) => r.toolRecallHit), sum((r) => r.toolRecallTotal)),
    toolPrecision: pct(
      sum((r) => r.tools.filter((t) => !r.unnecessaryTools.includes(t) && !r.forbiddenTools.includes(t)).length),
      sum((r) => r.tools.length),
    ),
    toolArgAccuracy: pct(sum((r) => r.argChecksPassed), sum((r) => r.argChecksTotal)),
    unnecessaryToolCalls: sum((r) => r.unnecessaryTools.length),
    forbiddenToolCalls: sum((r) => r.forbiddenTools.length),
    toolErrors: sum((r) => r.toolErrors.length),
    // actions & state
    dbInvariantChecksPassed: dbChecks.filter((d) => d.pass).length,
    dbInvariantChecksTotal: dbChecks.length,
    proposalsExpected: all.filter((r) => r.proposalExpected).length,
    proposalsCreated: all.filter((r) => r.proposalExpected && r.proposalCreated).length,
    idempotencyViolations: all.filter((r) => r.actionsDelta > 0 && !r.proposalExpected).length,
    // change detection
    changeMentionRecall: pct(sum((r) => r.changesMentioned), sum((r) => r.changesMentionedTotal)),
    neverMentionViolations: sum((r) => r.neverMentionViolations.length),
    sweepChecksPassed: sweepAll.filter((s) => s.pass).length,
    sweepChecksTotal: sweepAll.length,
    sweepExactSetViolations: sweepAll.filter((s) => s.check.startsWith("exact-set-") && !s.pass).length,
    falsePositiveObservations: runs.reduce((n, r) =>
      n + (r.sweepFindings.find((s) => s.check === "healthy-contract-silent")?.pass ? 0 : 1), 0),
    // ops
    unstableScenarios: unstable,
    cleanups: runs.map((r) => r.cleanup),
    tenantsLeaked: runs.filter((r) => !r.cleanup.ok || r.cleanup.leftovers.length > 0).length,
    lexicalAnchorMisses: sum((r) => r.mustSayMissing.length),
    avgToolSchemasSent: +(sum((r) => r.toolSchemasSent) / all.length).toFixed(1),
    fullRegistryFallbackRate: +(all.filter((r) => r.escalated).length / all.length).toFixed(3),
    tokensIn: sum((r) => r.inputTokens),
    tokensOut: sum((r) => r.outputTokens),
    avgTokensInPerQuestion: Math.round(sum((r) => r.inputTokens) / all.length),
    medianLatencyMs: (() => {
      const xs = all.map((r) => r.durationMs).filter((x) => x > 0).sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
    })(),
    maxLatencyMs: Math.max(0, ...all.map((r) => r.durationMs)),
  };

  const report = {
    benchmark: BENCHMARK_VERSION, manifest,
    provider: provider.id, model: provider.model,
    runs: RUNS, ranAt: new Date().toISOString(),
    metrics,
    sweep: runs.map((r) => ({ status: r.sweep.status, created: r.sweep.created, observations: r.observations })),
    sweepFindings: sweepAll,
    scenarios: attempted,
  };
  writeFileSync(process.env.BENCH_REPORT ?? join(here, `${BENCHMARK_VERSION}-report.json`), `${JSON.stringify(report, null, 2)}\n`);

  const gate =
    metrics.providerErrors === 0 &&
    metrics.unsupportedStructuredClaims === 0 &&
    metrics.forbiddenFactsAsserted === 0 &&
    metrics.citationsRejected === 0 &&
    metrics.dbInvariantChecksPassed === metrics.dbInvariantChecksTotal &&
    metrics.idempotencyViolations === 0 &&
    metrics.tenantsLeaked === 0 &&
    metrics.sweepExactSetViolations === 0 &&
    metrics.falsePositiveObservations === 0 &&
    metrics.unsupportedStructuredClaims === 0 &&
    metrics.scenariosPassed === metrics.scenariosTotal;

  console.log(`\n──── ${BENCHMARK_VERSION} (hardened) ────`);
  console.log(`scenarios              ${metrics.scenariosPassed}/${metrics.scenariosTotal} answered (${metrics.providerErrors} provider errors excluded)`);
  console.log(`sweep checks           ${metrics.sweepChecksPassed}/${metrics.sweepChecksTotal}  exact-set violations ${metrics.sweepExactSetViolations}`);
  console.log(`fact precision/recall  ${metrics.groundedFactPrecision} / ${metrics.groundedFactRecall}`);
  console.log(`UNSUPPORTED claims     ${metrics.unsupportedStructuredClaims}  forbidden ${metrics.forbiddenFactsAsserted}  financial ${metrics.financialInventions}`);
  console.log(`unknown honesty        ${metrics.unknownHonestyRate}`);
  console.log(`citation valid/rel/sup ${metrics.citationValidity} / ${metrics.citationRelevance} / ${metrics.citationClaimSupport}  coverage ${metrics.citationCoverage}`);
  console.log(`tool recall/prec/args  ${metrics.toolRecall} / ${metrics.toolPrecision} / ${metrics.toolArgAccuracy}  unnecessary ${metrics.unnecessaryToolCalls} forbidden ${metrics.forbiddenToolCalls}`);
  console.log(`db invariants          ${metrics.dbInvariantChecksPassed}/${metrics.dbInvariantChecksTotal}  idempotency violations ${metrics.idempotencyViolations}`);
  console.log(`change mention recall  ${metrics.changeMentionRecall}  never-mention ${metrics.neverMentionViolations}`);
  console.log(`tenants leaked         ${metrics.tenantsLeaked}  unstable ${metrics.unstableScenarios.length ? metrics.unstableScenarios.join(",") : "none"}`);
  console.log(`tokens in/out          ${metrics.tokensIn}/${metrics.tokensOut}  (~${metrics.avgTokensInPerQuestion} in per question)`);
  console.log(`latency median/max     ${metrics.medianLatencyMs}ms / ${metrics.maxLatencyMs}ms`);
  console.log(gate ? "\nQUALITY GATE: PASS" : "\nQUALITY GATE: FAIL");
  if (!gate) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
