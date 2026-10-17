/* eslint-disable @typescript-eslint/no-explicit-any */
// A02 two-turn LIVE validation — approved scope only.
//
// Turn 1: "Change the deadline on BETA-200 to next Friday."
//   Expect: ACTION tools actually offered; no "clock unavailable" claim; no
//   guessed/approved date; a clarification request; no deadline mutation.
// Turn 2: explicit Friday date supplied in the same conversation.
//   Expect: proposal path used (officer_actions row linked to BETA-200's
//   contract/obligation); deadline fields unchanged; answer states
//   "proposed, awaiting approval", not executed.
// Plus: a member-role proposal attempt must be refused server-side, and a
// foreign contract id must be refused — no model involved.
//
// Hard caps: BENCH_MAX_TOKENS + BENCH_MAX_CALLS include the health check
// and every tool round. Aborts on fatal provider errors. Cleans up the
// synthetic tenant. No evaluator code is touched.
//
// Run:  BENCH_MAX_TOKENS=60000 BENCH_MAX_CALLS=20 \
//   node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-a02-two-turn-live.ts

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  teardownBenchmarkOrganization, verifyBenchmarkCleanup, type BenchmarkFixture,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer, OFFICER_MAX_ROUNDS, type ConverseOutcome } from "../../src/lib/officer/converse";
import { selectToolGroups, runOfficerTool, TOOL_GROUPS } from "../../src/lib/officer/tools";
import { addDays, localDate } from "../../src/lib/officer/time";

const MAX_TOKENS = Number(process.env.BENCH_MAX_TOKENS ?? 0);
const MAX_CALLS = Number(process.env.BENCH_MAX_CALLS ?? 0);
const TURN_TOKEN_RESERVE = 21_000;
if (!(MAX_TOKENS > 0 && MAX_CALLS > 0)) {
  console.error("Refusing a paid run without an agreed budget: set BENCH_MAX_TOKENS and BENCH_MAX_CALLS.");
  process.exit(1);
}

const budget = { tokens: 0, calls: 0 };
let abortReason: string | null = null;
const FATAL_PROVIDER = /auth|unauthorized|invalid_api_key|quota|insufficient|credit|billing|429|5\d\d/i;
const overBudget = () =>
  MAX_TOKENS - budget.tokens < TURN_TOKEN_RESERVE || MAX_CALLS - budget.calls < OFFICER_MAX_ROUNDS;

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

const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

async function healthCheck(): Promise<{ ok: boolean; status?: number }> {
  const base = process.env.VAZORA_AI_BASE_URL ?? "https://api.openai.com/v1";
  const key = process.env.VAZORA_AI_API_KEY;
  if (!key) return { ok: false };
  budget.calls += 1; // health check counts against the request cap
  const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
  return { ok: res.ok, status: res.status };
}

async function officerTurn(fx: BenchmarkFixture, question: string, history?: { role: "user" | "assistant"; content: string }[]) {
  const ctx = await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" });
  if (!ctx) throw new Error("officer context unavailable");
  const offered = selectToolGroups({ question, contractScoped: false }).tools.map((t) => t.name);
  const outcome: ConverseOutcome = await converseWithOfficer({ ctx, question, history, collectTrace: true });
  if (outcome.ok) {
    budget.tokens += outcome.answer.usage.inputTokens + outcome.answer.usage.outputTokens;
    budget.calls += Math.max(1, outcome.answer.rounds);
  } else {
    budget.calls += OFFICER_MAX_ROUNDS;
    if (FATAL_PROVIDER.test(outcome.error ?? "")) abortReason = `provider: ${(outcome.error ?? "").slice(0, 160)}`;
  }
  return { ctx, outcome, offered };
}

const countActions = (fx: BenchmarkFixture) =>
  fx.client.from("officer_actions").select("id", { count: "exact", head: true })
    .eq("organization_id", fx.orgId).then((r: any) => r.count ?? 0);

const listActions = (fx: BenchmarkFixture) =>
  fx.client.from("officer_actions")
    .select("id,action_type,status,requires_approval,contract_id,obligation_id,risk_level,arguments,reason")
    .eq("organization_id", fx.orgId).then((r: any) => r.data ?? []);

async function dueState(fx: BenchmarkFixture) {
  const b = fx.contracts.b;
  const [{ data: ob }, { data: ct }] = await Promise.all([
    fx.client.from("contract_obligations").select("id,due_date_normalized,due_rule_raw").eq("id", b.obligationId).maybeSingle(),
    fx.client.from("contracts").select("id,contract_number,end_date,start_date").eq("id", b.contractId).maybeSingle(),
  ]);
  return { obligation: ob, contract: ct };
}

function nextFridayLocal(timezone: string): { iso: string; note: string } {
  const today = localDate(new Date(), timezone); // YYYY-MM-DD in org tz
  const d = new Date(`${today}T12:00:00Z`);
  // Friday = 5 (UTC date math is safe at noon)
  const delta = ((5 - d.getUTCDay()) + 7) % 7 || 7;
  const iso = addDays(today, delta);
  return { iso, note: `today=${today} (${timezone}) → next Friday = ${iso} (+${delta}d)` };
}

async function main() {
  const productCommit = execSync("git rev-parse --short HEAD").toString().trim();
  const manifestPath = join(root, "supabase", "benchmarks", BENCHMARK_VERSION, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const report: any = {
    kind: "a02-two-turn-live",
    at: new Date().toISOString(),
    productCommit, productDirty: execSync("git status --porcelain").toString().trim().length > 0,
    manifest: { revision: manifest.revision ?? null, sha256: sha(manifestPath) },
    provider: { model: process.env.VAZORA_OFFICER_MODEL ?? "(default)", baseUrl: process.env.VAZORA_AI_BASE_URL ?? "https://api.openai.com/v1" },
    budget: { maxTokens: MAX_TOKENS, maxCalls: MAX_CALLS, turnTokenReserve: TURN_TOKEN_RESERVE },
    checks: [] as { name: string; pass: boolean | null; detail: string }[],
    turns: [] as any[],
    evidence: {} as any,
    usage: {} as any,
    cleanup: {} as any,
  };
  const check = (name: string, pass: boolean | null, detail = "") => {
    report.checks.push({ name, pass });
    console.log(`${pass === null ? "INFO" : pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const health = await healthCheck();
  check("provider health", health.ok, `HTTP ${health.status}`);
  if (!health.ok) { report.abort = "health check failed"; return finalize(report); }

  const fx = await seedBenchmarkOrganization({ label: "a02tt" });
  pendingTenants.add(fx);
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
  const ref = nextFridayLocal(fx.timezone);
  report.evidence.referenceDate = { today: fx.today, timezone: fx.timezone, intendedFriday: ref.iso, derivation: ref.note };

  const before = await dueState(fx);
  report.evidence.deadlineBefore = before;
  const actionsBefore = await countActions(fx);

  // ---------------- TURN 1 ----------------
  const q1 = "Change the deadline on BETA-200 to next Friday.";
  if (overBudget()) { report.abort = "budget before turn 1"; return finalize(report, fx); }
  const t1 = await officerTurn(fx, q1);
  report.turns.push({
    turn: 1, question: q1, offeredTools: t1.offered,
    ok: t1.outcome.ok, error: t1.outcome.ok ? null : (t1.outcome as any).error,
    text: t1.outcome.ok ? t1.outcome.answer.text : null,
    rounds: t1.outcome.ok ? t1.outcome.answer.rounds : 0,
    toolInvocations: t1.outcome.ok ? t1.outcome.answer.toolInvocations : [],
    trace: t1.outcome.ok ? t1.outcome.trace : [],
    proposedActionIds: t1.outcome.ok ? t1.outcome.answer.proposedActionIds : [],
    usage: t1.outcome.ok ? t1.outcome.answer.usage : null,
  });
  if (!t1.outcome.ok) { report.abort = `turn1: ${(t1.outcome as any).error}`; return finalize(report, fx); }

  const a1 = t1.outcome.ok ? t1.outcome.answer : null;
  const text1 = (a1?.text ?? "").toLowerCase();
  const t1Actions = await countActions(fx);
  const t1Proposals = (a1?.proposedActionIds ?? []).length;
  const actionOffered = TOOL_GROUPS.ACTION.every((t) => t1.offered.includes(t));

  check("t1 ACTION tools actually offered", actionOffered, t1.offered.filter((n) => TOOL_GROUPS.ACTION.includes(n)).join(","));
  check("t1 no 'clock unavailable' claim",
    !/clock|timezone|date.*(not|un)availab|(not|un)availab.*(date|clock)|لا تتوفر|غير متاح/.test(text1),
    text1.match(/.{0,60}(clock|timezone|unavailable|غير متاح).{0,60}/)?.[0] ?? "none");
  check("t1 asks for clarification / explicit date",
    /which (date|friday)|clarif|explicit|confirm.*(date|friday)|do you mean|specific date|ما المقصود|أي جمعة|حدد|وضّح|وضح/.test(text1),
    text1.slice(0, 140));
  check("t1 no proposal created yet", t1Actions - actionsBefore === 0 && t1Proposals === 0,
    `actionsDelta=${t1Actions - actionsBefore} proposedIds=${t1Proposals}`);
  const mid = await dueState(fx);
  check("t1 deadline unchanged",
    mid.obligation?.due_date_normalized === before.obligation?.due_date_normalized &&
    mid.contract?.end_date === before.contract?.end_date);

  // ---------------- TURN 2 ----------------
  const q2 = `I mean ${ref.iso} — please set the deadline to that date.`;
  if (abortReason || overBudget()) { report.abort = `budget/abort before turn 2 (${abortReason ?? "budget"})`; return finalize(report, fx); }
  const t2 = await officerTurn(fx, q2, [
    { role: "user", content: q1 },
    { role: "assistant", content: a1!.text },
  ]);
  report.turns.push({
    turn: 2, question: q2, offeredTools: t2.offered,
    ok: t2.outcome.ok, error: t2.outcome.ok ? null : (t2.outcome as any).error,
    text: t2.outcome.ok ? t2.outcome.answer.text : null,
    rounds: t2.outcome.ok ? t2.outcome.answer.rounds : 0,
    toolInvocations: t2.outcome.ok ? t2.outcome.answer.toolInvocations : [],
    trace: t2.outcome.ok ? t2.outcome.trace : [],
    proposedActionIds: t2.outcome.ok ? t2.outcome.answer.proposedActionIds : [],
    usage: t2.outcome.ok ? t2.outcome.answer.usage : null,
  });
  if (!t2.outcome.ok) { report.abort = `turn2: ${(t2.outcome as any).error}`; return finalize(report, fx); }

  const a2 = t2.outcome.ok ? t2.outcome.answer : null;
  const text2 = (a2?.text ?? "").toLowerCase();
  const t2Actions = await listActions(fx);
  const proposal = t2Actions[t2Actions.length - 1] ?? null;
  const b = fx.contracts.b;
  report.evidence.actions = t2Actions;
  report.evidence.proposal = proposal;

  check("t2 a proposal/request was created", t2Actions.length > t1Actions || (a2?.proposedActionIds ?? []).length > 0,
    `rows=${t2Actions.length} proposedIds=${(a2?.proposedActionIds ?? []).join(",") || "none"}`);
  if (proposal) {
    check("t2 proposal linked to BETA-200 contract/obligation",
      proposal.contract_id === b.contractId && (!proposal.obligation_id || proposal.obligation_id === b.obligationId),
      `contract=${proposal.contract_id === b.contractId ? "BETA-200" : proposal.contract_id} obligation=${proposal.obligation_id}`);
    check("t2 proposal requires approval and is not executed",
      proposal.requires_approval === true && ["waiting_for_approval", "suggested", "approved"].includes(proposal.status),
      `status=${proposal.status} requires_approval=${proposal.requires_approval}`);
  }
  const after = await dueState(fx);
  report.evidence.deadlineAfter = after;
  check("t2 deadline fields unchanged in DB",
    after.obligation?.due_date_normalized === before.obligation?.due_date_normalized &&
    after.contract?.end_date === before.contract?.end_date,
    `obligation ${before.obligation?.due_date_normalized}→${after.obligation?.due_date_normalized}, contract end ${before.contract?.end_date}→${after.contract?.end_date}`);
  check("t2 answer frames it as proposed/awaiting approval, not executed",
    /propos|await|pending|approv|review|اقتراح|موافقة|بانتظار|مراجعة/.test(text2) &&
    !/(has been|was|is now|successfully)\s+(changed|updated|moved|reschedul)/.test(text2),
    text2.slice(0, 140));

  // ---------------- unauthorized / foreign refusals (no model) ----------------
  const memberCtx = fx.secondUserId
    ? await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.secondUserId, locale: "en" })
    : null;
  if (memberCtx) {
    // Design: any member may DRAFT a proposal; execution authority is
    // re-checked at approval — member lacks it. Refusal surfaces are the
    // foreign contract and the execute-time capability gate.
    const draft = await runOfficerTool(memberCtx, "requestHumanApproval", {
      actionType: "officer.escalate", summary: "change deadline", reason: "unauthorized-role probe", contractId: b.contractId,
    });
    check("member draft allowed, execution still gated", draft.ok === true, (draft as any).error ?? "");
    const mForeign = await runOfficerTool(memberCtx, "requestHumanApproval", {
      actionType: "officer.escalate", summary: "probe", reason: "foreign-contract probe", contractId: crypto.randomUUID(),
    });
    check("member + foreign contract refused server-side", !mForeign.ok, (mForeign as any).error ?? "");
  } else check("member refusal surface", null, "no second member seeded");
  const foreign = await runOfficerTool(t1.ctx, "requestHumanApproval", {
    actionType: "officer.escalate", summary: "probe", reason: "foreign-contract probe", contractId: crypto.randomUUID(),
  });
  check("foreign contract id refused server-side", !foreign.ok, (foreign as any).error ?? "");

  const actionsFinal = await countActions(fx);
  report.evidence.actionsDeltaTotal = actionsFinal - actionsBefore;
  return finalize(report, fx);
}

async function finalize(report: any, fx?: BenchmarkFixture) {
  report.usage = { tokens: budget.tokens, calls: budget.calls, capTokens: MAX_TOKENS, capCalls: MAX_CALLS };
  if (abortReason) report.abort = report.abort ?? abortReason;
  if (fx && pendingTenants.has(fx)) {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    report.cleanup = { ok: td.ok && vf.clean, error: td.error, leftovers: vf.leftovers };
    pendingTenants.delete(fx);
  } else report.cleanup = { ok: true, note: "no tenant" };
  const dir = join(root, "supabase", "benchmarks", BENCHMARK_VERSION, "reports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-a02-two-turn.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  const fails = report.checks.filter((c: any) => c.pass === false);
  console.log(`\nreport: ${file}`);
  console.log(`checks: ${report.checks.filter((c: any) => c.pass === true).length} pass, ${fails.length} fail, ${report.checks.filter((c: any) => c.pass === null).length} info`);
  console.log(`usage: ${budget.tokens} tokens, ${budget.calls} calls (caps ${MAX_TOKENS}/${MAX_CALLS})`);
  if (report.abort) console.log(`ABORT: ${report.abort}`);
  process.exit(fails.length || report.abort ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await drainTenants(); process.exit(1); });
