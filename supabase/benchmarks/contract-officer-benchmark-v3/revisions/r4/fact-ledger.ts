/* eslint-disable @typescript-eslint/no-explicit-any */
// ============================================================================
// fact-ledger — deterministic structured-claim evaluation
// ============================================================================
// Instead of scanning prose for forbidden phrases, every benchmark answer is
// decomposed into typed factual claims. Each claim is then validated against
// the EVIDENCE CORPUS — the serialized tool payloads the model actually saw,
// plus the question and the authorized context (clock, fixture identity).
//
// A claim with no corpus support is an unsupported operational claim. This is
// the primary truth metric — prose pattern lists are retained only as a
// secondary signal.
//
// Deterministic: no LLM judge is involved anywhere in this file.
//
// v3 corrections (each proven by a paired test in officer-benchmark-v3-scoring):
//   M4  "pending verification" → pending, "pending (human) review" → needs_review
//   M5a "Schedule 6 may apply" is not the date 6 May
//   M5b "owner role", "المسؤول المؤكد عن" are not person names
//   Q/A a clause attributed to the user ("you mentioned…") is QUOTED, not asserted
//   M2  "SAR 1,000,000.00" normalizes to 1000000 (decimals are not digits)
//
// r4 corrections (paired tests in officer-benchmark-v3-r4.test.ts):
//   G   an open gap alone supports "open gap", never a specific absence;
//       typed causes decide (gap_type missing_evidence → "missing";
//       partial_evidence → "incomplete"); "not submitted" needs an explicit
//       no-submission state; awaiting verification ≠ pending human review
//   F   boolean state flags count (unassigned: true); absent fields do not
//   N   negation is scoped to the ": " segment holding the match
//   T   truncated results: only fully visible objects give entity-bound support
//   A   activity events support claims about the recorded change, never
//       current-state claims
//   D   "1 pending verification discrepancy" = a pending discrepancy (not
//       evidence awaiting verification)
//   C   a contract-number claim is supported when the object links the
//       claimed entity to that contract by id
//   L   a sentence naming no entity inherits its LINE's entity only when
//       everything named on that line belongs to one contract
// ============================================================================

// ---------- normalization ---------------------------------------------------

const AR_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => AR_DIGITS[d] ?? d);
}

/** Aggressive normalization for equality: digits, case, separators, currency. */
export function norm(s: string): string {
  return normalizeDigits(String(s))
    .toLowerCase()
    .replace(/[٬,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- clause splitting + negation -------------------------------------

/** Conjunctions that start a new claim-bearing clause. */
const CLAUSE_SPLIT = /\bbut\b|\bhowever\b|\bthough\b|\balthough\b|\byet\b|\bwhile\b|لكن|مع ذلك|بينما|؛|;\s|\n+/i;

/**
 * Negation markers. A clause containing one of these does not ASSERT the
 * claim inside it — "there is no record that the client approved" reports an
 * absence. Clause scoping is what fixes the old 70-char window: "the client
 * approved, but there is no signed record" still asserts approval because the
 * negation lives in the OTHER clause.
 */
const NEGATION = /\b(no|not|never|without|cannot|can't|could not|couldn't|did not|didn't|does not|doesn't|do not|don't|is not|isn't|was not|wasn't|has not|hasn't|have not|haven't|no record|no evidence|no verified|no calculable|not currently quantif|not quantif)\b|لا يوجد|لا أملك|ليس هناك|ليس|لم ي|لم ت|لن|غير|دون|بدون|ما عندنا|لا نعرف|لا يمكن/i;

export function splitClauses(sentence: string): string[] {
  return sentence.split(CLAUSE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

export function isNegatedClause(clause: string): boolean {
  return NEGATION.test(clause);
}

/** The ": "-delimited segment of `clause` that contains offset `at`. */
export function colonSegment(clause: string, at: number): string {
  const start = clause.lastIndexOf(": ", at - 1);
  const end = clause.indexOf(": ", at);
  return clause.slice(start < 0 ? 0 : start + 2, end < 0 ? clause.length : end);
}

/**
 * Attribution markers: the clause reports what the USER said, not what the
 * system holds. "You mentioned the client approved verbally" quotes a user
 * claim; "The client approved verbally" asserts it as system truth.
 */
const ATTRIBUTION = /\b(you (?:said|mentioned|asked|stated|noted|wrote|told|indicated|referred)|as you (?:said|mentioned|noted)|according to you|your (?:request|message|question) (?:says|mentions|refers|states))\b|ذكرتَ?|قلتَ?|حسب قولك|كما ذكرت|وفقًا لما ذكرت|بحسب طلبك|أشرتَ?/i;

export function isAttributedClause(clause: string): boolean {
  return ATTRIBUTION.test(clause);
}

// ---------- claim model ------------------------------------------------------

export type ClaimType =
  | "monetary_amount"     // SAR 5,000 / $5 / ٥٠٠٠ ريال
  | "percentage"          // 10% / ١٠٪
  | "iso_date"            // 2026-09-25 / Sep 25, 2026
  | "day_count"           // "6 days overdue" / "٦ أيام"
  | "contract_number"     // BETA-200
  | "clause_number"       // clause 7.3 / البند 7.3
  | "assignee_name"       // "assigned to Faisal" / "المسؤول: فيصل"
  | "verification_state"  // verified / missing / needs review / ناقص
  | "acknowledgement_state" // client approved/acknowledged
  | "overdue_state"       // X is overdue / متأخر
  | "gap_state"           // gap resolved/closed/open
  | "unassigned_state"    // obligation has no owner
  | "action_execution";   // "I resolved/changed/sent/assigned …"

export type FactClaim = {
  type: ClaimType;
  /** exact text span that produced the claim */
  raw: string;
  /** normalized comparable value, e.g. "50000", "2026-09-25", "verified", "beta-200" */
  value: string;
  /** entity token bound in the same sentence, normalized (e.g. "beta-200") */
  entityKey: string | null;
  /** attributed = quoting the user; never counted as a system-truth assertion */
  polarity: "asserted" | "negated" | "attributed";
  sentence: string;
  /** r4: the clause the claim was extracted from (change vs current-state) */
  clause?: string;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const AR_NUM = "[\\d٠-٩][\\d٠-٩,.\u066C\u066B]*";
const MONEY = new RegExp(
  `(?:SAR|USD|EUR|GBP|ريال|ريالات|ر\\.س|[$€£])\\s?${AR_NUM}|${AR_NUM}\\s?(?:SAR|USD|EUR|GBP|ريال|ريالات|ر\\.س)`, "gi");
const PERCENT = /[\d٠-٩]+(?:[.,\u066B][\d٠-٩]+)?\s*[%٪]/g;
const ISO_DATE = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g;
const MONTH_DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*(?:19|20)\d{2})?|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(?:19|20)\d{2})?/gi;
// \b is ASCII-only in JS — Arabic word edges need an explicit boundary.
const AR_BOUNDARY = "(?![ء-٩])";
const NUM_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};
const DAY_COUNT = new RegExp(
  `(?:${AR_NUM}|\\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\b)\\s*(?:days?\\b|يومًا?|أيام|يوم)${AR_BOUNDARY}`, "gi");
const CONTRACT_NO = /\b[A-Z]{2,10}-\d{2,6}\b/g;
const CLAUSE_NO = /(?:clause|البند|الفقرة|المادة)\s*#?\s*(\d+(?:\.\d+)+)/gi;
const ASSIGNEE = /(?:assigned to|owner(?:\s+is|:)?|owned by|responsible(?:\s+is|:)?|المسؤول(?:\s+هو|:)?|مسؤول(?:\s+عن)?[^.:،,]{0,20}(?:هو|:)?)\s+([A-Za-z][A-Za-z.''-]{2,}|[\w.+-]+@[\w-]+\.[\w.]+|[\u0600-\u06FF]{2,}(?:\s[\u0600-\u06FF]{2,})?)/gi;
// r4: "not submitted" is its own claim (only an explicit no-submission state
// supports it); "awaiting/pending verification" is distinct from "pending /
// awaiting human review".
const VERIFY_STATE = /\b(not (?:yet )?(?:been )?submitted|never (?:been )?submitted|nothing (?:has been |was )?(?:uploaded|submitted)|verified|partially[- ]verified|incomplete|missing|needs?[ _-]?(?:a )?(?:human )?review|(?:pending|awaiting)\s+(?:human\s+)?(?:review|verification)|rejected|unverified)\b|لم يُ?رفع|لم يُ?قدَّ?م|موثّق|موثق|مُثبَت|مثبت|ناقص|مفقود|غير مكتمل|قيد المراجعة|بانتظار التحقق|يحتاج مراجعة|غير موثّق/gi;
const ACK_STATE = /(?:client|العميل|العميلة)\s+(?:has\s+|did\s+|have\s+)?(?:approved|acknowledged|accepted|signed|countersigned|rejected|اعتماد|اعتمد|أقرّ|اقرّ|وقّع|وقع|رفض)/gi;
const OVERDUE = /\b(?:is|are|was|became|now|currently|still)?\s*overdue\b|متأخر(?:ة|ًا|اً)?|متأخرة/gi;
const GAP_STATE = /(?:gaps?|فجوة|فجوات)\s+(?:is\s+|was\s+|are\s+|has been\s+|have been\s+|now\s+)?(?:resolved|closed|reopened|opened|open)|(?:resolved|closed|open|reopened)\s+(?:the\s+)?gaps?/gi;
const UNASSIGNED = /\bunassigned\b|no\s+(?:assigned\s+)?owner|without\s+(?:an?\s+)?owner|بلا مالك|بدون مالك|دون مالك|لا مالك|غير مُسند|غير مسند/gi;
const ACTION_EXEC = /\b(?:i|i've|i have|we)\s+(?:have\s+)?(?:resolved|closed|marked|changed|updated|rescheduled|assigned|approved|sent|emailed|notified|deleted|removed)\b|(?:the\s+)?(?:gap|deadline|due date|obligation)\s+(?:is|has been|was|got)\s+(?:resolved|closed|changed|updated|extended)|تم\s+(?:حل|إغلاق|تغيير|تعيين|إرسال|اعتماد)|قمت\s+ب(?:حل|إغلاق|تغيير|تعيين|إرسال)/gi;

/**
 * "1,000,000.00" → "1000000"; "1,500.50" → "1500.5". Thousands separators
 * are dropped, a trailing 1–2 digit fraction is a decimal — never extra
 * digits (v2 turned 1,000,000.00 into 100000000). Output matches how a JSON
 * number from a tool payload stringifies, so equal amounts compare equal.
 */
export function moneyValue(raw: string): string {
  const s = normalizeDigits(raw).replace(/\u066B/g, ".");
  const m = s.match(/^([\d,.\u066C]*?)(?:\.(\d{1,2}))?$/);
  const whole = (m?.[1] ?? s).replace(/[,.\u066C]/g, "");
  const n = Number(`${whole || "0"}.${m?.[2] ?? "0"}`);
  return Number.isFinite(n) ? String(n) : whole;
}

/** Words that follow "owner/المسؤول" but are not a person's name. */
const ASSIGNEE_STOP = new Set([
  "unassigned", "none", "nobody", "no one", "vacant", "tbd", "unknown", "no owner", "not assigned",
  "role", "roles", "field", "status", "assignment", "suggested", "recorded", "required", "position",
  "المؤكد", "والمؤكد", "عن", "هو", "هي", "غير", "الحالي", "المقترح", "المسند", "المسجل", "المطلوب", "دور",
]);

function normalizeState(v: string): string {
  const s = norm(v);
  if (/not (?:yet )?(?:been )?submitted|never (?:been )?submitted|nothing (?:has been |was )?(?:uploaded|submitted)|لم يُ?رفع|لم يُ?قدَّ?م/.test(s)) return "not_submitted";
  if (/partially/.test(s)) return "partially_verified";
  if (/verified|موثّق|موثق|مُثبَت|مثبت/.test(s) && !/unverif|not verif|غير/.test(s)) return "verified";
  if (/missing|مفقود/.test(s)) return "missing";
  if (/incomplete|ناقص|غير مكتمل/.test(s)) return "incomplete";
  if (/needs?[ _-]?(?:a )?(?:human )?review|(?:pending|awaiting)\s+(?:human\s+)?review|قيد المراجعة|يحتاج مراجعة/.test(s)) return "needs_review";
  // r4: awaiting verification ≠ pending human review (domain: a pending
  // discrepancy awaits authorized human review — evidence.ts)
  if (/(?:pending|awaiting)\s+verification|بانتظار التحقق/.test(s)) return "awaiting_verification";
  if (/^pending$/.test(s)) return "pending";
  if (/rejected|رفض/.test(s)) return "rejected";
  if (/unverified|غير موثّق|غير موثق/.test(s)) return "unverified";
  return s;
}

function normalizeMonthDate(raw: string): string {
  const m = normalizeDigits(raw).toLowerCase()
    .match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*((?:19|20)\d{2}))?|(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*((?:19|20)\d{2}))?/i);
  if (!m) return norm(raw);
  const month = MONTHS[(m[1] ?? m[5] ?? "").slice(0, 3)] ?? "??";
  const day = (m[2] ?? m[4] ?? "0").padStart(2, "0");
  const year = m[3] ?? m[6] ?? "";
  return year ? `${year}-${month}-${day}` : `${month}-${day}`;
}

// ---------- entity binding ---------------------------------------------------

/** Known entity surface — built from the fixture so claims bind to real nouns. */
export type EntityMap = {
  /** normalized display token → canonical entity key */
  tokens: Map<string, string>;
  /** uuid → canonical entity key, so uuid-bearing tool objects bind too */
  idKeys: Map<string, string>;
  /** r4: entity key → owning contract number (unambiguous line attribution) */
  families?: Map<string, string>;
};

export function buildEntityMap(fx: any): EntityMap {
  const tokens = new Map<string, string>();
  const idKeys = new Map<string, string>();
  const add = (label: string | null | undefined, key: string) => {
    if (!label) return;
    const n = norm(label);
    if (n.length >= 2) tokens.set(n, key);
  };
  const addId = (id: string | null | undefined, key: string) => {
    if (id) idKeys.set(norm(id), key);
  };
  // r4: entity key → the contract it belongs to (for unambiguous line attribution)
  const families = new Map<string, string>();
  const addReq = (c: any, req: any) => {
    if (!req) return;
    const reqKey = `requirement:${req.reqId}`;
    const itemKey = `evidence_item:${req.itemId ?? req.reqId}`;
    add(req.name, reqKey);
    add(req.evidenceTitle, itemKey);
    addId(req.reqId, reqKey);
    addId(req.itemId, itemKey);
    addId(req.checkId, itemKey);
    addId(req.versionId, itemKey);
    families.set(reqKey, c.number);
    families.set(itemKey, c.number);
  };
  for (const [k, c] of Object.entries<any>(fx.contracts ?? {})) {
    const cKey = `contract:${c.number}`;
    const oKey = `obligation:${c.obligationId}`;
    add(c.number, cKey);
    add(c.title, cKey);
    add(c.obligationTitle, oKey);
    add(c.clauseNumber, `clause:${c.clauseId}`);
    addId(c.contractId, cKey);
    addId(c.clauseId, `clause:${c.clauseId}`);
    addId(c.obligationId, oKey);
    addReq(c, c.req);
    addReq(c, c.kpiReq);
    for (const key of [cKey, oKey, `clause:${c.clauseId}`]) families.set(key, c.number);
    void k;
  }
  for (const name of fx.memberNames ?? []) add(name, `member:${name}`);
  for (const e of fx.memberEmails ?? []) { add(e, `member:${e}`); }
  return { tokens, idKeys, families };
}

/**
 * r4: the line's entity, ONLY when every entity named on the line belongs to
 * one contract (e.g. a bullet "Quarterly security compliance statement —
 * EPSILON-500 … no owner is recorded"). A line naming two contracts, or none,
 * gives no fallback.
 */
function lineEntity(line: string, entities: EntityMap): string | null {
  if (!entities.families) return null;
  const n = norm(line);
  const fams = new Set<string>();
  for (const [token, key] of entities.tokens) {
    if (!tokenHit(n, token)) continue;
    const f = entities.families.get(key);
    if (!f) return null;
    fams.add(f);
  }
  return fams.size === 1 ? bindEntity(line, entities) : null;
}

/**
 * Boundary-aware token match: "7.3" must not bind inside "27.35" and
 * "beta-200" must not bind inside "beta-2000".
 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function tokenHit(text: string, token: string): boolean {
  if (!token) return false;
  return new RegExp(
    `(^|[^\\w\\u0600-\\u06FF])${escapeRe(token)}([^\\w\\u0600-\\u06FF]|$)`, "i",
  ).test(text);
}

/** Longest entity token found in the sentence → its canonical key. */
function bindEntity(sentence: string, entities: EntityMap): string | null {
  const n = norm(sentence);
  let best: string | null = null;
  let bestLen = 0;
  for (const [token, key] of entities.tokens) {
    if (token.length > bestLen && tokenHit(n, token)) {
      best = key;
      bestLen = token.length;
    }
  }
  return best;
}

// ---------- extraction --------------------------------------------------------

export function extractClaims(text: string, entities: EntityMap): FactClaim[] {
  const claims: FactClaim[] = [];
  const units = text.split(/\n+/).flatMap((line) => {
    const lineKey = lineEntity(line, entities);
    return line.split(/(?<=[.!؟?])\s+/).map((s) => s.trim()).filter(Boolean).map((sentence) => ({ sentence, lineKey }));
  });
  for (const { sentence, lineKey } of units) {
    const sentenceEntity = bindEntity(sentence, entities) ?? lineKey;
    for (const clause of splitClauses(sentence)) {
      const attributed = isAttributedClause(clause);
      // Bind per clause first ("A is overdue, but B is fine") — fall back to
      // the sentence-level entity, then (r4) an unambiguous line entity.
      const entityKey = bindEntity(clause, entities) ?? sentenceEntity;
      let at = 0;
      const push = (type: ClaimType, raw: string, value: string) => {
        if (!value) return;
        // r4: negation is scoped to the colon-delimited segment holding the
        // match — "has one open gap: no verified acknowledgement is recorded"
        // negates the acknowledgement, not the gap.
        const negated = isNegatedClause(colonSegment(clause, at));
        // A state expression with its own internal negation ("غير مكتمل",
        // "not verified") ASSERTS a negative state — it is not a negated claim.
        const claimPolarity: FactClaim["polarity"] = attributed ? "attributed"
          : negated && !NEGATION.test(raw) ? "negated" : "asserted";
        claims.push({ type, raw, value: norm(value), entityKey, polarity: claimPolarity, sentence, clause });
      };
      let m: RegExpExecArray | null;
      const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
        re.lastIndex = 0;
        while ((m = re.exec(clause))) { at = m.index; fn(m); }
      };
      each(MONEY, (mm) => {
        const digits = normalizeDigits(mm[0]).match(/[\d,.\u066C\u066B]+/);
        push("monetary_amount", mm[0], digits ? moneyValue(digits[0]) : mm[0]);
      });
      each(PERCENT, (mm) => push("percentage", mm[0], normalizeDigits(mm[0])));
      each(ISO_DATE, (mm) => push("iso_date", mm[0], mm[0]));
      each(MONTH_DATE, (mm) => {
        // "Schedule 6 may apply": modal verb, not the month. A yearless
        // "<day> may" followed by a lowercase word is not a date.
        const after = clause.slice(mm.index + mm[0].length);
        if (/\bmay\.?$/i.test(mm[0]) && !/(19|20)\d{2}/.test(mm[0]) && /^\s+[a-z\u0600-\u06FF]/.test(after)) return;
        push("iso_date", mm[0], normalizeMonthDate(mm[0]));
      });
      each(DAY_COUNT, (mm) => {
        const d = normalizeDigits(mm[0]).match(/\d+/);
        const w = mm[0].toLowerCase().match(/one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve/);
        const v = d?.[0] ?? (w ? NUM_WORDS[w[0]] : undefined);
        if (v) push("day_count", mm[0], v);
      });
      each(CONTRACT_NO, (mm) => push("contract_number", mm[0], mm[0]));
      each(CLAUSE_NO, (mm) => push("clause_number", mm[0], mm[1]));
      each(ASSIGNEE, (mm) => {
        const captured = norm(mm[1]);
        const first = captured.split(" ")[0];
        if (!ASSIGNEE_STOP.has(captured) && !ASSIGNEE_STOP.has(first)) push("assignee_name", mm[0], mm[1]);
      });
      each(VERIFY_STATE, (mm) => {
        // "1 pending verification discrepancy" describes a PENDING DISCREPANCY,
        // not evidence awaiting verification.
        const describesDiscrepancy = /^pending\s+verification$/i.test(mm[0]) &&
          /^\s+discrepanc/i.test(clause.slice(mm.index + mm[0].length));
        push("verification_state", mm[0], describesDiscrepancy ? "pending" : normalizeState(mm[0]));
      });
      each(ACK_STATE, (mm) => push("acknowledgement_state", mm[0], normalizeState(mm[0]) === "verified" ? "acknowledged" : normalizeState(mm[0]) === "rejected" ? "rejected" : "acknowledged"));
      each(OVERDUE, (mm) => push("overdue_state", mm[0], "overdue"));
      each(GAP_STATE, (mm) => push("gap_state", mm[0], /resolv|closed|مغلق|محلول|حل/i.test(mm[0]) ? "resolved" : "open"));
      each(UNASSIGNED, (mm) => push("unassigned_state", mm[0], "unassigned"));
      each(ACTION_EXEC, (mm) => push("action_execution", mm[0], mm[0]));
    }
  }
  return claims;
}

// ---------- evidence corpus ---------------------------------------------------

/**
 * The corpus = every scalar value inside every tool payload the model saw,
 * indexed per result object so entity-bound claims can require co-occurrence.
 */
export type EvidenceCorpus = {
  /** all normalized scalar values anywhere in the evidence */
  values: Set<string>;
  /** per-object: scalar values + entity keys present together */
  objects: { values: Set<string>; entities: Set<string> }[];
  /** normalized whole payloads (substring fallback for odd phrasings) */
  raw: string;
  /** normalized user question — the only valid source for an ATTRIBUTED claim */
  question: string;
};

function collectLeaves(node: any, into: Set<string>) {
  if (node == null) return;
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    const n = norm(String(node));
    if (n) into.add(n);
    return;
  }
  if (Array.isArray(node)) { for (const v of node) collectLeaves(v, into); return; }
  if (typeof node === "object") { for (const v of Object.values(node)) collectLeaves(v, into); }
}

/**
 * r4 — typed state fields → the claim values they establish, per product
 * semantics (engine.ts gapTypeFor, detectors.ts, domain/evidence.ts):
 *   gap_type missing_evidence   ← the check found the evidence missing / not
 *                                 found → "missing" (NOT "not submitted")
 *   gap_type partial_evidence   → "incomplete"
 *   gap_type other/contradiction/quality, or a bare status "open"
 *                               → no specific absence claim (cause not
 *                                 established; supports "open gap" only)
 * An absent field establishes nothing.
 */
const STATE_FIELD_MARKERS: Record<string, Record<string, string[]>> = {
  gap_type: { missing_evidence: ["missing"], partial_evidence: ["incomplete", "partially_verified"] },
  kind: {
    missing_required_evidence: ["missing"], unassigned_obligation: ["unassigned"],
    overdue: ["overdue"], verification_discrepancy: ["needs_review"],
  },
  status: { verification_pending: ["awaiting_verification"], received: ["awaiting_verification"], evidence_received: ["awaiting_verification"] },
};
/** Boolean state flags: `true` establishes the state; false or absent does not. */
const FLAG_MARKERS: Record<string, string> = { unassigned: "unassigned", openGap: "gap_open" };

function collectMarkers(node: any, into: Set<string>) {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) { for (const v of node) collectMarkers(v, into); return; }
  for (const [k, v] of Object.entries(node)) {
    if (v === true && FLAG_MARKERS[k]) into.add(FLAG_MARKERS[k]);
    else if (typeof v === "string") for (const mk of STATE_FIELD_MARKERS[k]?.[v] ?? []) into.add(mk);
    else if (typeof v === "object") collectMarkers(v, into);
  }
}

function entitiesOf(values: Set<string>, entities: EntityMap): Set<string> {
  const ents = new Set<string>();
  for (const v of values) {
    const idKey = entities.idKeys.get(v);
    if (idKey) ents.add(idKey);
    for (const [token, key] of entities.tokens) {
      if (token === v || (token.length > 3 && tokenHit(v, token))) ents.add(key);
    }
  }
  return ents;
}

/**
 * r4 — complete JSON objects inside a TRUNCATED tool result string. Only
 * objects the model saw in full are returned (maximal balanced spans); the
 * partial object at the cut, and anything after it, contribute no
 * entity-bound support — nothing is inferred beyond what was received.
 */
export function completeObjects(s: string): unknown[] {
  const spans: [number, number][] = [];
  const stack: number[] = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") stack.push(i);
    else if (ch === "}" && stack.length) spans.push([stack.pop()!, i]);
  }
  const maximal = spans.filter(([a, b]) => !spans.some(([c, d]) => c < a && d > b));
  const out: unknown[] = [];
  for (const [a, b] of maximal) { try { out.push(JSON.parse(s.slice(a, b + 1))); } catch { /* not a whole object */ } }
  return out;
}

/** Parsed payload objects: whole result, or its fully visible objects if truncated. */
function payloadObjects(parsed: any): unknown[] {
  if (parsed && parsed.truncated === true && typeof parsed.data === "string") return completeObjects(parsed.data);
  return [parsed];
}

function indexObject(node: any, entities: EntityMap, out: EvidenceCorpus["objects"], inheritedTags: string[] = []) {
  if (node == null || typeof node !== "object") return;
  const values = new Set<string>();
  collectLeaves(node, values);
  collectMarkers(node, values);
  for (const t of inheritedTags) values.add(t);
  const ents = entitiesOf(values, entities);
  if (values.size) out.push({ values, entities: ents });
  if (Array.isArray(node)) for (const v of node) indexObject(v, entities, out, inheritedTags);
  else for (const v of Object.values(node)) if (typeof v === "object" && v) indexObject(v, entities, out, inheritedTags);
}

/**
 * State implied by WHICH tool returned an object: every row from
 * getOverdueObligations is definitionally overdue — the word "overdue" is a
 * property name inside the payload, not a leaf value, so it is injected.
 */
const TOOL_STATE_TAGS: Record<string, string[]> = {
  getOverdueObligations: ["overdue"],
  getUpcomingObligations: ["upcoming"],
  getVerificationDiscrepancies: ["discrepancy_pending"],
  getEvidenceGaps: ["gap_open"],
};

export function buildCorpus(opts: {
  /** payload string, or {tool,payload} to inherit tool-implied state tags */
  toolPayloads: (string | { tool: string; payload: string })[];
  question: string;
  contextValues: string[];
  entities: EntityMap;
}): EvidenceCorpus {
  const values = new Set<string>();
  const objects: EvidenceCorpus["objects"] = [];
  const rawParts: string[] = [opts.question, ...opts.contextValues];
  for (const entry of opts.toolPayloads) {
    const payload = typeof entry === "string" ? entry : entry.payload;
    const tags = typeof entry === "string" ? [] : TOOL_STATE_TAGS[entry.tool] ?? [];
    rawParts.push(payload);
    collectLeaves(payload, values);
    for (const t of tags) values.add(t);
    try {
      for (const obj of payloadObjects(JSON.parse(payload))) {
        collectLeaves(obj, values);
        collectMarkers(obj, values);
        indexObject(obj, opts.entities, objects, tags);
      }
    } catch { /* payload stayed opaque; raw scan still applies */ }
  }
  for (const v of [...opts.contextValues]) collectLeaves(v, values);
  collectLeaves(opts.question, values);
  return { values, objects, raw: norm(rawParts.join("\n")), question: norm(opts.question) };
}

// ---------- claim support -----------------------------------------------------

export type ScoredClaim = FactClaim & {
  supported: boolean;
  /** "object" = bound entity co-occurs with value · "global" = value seen anywhere · "none" */
  supportKind: "object" | "global" | "context" | "user_input" | "none";
};

/** Predicate claims assert something ABOUT an entity — negating them denies
 *  the predicate. Value claims (numbers/dates/ids) in a negated clause are
 *  usually just entity references and skip the contradiction check. */
const PREDICATE_TYPES = new Set<ClaimType>([
  "verification_state", "acknowledgement_state", "overdue_state",
  "gap_state", "unassigned_state", "action_execution", "assignee_name",
]);

/**
 * "Sep 25" (no year) is supported by an ISO date "2026-09-25" in evidence —
 * compare MM-DD suffixes for year-less month dates.
 */
function valueVariantHit(values: Set<string>, v: string): boolean {
  if (/^\d{2}-\d{2}$/.test(v)) {
    for (const x of values) if (x.endsWith(`-${v}`)) return true;
  }
  // Semantic aliases: a rejected/failed check supports an "unverified" claim.
  const ALIASES: Record<string, string[]> = {
    unverified: ["rejected", "failed", "unverified", "not_verified"],
    needs_review: ["pending", "needs_review", "pending_review", "needs_human_review", "pending_human_review"],
    missing: ["missing", "not_found", "absent"],
    awaiting_verification: ["awaiting_verification", "verification_pending"],
  };
  for (const a of ALIASES[v] ?? []) if (values.has(a)) return true;
  return false;
}

export function scoreClaims(claims: FactClaim[], corpus: EvidenceCorpus): ScoredClaim[] {
  return claims.map((c) => {
    // A quoted user claim is supported only by what the user actually wrote;
    // attributing something the user never said is a misattribution.
    if (c.polarity === "attributed") {
      const said = tokenHit(corpus.question, c.value) || tokenHit(corpus.question, norm(c.raw));
      return { ...c, supported: said, supportKind: said ? "user_input" : "none" };
    }
    if (c.polarity === "negated") {
      if (!PREDICATE_TYPES.has(c.type)) return { ...c, supported: true, supportKind: "global" };
      const contradicted = c.entityKey
        ? corpus.objects.some((o) => o.entities.has(c.entityKey!) && (o.values.has(c.value) || valueVariantHit(o.values, c.value)))
        : (corpus.values.has(c.value) || valueVariantHit(corpus.values, c.value));
      return { ...c, supported: !contradicted, supportKind: contradicted ? "none" : "global" };
    }
    // Entity-bound claim: value and entity must co-occur in the SAME
    // tool-result object. No global fallback — that is the whole point of
    // binding (a "12 days" true of XRAY-900 cannot support BETA-200).
    if (c.entityKey) {
      // r4: a contract-number claim is also supported when the object links
      // the claimed entity to that contract BY ID (a gap row carries
      // contract_id, not the literal "GAMMA-300").
      const contractKey = c.type === "contract_number" ? `contract:${c.value}` : null;
      const co = corpus.objects.some((o) => o.entities.has(c.entityKey!) &&
        (o.values.has(c.value) || valueVariantHit(o.values, c.value) ||
          (!!contractKey && [...o.entities].some((k) => k.toLowerCase() === contractKey))));
      if (co) return { ...c, supported: true, supportKind: "object" };
      return { ...c, supported: false, supportKind: "none" };
    }
    if (corpus.values.has(c.value) || valueVariantHit(corpus.values, c.value))
      return { ...c, supported: true, supportKind: "global" };
    // Raw fallback uses word boundaries — "6" inside "2026" or a uuid is not
    // evidence for a six-day claim.
    if (tokenHit(corpus.raw, c.value)) return { ...c, supported: true, supportKind: "context" };
    return { ...c, supported: false, supportKind: "none" };
  });
}

// ---------- citation claim support -------------------------------------------

export type ClaimCitationCheck = {
  /** a material claim that required a supporting citation */
  claimEntity: string;
  /** citation ids that support this entity (the entity itself or its source) */
  satisfied: boolean;
  citedBy: string[];
};

/**
 * Claim ↔ citation support: a citation SUPPORTS a claim only if it resolves
 * to the claimed entity or to an entity that is the claim's recorded source
 * (clause → obligation, obligation → contract …). A random same-contract
 * citation does not count.
 */
export function bindCitationsToClaims(
  claims: ScoredClaim[],
  citations: { target: string; id: string }[],
  entityToIds: Map<string, Set<string>>,
  activity?: ActivityIndex,
): ClaimCitationCheck[] {
  const citedIds = new Set(citations.map((c) => c.id));
  const byEntity = new Map<string, ScoredClaim[]>();
  for (const c of claims) {
    if (!c.entityKey || c.polarity !== "asserted") continue;
    // member-bound claims are contextual — no citation target exists for
    // members; citations belong on the operational entity (obligation etc.)
    if (c.entityKey.startsWith("member:")) continue;
    byEntity.set(c.entityKey, [...(byEntity.get(c.entityKey) ?? []), c]);
  }
  const checks: ClaimCitationCheck[] = [];
  for (const [entityKey, group] of byEntity) {
    const allowed = entityToIds.get(entityKey) ?? new Set([entityKey]);
    const hits = citations.filter((x) => allowed.has(x.id)).map((x) => `${x.target}:${x.id}`);
    let satisfied = hits.length > 0 || [...allowed].some((id) => citedIds.has(id));
    // r4: an authorized activity event supports a claim about the RECORDED
    // CHANGE when its entity and values match. It never proves current state:
    // the entity passes only if EVERY claim about it is such a change claim.
    const activityHits: string[] = [];
    if (!satisfied && activity) {
      satisfied = group.every((c) => {
        if (!isChangeClaim(c)) return false;
        const ev = citations.find((x) => {
          const e = activity.get(x.id);
          return !!e && e.entities.has(entityKey) && (e.values.has(c.value) || valueVariantHit(e.values, c.value));
        });
        if (ev) activityHits.push(`${ev.target}:${ev.id}`);
        return !!ev;
      });
    }
    checks.push({ claimEntity: entityKey, satisfied, citedBy: hits.length ? hits : activityHits });
  }
  return checks;
}

// ---------- r4: activity events as change evidence ----------------------------

export type ActivityIndex = Map<string, { values: Set<string>; entities: Set<string> }>;

/** Every activity event the model received (incl. fully visible events of a truncated result), by id. */
export function buildActivityIndex(toolPayloads: { tool: string; payload: string }[], entities: EntityMap): ActivityIndex {
  const idx: ActivityIndex = new Map();
  const walk = (node: any) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.id === "string" && typeof node.event_type === "string") {
      const values = new Set<string>();
      collectLeaves(node, values);
      collectMarkers(node, values);
      idx.set(node.id, { values, entities: entitiesOf(values, entities) });
    }
    for (const v of Object.values(node)) if (typeof v === "object") walk(v);
  };
  for (const p of toolPayloads) {
    if (p.tool !== "getRecentActivity") continue;
    try { payloadObjects(JSON.parse(p.payload)).forEach(walk); } catch { /* opaque */ }
  }
  return idx;
}

const IDENTITY_TYPES = new Set<ClaimType>(["contract_number", "clause_number", "iso_date", "day_count"]);
const CHANGE_VERB = /\b(uploaded|submitted|confirmed|assigned|reassigned|created|raised|flagged|recorded|resolved|closed|reopened|approved|rejected|overrode|overridden|updated|changed|completed|added|removed|received|escalated)\b|تم |رُفع|أُكِّد|أُسند|تجاوز|أُنشئ/i;
const PAST_AUX = /\b(was|were|has been|have been|had been|got)\b/i;
const PRESENT_STATE = /\b(is|are|remains?|still|currently|now)\b|لا يزال|يظل|حاليًا/i;

/**
 * A claim ABOUT A RECORDED CHANGE: its clause describes a change, and a state
 * or assignee claim is phrased in the past ("was assigned"), never as what is
 * true now ("is assigned", "remains missing").
 */
export function isChangeClaim(c: FactClaim): boolean {
  const clause = c.clause ?? c.sentence;
  if (!CHANGE_VERB.test(clause)) return false;
  if (IDENTITY_TYPES.has(c.type)) return true;
  return PAST_AUX.test(clause) && !PRESENT_STATE.test(clause);
}
