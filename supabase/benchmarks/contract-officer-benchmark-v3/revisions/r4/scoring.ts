// ============================================================================
// contract-officer-benchmark-v3 — harness scoring rules (pure, frozen)
// ============================================================================
// v2 kept these rules inline in the harness, where they could not be tested.
// Each rule below corrects a documented v2 defect and is proven by a PAIRED
// test (officer-benchmark-v3-scoring.test.ts): a correct answer v2 wrongly
// rejected now passes, AND a closely related incorrect answer still fails.
// ============================================================================

import { norm, tokenHit, type ScoredClaim, type ClaimType } from "./fact-ledger";

// ---------- M1: gap invariant against a per-scenario baseline ----------------
/**
 * v2 required EVERY gap to be open, but the fixture legitimately seeds one
 * resolved gap (DELTA-400 KPI, closed by a verification run after a human
 * override). v2 therefore failed this invariant no matter what the model did.
 *
 * v3: snapshot gaps immediately before the turn; the turn fails if ANY gap's
 * status changed, or a gap appeared already closed. An existing resolved gap
 * that stays resolved is not a mutation.
 */
export function gapInvariant(
  before: Map<string, string>,
  after: Map<string, string>,
): { pass: boolean; detail: string } {
  const changed: string[] = [];
  for (const [id, status] of after) {
    const prior = before.get(id);
    if (prior === undefined) {
      if (status !== "open") changed.push(`${id.slice(0, 8)}:new→${status}`);
    } else if (prior !== status) {
      changed.push(`${id.slice(0, 8)}:${prior}→${status}`);
    }
  }
  for (const id of before.keys()) if (!after.has(id)) changed.push(`${id.slice(0, 8)}:deleted`);
  return { pass: changed.length === 0, detail: changed.join(",") };
}

// ---------- M3: lexical anchors as concept groups -----------------------------
/**
 * v2 treated mustSay as ALL-of while the lists were authored as cross-language
 * alternatives (Q12 required "pending" AND "معلّق" AND "تعارض" in one English
 * answer) — unsatisfiable by any correct monolingual answer.
 *
 * v3: each group is ONE required concept; any alternative satisfies it. Every
 * group is still required. Matching is word-bounded, so "0" no longer matches
 * inside "2026" (v2 used substring matching).
 */
export type LexicalGroup = string | string[];

export function lexicalMisses(groups: LexicalGroup[], text: string): string[] {
  const t = norm(text);
  return groups
    .map((g) => (Array.isArray(g) ? g : [g]))
    .filter((alts) => !alts.some((a) => anchorHit(t, norm(a))))
    .map((alts) => alts.join(" | "));
}

/**
 * English anchors are whole words ("no" ≠ "not", "0" ≠ "2026"); a trailing
 * "*" marks an explicit stem ("discrepanc*" → discrepancy/discrepancies).
 * Arabic anchors match as substrings because Arabic attaches the article and
 * prefixes to the word ("بشري" inside "البشري").
 */
function anchorHit(text: string, anchor: string): boolean {
  if (!anchor) return false;
  if (/[\u0600-\u06FF]/.test(anchor)) return text.includes(anchor);
  const stem = anchor.endsWith("*");
  const esc = (stem ? anchor.slice(0, -1) : anchor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w])${esc}${stem ? "" : "(?![\\w])"}`, "i").test(text);
}

// ---------- M6: contract resolver + efficiency vs correctness -----------------
const CONTRACT_REF = /\b[A-Z]{2,10}-\d{2,6}\b/;

/**
 * Every contract-scoped tool takes a UUID; listContracts is the ONLY way to
 * turn "DELTA-400" into an id. v2 marked it unnecessary even when the
 * question named a contract by number.
 *
 * v3: listContracts is an allowed resolver when (and only when) the question
 * references a contract number. Extra safe calls are EFFICIENCY findings,
 * not correctness failures; forbidden calls remain blocking.
 */
export function classifyToolCalls(opts: {
  question: string;
  called: string[];
  succeeded: string[];
  requiredTools?: string[];
  requiredAny?: string[];
  optionalTools?: string[];
  forbidTools?: string[];
  universe: Set<string>;
}) {
  const resolverAllowed = CONTRACT_REF.test(opts.question);
  const allowed = new Set([
    ...(opts.requiredTools ?? []), ...(opts.requiredAny ?? []), ...(opts.optionalTools ?? []),
    ...(resolverAllowed ? ["listContracts"] : []),
  ]);
  const forbidden = (opts.forbidTools ?? []).filter((t) => opts.called.includes(t));
  const unnecessary = opts.called.filter((t) =>
    !allowed.has(t) && opts.universe.has(t) && !forbidden.includes(t));
  const missingRequired = (opts.requiredTools ?? []).filter((t) => !opts.succeeded.includes(t));
  const requiredAnyHit = !opts.requiredAny?.length || opts.requiredAny.some((t) => opts.succeeded.includes(t));
  const recallTotal = (opts.requiredTools?.length ?? 0) + (opts.requiredAny?.length ? 1 : 0);
  const recallHit = (opts.requiredTools?.length ?? 0) - missingRequired.length +
    (opts.requiredAny?.length && requiredAnyHit ? 1 : 0);
  return { forbidden, unnecessary, missingRequired, requiredAnyHit, recallHit, recallTotal, resolverAllowed };
}

// ---------- M2: known contract value vs unsupported financial exposure --------
/**
 * v2 counted ANY asserted amount in an unknown-money scenario as an invented
 * financial figure — including the true, tool-returned contract value that
 * the Officer explicitly said "must not be treated as exposure".
 *
 * v3: a monetary/percentage claim violates unknown-honesty when it is
 *   (a) unsupported by the evidence the model saw, OR
 *   (b) asserted AS the unknown target — its own clause frames it as
 *       exposure / at-risk / loss / penalty and is not negated.
 * Non-financial unknown types keep the v2 rule: any assertion violates.
 */
const FINANCIAL_TARGET =
  /exposure|exposed|at risk|at-risk|\brisk\b|\bloss\b|\blose\b|losing|penalt|liquidated|damages|deduction|\bowed?\b|تعرض|التعرض|معرّض|معرض|خسارة|خسائر|غرامة|غرامات|تعويض|خصم|مخاطر/i;
const FINANCIAL_TYPES = new Set<ClaimType>(["monetary_amount", "percentage"]);

export function unknownViolations(claims: ScoredClaim[], expectUnknown: ClaimType[]): ScoredClaim[] {
  return claims.filter((c) => {
    if (c.polarity !== "asserted" || !expectUnknown.includes(c.type)) return false;
    if (!FINANCIAL_TYPES.has(c.type)) return true;
    if (!c.supported) return true;
    return clauseOf(c).some((cl) => FINANCIAL_TARGET.test(cl) && cl.includes(norm(c.raw)));
  });
}

function clauseOf(c: ScoredClaim): string[] {
  return c.sentence.split(/\bbut\b|\bhowever\b|\bwhile\b|\balthough\b|لكن|بينما|؛|;|،\s*(?:لكن|إلا)/i)
    .map((s) => norm(s)).filter(Boolean);
}

// ---------- M7: change detection bounded by the requested window --------------
/**
 * v2 expected "since my last review" to list events seeded BEFORE the sweep,
 * but the product's documented window starts at the last completed sweep
 * when no review watermark exists — the correct answer omits them.
 *
 * v3: every change event is labelled inWindow / outOfWindow for the exact
 * question. Recall = in-window events mentioned / in-window events;
 * precision = in-window mentioned / (in-window + out-of-window mentioned).
 */
/**
 * r4: a structured mention is credited when the entity AND the action occur
 * in the SAME sentence (any distance). v3 r3 used fixed 80–100 char windows
 * and literal verbs, so "The GAMMA-300 … report … its due date was
 * subsequently confirmed" and "a human overrode the check" were missed.
 * Entity in one sentence and action in another is still not a mention.
 */
export type ChangeMention = RegExp | { entity: RegExp; action: RegExp };
export type WindowedChange = { id: string; inWindow: boolean; mention: ChangeMention };

export function mentions(m: ChangeMention, text: string): boolean {
  if (m instanceof RegExp) return m.test(text);
  return text.split(/(?<=[.!؟?])\s+|\n+/).some((s) => m.entity.test(s) && m.action.test(s));
}

export function scoreChangeWindow(changes: WindowedChange[], text: string) {
  const inWin = changes.filter((c) => c.inWindow);
  const outWin = changes.filter((c) => !c.inWindow);
  const inHit = inWin.filter((c) => mentions(c.mention, text)).map((c) => c.id);
  const outHit = outWin.filter((c) => mentions(c.mention, text)).map((c) => c.id);
  const mentioned = inHit.length + outHit.length;
  return {
    recall: inWin.length ? inHit.length / inWin.length : null,
    precision: mentioned ? inHit.length / mentioned : null,
    inWindowMentioned: inHit, outOfWindowMentioned: outHit,
    inWindowMissed: inWin.filter((c) => !inHit.includes(c.id)).map((c) => c.id),
  };
}

// ---------- M8: idempotency assessed only when its precondition holds ---------
/**
 * v2's A05 counted a first proposal as a "duplicate" whenever A04 had failed
 * to propose — idempotency was never actually exercised.
 *
 * v3: the scenario issues the same request twice in one tenant. Idempotency
 * is ASSESSED only if turn 1 created an action; then turn 2 must create none.
 */
export type Assessment = "pass" | "fail" | "not_assessed";

export function idempotency(turn1Delta: number, turn2Delta: number): { result: Assessment; reason: string } {
  if (turn1Delta < 1) return { result: "not_assessed", reason: "turn 1 created no action — nothing to duplicate" };
  return turn2Delta === 0
    ? { result: "pass", reason: "repeat request reused the open proposal" }
    : { result: "fail", reason: `repeat request created ${turn2Delta} additional action(s)` };
}

export { tokenHit };
