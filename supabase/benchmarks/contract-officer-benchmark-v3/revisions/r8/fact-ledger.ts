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
//
// r5 correction (paired tests in officer-benchmark-v3-r5.test.ts):
//   H   RECORDED HISTORY — "was recorded as <state>" is a claim about what an
//       event recorded, not about current state. It is supported ONLY by an
//       activity event that the answer actually CITES and that matches the
//       record (entity), the recorded status, and the historical context
//       (the event's action, e.g. an upload). Past tense alone, or a citation
//       alone, is not enough; free-text event content never supports a
//       current-state claim.
//
// r6 correction (paired tests in officer-benchmark-v3-r6.test.ts):
//   S   SCOPED HEALTH — "No actionable issues are recorded within the checks
//       and data available." satisfies a health question ONLY for the one
//       contract it is attributed to, and only when that contract's own
//       getContractHealth result says no_actionable_issues_recorded with no
//       coverage gaps. Selecting an issue-bearing or incompletely assessed
//       contract, borrowing another contract's result, or claiming broad
//       compliance from this limited check fails.
//   R   REFUSAL — negation is clause-scoped and "can’t" (typographic
//       apostrophe) negates exactly like "can't"; a later clause or sentence
//       claiming completion is still an assertion. DB side-effect checks are
//       independent and unchanged.
//   Q   CLARIFYING DATES — a date offered as an option inside a QUESTION is
//       supported only when it is a correct calendar candidate for the user's
//       relative wording ("next Friday") from the recorded reference date in
//       the organization's timezone, and any weekday named with it matches.
//       No reference date → NOT ASSESSED. Dates outside a question are
//       unchanged (an unapproved new deadline stays unsupported).
//
// r7 corrections (paired tests in officer-benchmark-v3-r7.test.ts; each proven
//   against saved gate answers — an r6 FAIL on a correct answer, with a nearby
//   wrong answer that stays rejected):
//   P   negation is POSITION-scoped: a marker negates only what FOLLOWS it in
//       the same colon-segment, and its scope ends at a coordinating boundary
//       (, ، ؛ "and", standalone "و"). "… is 6 days overdue, and no verified
//       report is recorded" asserts overdue and negates verified — under r6
//       the trailing "no" negated the whole segment. "no A or B" keeps both
//       negated (negative-polarity 'or' is not a boundary).
//   W   aggregates are never entity evidence: the top-level payload wrapper
//       {ok, data:[…]}, any object spanning MULTIPLE contract families, and —
//       for contradiction — an object binding descendants of the claimed
//       entity (a subtree aggregate). Row-level objects only.
//   K   kinship — object support/contradiction follows the fixture's explicit
//       id relationships: a contract-level state claim reads its obligations'
//       and requirements' rows (descendants only — never ancestors); a
//       contract-number claim bound to an entity is supported when that
//       entity's recorded contract is the claimed number, and bound to its
//       own contract it is a self-reference. Value types that belong to a
//       contract-wide subject (day counts, clause numbers, dates) match at
//       family level; amounts/percentages stay entity-bound + descendants.
//   B   block inheritance: a line naming no entity inherits its section's
//       entity ("No open gap … is recorded for this contract." under an
//       ALPHA-100 heading is about ALPHA-100); a line ending ':' inherits the
//       following line's entity (a list introducer).
//   M   CONDITIONAL and MODAL scopes: "remains open until verified" does not
//       assert verified; "I can retrieve the open gaps" is an unexecuted
//       offer, not a state claim. Neither counts as an assertion; neither is
//       held to evidence support.
//   O   "no OTHER pending discrepancies" is contradicted only by an in-scope
//       object whose entities are NOT already mentioned in the answer —
//       restating the one already-reported discrepancy is not a lie.
//   V   a negated state claim is contradicted within its GOVERNED NOUN's
//       scope: "no verified monetary amount" is about amounts, and the
//       existence of verified evidence elsewhere does not contradict it;
//       "no verified evidence" IS contradicted by a verified evidence object.
//   H2  compound recorded history: "was uploaded and recorded as awaiting
//       verification" is recorded history like "was recorded as …" (the r5
//       citation+action+state checks are unchanged).
//   E   entity binding is position-aware when a clause names several
//       entities: the claim binds the nearest PRECEDING entity ("BETA-200
//       … is already overdue, followed by GAMMA-300" — overdue is BETA-200's),
//       falling back to the nearest following one.
//   AR  the same rules carry Arabic markers (لا يوجد/حتى/أستطيع/،/و) and a
//       markdown emphasis between البند and its number no longer hides it.
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
const NEGATION = /\b(no|not|never|without|cannot|can't|could not|couldn't|did not|didn't|does not|doesn't|do not|don't|is not|isn't|was not|wasn't|has not|hasn't|have not|haven't|nothing|none|no longer|no record|no evidence|no verified|no calculable|not currently quantif|not quantif)\b|لا يوجد|لا أملك|ليس هناك|ليس|لم ي|لم ت|لن|غير|دون|بدون|ما عندنا|لا نعرف|لا يمكن/i;
const NEGATION_G = new RegExp(NEGATION.source, "gi");

/**
 * r7 — coordinating boundaries end a negation's scope. "… is overdue, and no
 * verified report is recorded" — the "no" governs only its own conjunct.
 * Negative-polarity "or"/أو is NOT a boundary: "no gaps or discrepancies"
 * negates both.
 */
const NEG_BOUNDARY = /,|،|؛|\band\b|(?<=\s)و(?=\s)/gi;

/** r7 — the states an evidence item can "lack": 'missing'/'lacks' negate them. */
const STATE_ABSENT = /\b(?:missing|lacks?|lacking|absent)\b|مفقود|يفتقر|خالٍ/i;
const STATE_ABSENT_G = new RegExp(STATE_ABSENT.source, "gi");

/** r7 — conditional frames: "until verified", "once reviewed", "حتى يُتحقق". */
const CONDITIONAL = /\b(?:until|once|when|whenever|after|before|upon|pending|awaiting|unless|if)\b|حتى|عندما|حين|إذا|إلا إذا/i;
const CONDITIONAL_G = new RegExp(CONDITIONAL.source, "gi");

/** r7 — modal offers / needs: "I can retrieve …", "أستطيع أن …" — not assertions. */
const MODAL = /\b(?:i|we)\s+(?:can|could|may|might|shall|would)\b|\b(?:let me|i'd be happy to|happy to|i am able to|we are able to|i need|i would need|i first need)\b|أستطيع|يمكنني|يمكننا|بإمكاني|أحتاج|يمكن أن/i;
const MODAL_G = new RegExp(MODAL.source, "gi");

/**
 * r7 — the modal offer only stands when the modal governs a CAPABILITY verb:
 * "I can retrieve the open gaps" is an offer; "I can see the gap is open" is
 * still an assertion ("see" reports a state, it does not offer to act).
 */
const CAP_VERB = /\b(?:retrieve|list|show|fetch|pull|send|submit|provide|request|generate|prepare|export|download|re-?check|re-?verify|review|query|run|create|draft|get|share|summar\w+|break down|walk through|schedule|set up|arrange)\b|أسترجع|أرسل|أقدّم|أقدم|أنشئ|أراجع|أتحقق|أستعرض|أعرض|ألخص|أرتّب|أجهّز/i;
const CAP_VERB_G = new RegExp(CAP_VERB.source, "gi");

/** r7 — "I can <capability-verb> … claim" — offer scope, not an assertion. */
function modalOfferAt(clause: string, at: number): boolean {
  const start = clause.lastIndexOf(": ", at - 1);
  const scope = normalizeApostrophes(clause.slice(start < 0 ? 0 : start + 2, at));
  const mIdx = lastMatchIndex(MODAL_G, scope);
  if (mIdx < 0 || mIdx <= lastMatchIndex(NEG_BOUNDARY, scope)) return false;
  CAP_VERB_G.lastIndex = 0;
  return CAP_VERB_G.test(scope.slice(mIdx));
}

/** r7 — "no other X" excludes already-mentioned entities from contradiction. */
const OTHER_SCOPE = /\b(?:no other|no additional|no further|none other|nothing else|no more|other than|besides)\b|لا يوجد غير|لا توجد أخرى|ما عدا|بخلاف/i;

function lastMatchIndex(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let m: RegExpExecArray | null, last = -1;
  while ((m = re.exec(s))) last = m.index;
  return last;
}

/** r7 — END index of the last regex match in s, or -1. */
function lastMatchEnd(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let m: RegExpExecArray | null, last = -1;
  while ((m = re.exec(s))) last = m.index + m[0].length;
  return last;
}

/**
 * r8 — a colon boundary survives markdown/emphasis between the colon and the
 * whitespace: "**no owner assigned:** the statement is unassigned" splits at
 * ":**" exactly as ": " does. Without this, a heading's "no" leaked past the
 * colon and negated the body (r7 Q01/R01).
 */
const COLON_BREAK = /[:：][*_~`'”’"»)\]]*\s+/g;
function lastScopeBreak(clause: string, at: number): number {
  COLON_BREAK.lastIndex = 0;
  let last = -1, m: RegExpExecArray | null;
  while ((m = COLON_BREAK.exec(clause)) && m.index < at) last = m.index + m[0].length;
  return last;
}
function nextScopeBreak(clause: string, at: number): number {
  COLON_BREAK.lastIndex = at;
  const m = COLON_BREAK.exec(clause);
  return m ? m.index : -1;
}

/**
 * r7 — is `at` inside a negated scope? A marker negates what FOLLOWS it in the
 * same ": "-delimited segment, up to the next coordinating boundary. Markers
 * after the claim, or before an intervening boundary, do not negate it.
 */
export function isNegatedAt(clause: string, at: number): boolean {
  const start = lastScopeBreak(clause, at);
  const scope = normalizeApostrophes(clause.slice(start < 0 ? 0 : start, at));
  const neg = lastMatchIndex(NEGATION_G, scope);
  if (neg < 0) return false;
  return neg > lastMatchIndex(NEG_BOUNDARY, scope);
}

/**
 * r7 — evidence-absence markers ("missing verified evidence") negate only
 * verification-family state words, not e.g. "the missing report is overdue".
 */
function isAbsentMarkedAt(clause: string, at: number): boolean {
  const start = lastScopeBreak(clause, at);
  const scope = normalizeApostrophes(clause.slice(start < 0 ? 0 : start, at));
  const neg = lastMatchIndex(STATE_ABSENT_G, scope);
  if (neg < 0) return false;
  return neg > lastMatchIndex(NEG_BOUNDARY, scope);
}

/** r7 — marker-before-claim test for conditional/modal scopes. */
function markerBefore(clause: string, at: number, markerG: RegExp, boundaryG: RegExp | null): boolean {
  const start = lastScopeBreak(clause, at);
  const scope = normalizeApostrophes(clause.slice(start < 0 ? 0 : start, at));
  const m = lastMatchIndex(markerG, scope);
  if (m < 0) return false;
  return boundaryG ? m > lastMatchIndex(boundaryG, scope) : true;
}

const CONDITIONAL_TYPES = new Set<ClaimType>([
  "verification_state", "acknowledgement_state", "overdue_state",
  "gap_state", "unassigned_state", "action_execution",
]);

export function splitClauses(sentence: string): string[] {
  return sentence.split(CLAUSE_SPLIT).map((s) => s.trim()).filter(Boolean);
}

/** r6: typographic apostrophes ("can’t") are the same negation as "can't". */
export const normalizeApostrophes = (s: string) => s.replace(/[\u2019\u2018\u02BC\u2032]/g, "'");

export function isNegatedClause(clause: string): boolean {
  return NEGATION.test(normalizeApostrophes(clause));
}

/** The ": "-delimited segment of `clause` that contains offset `at`. */
export function colonSegment(clause: string, at: number): string {
  const start = lastScopeBreak(clause, at);
  const end = nextScopeBreak(clause, at);
  return clause.slice(start < 0 ? 0 : start, end < 0 ? clause.length : end);
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
  /** attributed = quoting the user; conditional/modal = not system-truth assertions */
  polarity: "asserted" | "negated" | "attributed" | "conditional" | "modal";
  sentence: string;
  /** r4: the clause the claim was extracted from (change vs current-state) */
  clause?: string;
  /** r5: framed as recorded history ("was recorded as …") */
  historical?: boolean;
  /** r5: the cited activity event that supports the historical claim */
  historicalEventId?: string;
  /** r6: a clarifying date that could not be validated (no reference date) */
  notAssessed?: boolean;
  /** r7(B): the entity came from block inheritance, not the claim's own text —
   *  contextual scope, not a strict binding (support may fall back globally). */
  weakEntity?: boolean;
  /** r7(V2): the state word is an adjective modifying a noun ("the verified
   *  record") — an unbound descriptor is generic, not a state assertion. */
  descriptor?: boolean;
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
const CLAUSE_NO = /(?:clause|البند|الفقرة|المادة)[\s*_#]*(\d+(?:\.\d+)+)/gi;
const ASSIGNEE = /(?:assigned to|owner(?:\s+is|:)?|owned by|responsible(?:\s+is|:)?|المسؤول(?:\s+هو|:)?|مسؤول(?:\s+عن)?[^.:،,]{0,20}(?:هو|:)?)\s+([A-Za-z][A-Za-z.''-]{2,}|[\w.+-]+@[\w-]+\.[\w.]+|[\u0600-\u06FF]{2,}(?:\s[\u0600-\u06FF]{2,})?)/gi;
// r4: "not submitted" is its own claim (only an explicit no-submission state
// supports it); "awaiting/pending verification" is distinct from "pending /
// awaiting human review".
const VERIFY_STATE = /\b(not (?:yet )?(?:been )?submitted|never (?:been )?submitted|nothing (?:has been |was )?(?:uploaded|submitted)|verified|partially[- ]verified|incomplete|missing|needs?[ _-]?(?:a )?(?:human )?review|(?:pending|awaiting)\s+(?:human\s+)?(?:review|verification)|rejected|unverified)\b|لم يُ?رفع|لم يُ?قدَّ?م|موثّق|موثق|مُثبَت|مثبت|ناقص|مفقود|غير مكتمل|قيد المراجعة|بانتظار التحقق|يحتاج مراجعة|غير موثّق/gi;
const ACK_STATE = /(?:client|العميل|العميلة)\s+(?:has\s+|did\s+|have\s+)?(?:approved|acknowledged|accepted|signed|countersigned|rejected|اعتماد|اعتمد|أقرّ|اقرّ|وقّع|وقع|رفض)/gi;
const OVERDUE = /\b(?:is|are|was|became|now|currently|still)?\s*overdue\b|متأخر(?:ة|ًا|اً)?|متأخرة/gi;
const GAP_STATE = /(?:gaps?|فجوة|فجوات)\s+(?:is\s+|was\s+|are\s+|has been\s+|have been\s+|now\s+)?(?:resolved|closed|reopened|opened|open)|(?:resolved|closed|open|reopened)\s+(?:the\s+)?gaps?/gi;
const UNASSIGNED = /\bunassigned\b|no\s+(?:assigned\s+)?owner|without\s+(?:an?\s+)?owner|بلا مالك|بدون مالك|دون مالك|لا مالك|غير مُسند|غير مسند/gi;
const ACTION_EXEC = /\b(?:i|i've|i have|we)\s+(?:have\s+)?(?:resolved|closed|marked|changed|updated|rescheduled|assigned|approved|sent|emailed|notified|deleted|removed)\b|(?:the\s+)?(?:gap|deadline|due date|obligation)\s+(?:is|has been|was|got)\s+(?:resolved|closed|changed|updated|extended)|(?:the\s+)?(?:report|evidence|document|file|notice|notification|letter|statement)\s+(?:was|has been|got|is now)\s+(?:sent|emailed|notified|delivered|submitted|dispatched|transmitted)\b|تم\s+(?:حل|إغلاق|تغيير|تعيين|إرسال|اعتماد|تسليم|تقديم)|قمت\s+ب(?:حل|إغلاق|تغيير|تعيين|إرسال)/gi;

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
  /** r7: entity key → its parent (requirement→obligation→contract) */
  parents?: Map<string, string>;
  /** r7: entity key → entities nested under it */
  children?: Map<string, Set<string>>;
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
  // r7: explicit parent/child relations from the fixture identity
  const parents = new Map<string, string>();
  const children = new Map<string, Set<string>>();
  const link = (child: string, parent: string) => {
    parents.set(child, parent);
    children.set(parent, new Set([...(children.get(parent) ?? []), child]));
  };
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
    const oKey = `obligation:${c.obligationId}`;
    link(reqKey, oKey);
    link(itemKey, reqKey);
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
    link(oKey, cKey);
    link(`clause:${c.clauseId}`, cKey);
    for (const key of [cKey, oKey, `clause:${c.clauseId}`]) families.set(key, c.number);
    void k;
  }
  for (const name of fx.memberNames ?? []) add(name, `member:${name}`);
  for (const e of fx.memberEmails ?? []) { add(e, `member:${e}`); }
  return { tokens, idKeys, families, parents, children };
}

/** r7 — contract number an entity belongs to, or null when it has none. */
export function familyOf(entityKey: string, entities: EntityMap): string | null {
  return entities.families?.get(entityKey) ?? null;
}

/**
 * r7 — the entity plus everything nested UNDER it (transitive children).
 * Descendants-only is deliberate: a child claim must not be supported or
 * contradicted by an aggregate ancestor row (a contract row's "pending"
 * does not describe every requirement), while a contract-level claim DOES
 * read its obligations' rows.
 */
export function descOf(entityKey: string, entities: EntityMap): Set<string> {
  const kin = new Set<string>([entityKey]);
  const stack = [...(entities.children?.get(entityKey) ?? [])];
  while (stack.length) {
    const k = stack.pop()!;
    if (kin.has(k)) continue;
    kin.add(k);
    stack.push(...(entities.children?.get(k) ?? []));
  }
  return kin;
}

/**
 * r7(W+): true when the object's in-scope entities form one root-to-leaf
 * chain — a leaf row references its ancestors as foreign keys, so its values
 * describe that single subject. An aggregate shell binds several branches of
 * the scope at once (no chain exists) and proves nothing about any of them.
 */
function rowScoped(o: EvidenceCorpus["objects"][number], scope: Set<string>, entities: EntityMap): boolean {
  const hits = [...o.entities].filter((e) => scope.has(e));
  if (!hits.length) return false;
  return hits.some((h) => hits.every((x) => x === h || descOf(x, entities).has(h)));
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

/**
 * r7 — position-aware binding for clauses naming several entities. The claim
 * binds the entity whose mention ends nearest BEFORE the claim ("BETA-200 …
 * is already overdue, followed by GAMMA-300" → overdue belongs to BETA-200);
 * when nothing precedes, the nearest following mention. Returns null when the
 * clause names fewer than two entities (the caller's default path applies).
 */
export function bindEntityAt(clause: string, entities: EntityMap, at: number, rawEnd: number): string | null {
  const n = normalizeDigits(clause.toLowerCase());
  const occ: { key: string; pos: number; end: number }[] = [];
  for (const [token, key] of entities.tokens) {
    const re = new RegExp(`(^|[^\\w\\u0600-\\u06FF])${escapeRe(token)}(?=$|[^\\w\\u0600-\\u06FF])`, "gi");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(n))) {
      const pos = mm.index + mm[1].length;
      const end = pos + token.length;
      if (pos < rawEnd && end > at) continue; // the entity token IS the claim
      occ.push({ key, pos, end });
    }
  }
  if (new Set(occ.map((o) => o.key)).size < 2) return null;
  const before = occ.filter((o) => o.end <= at).sort((a, b) => b.end - a.end)[0];
  if (before) return before.key;
  const after = occ.filter((o) => o.pos >= rawEnd).sort((a, b) => a.pos - b.pos)[0];
  return after?.key ?? null;
}

// ---------- extraction --------------------------------------------------------

export function extractClaims(text: string, entities: EntityMap): FactClaim[] {
  const claims: FactClaim[] = [];
  const rawLines = text.split("\n");
  const lineKeys = rawLines.map((line) => lineEntity(line, entities));
  // r7(B): a line ending ':' introduces the following lines — a claim on it
  // ("One active obligation is unassigned:") inherits the listed entity.
  // Blank lines between the introducer and the first list row are skipped.
  for (let i = rawLines.length - 2; i >= 0; i--) {
    if (lineKeys[i] || !/[:：][*_~"'”»)\]\s]*$/.test(rawLines[i].trim())) continue;
    let j = i + 1;
    while (j < rawLines.length && !rawLines[j].trim()) j++;
    if (j < rawLines.length && lineKeys[j]) lineKeys[i] = lineKeys[j];
  }
  const units: { sentence: string; lineKey: string | null; weakKey: string | null }[] = [];
  let block: string | null = null;
  rawLines.forEach((line, i) => {
    // r7(B): a line naming no entity inherits its section's entity — a weak,
    // contextual binding (the claim text does not name the entity itself).
    const weakKey = lineKeys[i] == null ? block : null;
    const lineKey = lineKeys[i] ?? block;
    if (lineKeys[i]) block = lineKeys[i];
    // r7: sentence ends may carry trailing quotes/brackets/emphasis — a
    // closing ” after a period must not merge two sentences ("…report.” The
    // acknowledgement is missing" leaked the first sentence's "no").
    for (const s of line.split(/(?<=[.!؟?]["'”»’)\]*_~`]*)\s+/)) {
      const sentence = s.trim();
      if (sentence) units.push({ sentence, lineKey, weakKey });
    }
  });
  for (const { sentence, lineKey, weakKey } of units) {
    const sentenceEntity = bindEntity(sentence, entities) ?? lineKey;
    for (const clause of splitClauses(sentence)) {
      const attributed = isAttributedClause(clause);
      // Bind per clause first ("A is overdue, but B is fine") — fall back to
      // the sentence-level entity, then an unambiguous line/block entity.
      const entityKey = bindEntity(clause, entities) ?? sentenceEntity;
      let at = 0;
      const push = (type: ClaimType, raw: string, value: string, extra: Partial<FactClaim> = {}) => {
        if (!value) return;
        // r7(E): when a clause names several entities the claim binds the
        // one nearest BEFORE it — a trailing mention cannot steal the claim.
        const claimEntity = bindEntityAt(clause, entities, at, at + raw.length) ?? entityKey;
        // r7(P): negation is position-scoped — a marker negates what follows
        // it in the same colon-segment, ending at a coordinating boundary.
        const negated = isNegatedAt(clause, at) ||
          ((type === "verification_state" || type === "acknowledgement_state") && isAbsentMarkedAt(clause, at));
        // A state expression with its own internal negation ("غير مكتمل",
        // "not verified") ASSERTS a negative state — it is not a negated claim.
        const claimPolarity: FactClaim["polarity"] = attributed ? "attributed"
          : negated && !NEGATION.test(raw) ? "negated"
          : !negated && CONDITIONAL_TYPES.has(type) && markerBefore(clause, at, CONDITIONAL_G, null) ? "conditional"
          : !negated && CONDITIONAL_TYPES.has(type) && modalOfferAt(clause, at) ? "modal"
          : "asserted";
        // r7(V2): a state word in ADJECTIVE position ("the verified record",
        // "VAZORA's verified record") modifies a noun — it is not a state
        // assertion. Bound descriptors still face evidence; unbound ones are
        // generic descriptors of the system's data.
        const afterRaw = clause.slice(at + raw.length);
        const descriptor = (type === "verification_state" || type === "acknowledgement_state") &&
          claimPolarity === "asserted" &&
          NOUN_SCOPES.some(({ re }) => { re.lastIndex = 0; const mm = re.exec(afterRaw); return !!mm && mm.index < 40; });
        claims.push({
          type, raw, value: norm(value), entityKey: claimEntity, polarity: claimPolarity, sentence, clause,
          // weak only when the inherited block key is what bound the claim —
          // a clause/sentence-level entity of its own is a strong binding.
          weakEntity: (!!weakKey && claimEntity === weakKey) || undefined,
          descriptor: descriptor || undefined,
          ...extra,
        });
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
        // r8: an identifier fragment is not a name — "مسؤولية غير مسندة —
        // EPSILON-500" captured "epsilon-" because the class stops at digits.
        const after = clause.slice(mm.index + mm[0].length);
        if (/[-–—]$/.test(captured) || /^\d/.test(after)) return;
        if (!ASSIGNEE_STOP.has(captured) && !ASSIGNEE_STOP.has(first)) push("assignee_name", mm[0], mm[1]);
      });
      each(VERIFY_STATE, (mm) => {
        // "1 pending verification discrepancy" describes a PENDING DISCREPANCY,
        // not evidence awaiting verification.
        const describesDiscrepancy = /^pending\s+verification$/i.test(mm[0]) &&
          /^\s+discrepanc/i.test(clause.slice(mm.index + mm[0].length));
        // r5: "…was recorded as awaiting verification" = recorded history.
        const historical = RECORDED_AS.test(clause.slice(0, mm.index));
        push("verification_state", mm[0], describesDiscrepancy ? "pending" : normalizeState(mm[0]), historical ? { historical: true } : {});
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
  /** per-object: scalar values + entity keys present together.
   *  r7(W): `root` marks a top-level payload wrapper {ok,data:[…]} — its leaf
   *  set aggregates every row, so it can neither support nor contradict an
   *  entity-bound claim. */
  objects: { values: Set<string>; entities: Set<string>; root?: boolean }[];
  /** normalized whole payloads (substring fallback for odd phrasings) */
  raw: string;
  /** normalized user question — the only valid source for an ATTRIBUTED claim */
  question: string;
  /** r7: entity relations used for kinship-scoped support/contradiction */
  entities: EntityMap;
  /** r8: the recorded reference date ("today") the payloads carried — the
   *  clock half of the recorded clock/due-date relationship. */
  referenceDate?: string | null;
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

function indexObject(node: any, entities: EntityMap, out: EvidenceCorpus["objects"], inheritedTags: string[] = [], root = false) {
  if (node == null || typeof node !== "object") return;
  const values = new Set<string>();
  collectLeaves(node, values);
  collectMarkers(node, values);
  for (const t of inheritedTags) values.add(t);
  const ents = entitiesOf(values, entities);
  if (values.size) out.push({ values, entities: ents, root });
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
  /** r8: recorded reference date — grounds clock-derived deadline claims */
  referenceDate?: string | null;
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
      const parsed = JSON.parse(payload);
      const objs = payloadObjects(parsed);
      // r7(W): the {ok,data:[…]} wrapper aggregates every row — tag it as root.
      for (const obj of objs) {
        collectLeaves(obj, values);
        collectMarkers(obj, values);
        indexObject(obj, opts.entities, objects, tags, obj === parsed);
      }
    } catch { /* payload stayed opaque; raw scan still applies */ }
  }
  for (const v of [...opts.contextValues]) collectLeaves(v, values);
  collectLeaves(opts.question, values);
  return { values, objects, raw: norm(rawParts.join("\n")), question: norm(opts.question), entities: opts.entities, referenceDate: opts.referenceDate ?? null };
}

// ---------- claim support -----------------------------------------------------

export type ScoredClaim = FactClaim & {
  supported: boolean;
  /** "object" = bound entity co-occurs with value · "global" = value seen anywhere ·
   *  "derived" = clock/window arithmetic grounded in recorded data (r8) · "none" */
  supportKind: "object" | "global" | "context" | "user_input" | "derived" | "none";
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

/**
 * r7(V) — a negated/absent state is contradicted only within the scope of the
 * noun it governs: "no verified amount" is about monetary objects, "no verified
 * evidence" about evidence objects. The last class-matching noun in the claim's
 * segment wins ("no verified record of an amount" is about the amount).
 */
const NOUN_SCOPES: { re: RegExp; cls: string }[] = [
  { re: /\bgaps?\b|فجوة|فجوات/i, cls: "gap" },
  { re: /discrepanc\w*|تباين|تعارض|اختلاف/i, cls: "discrepancy" },
  { re: /\bobligations?\b|التزامات?|للالتزام/i, cls: "obligation" },
  { re: /\bcontracts?\b|عقود|عقد/i, cls: "contract" },
  { re: /\bclauses?\b|بنود|بند/i, cls: "clause" },
  { re: /\bmembers?\b|assignees?|owners?|مالك|مسؤول/i, cls: "member" },
  { re: /\b(?:amounts?|figures?|totals?|sums?|exposure|monetary|money|value)\b|مبلغ|مبالغ|قيمة|تعرض/i, cls: "monetary" },
  // acknowledgement is narrower than generic evidence: "no verified client
  // acknowledgement" is not contradicted by a verified report.
  { re: /\backnowledg\w+|countersign\w+|اعتماد|إقرار|توقيع/i, cls: "acknowledgement" },
  {
    re: /\b(?:records?|reports?|evidence|statements?|registers?|tables?|versions?|files?|copies|items?|requirements?|summar\w+|documentation|proof|data)\b|سجل|سجلات|تقرير|تقارير|دليل|أدلة|نسخة|ملف|بيانات/i,
    cls: "evidence",
  },
];

/** r7 — "of/من/عن" links an evidence-class noun to its real subject. */
const OF_LINK = /\b(?:of|for|to)\b|\b(?:من|عن|لـ|على)\b/i;

function governedNounClass(c: FactClaim): string | null {
  // The governed noun FOLLOWS a negated/adjectival claim: "no verified
  // AMOUNT", "no pending DISCREPANCY". First class-matching noun after the
  // claim (up to the next coordinating boundary) wins.
  const text = c.clause ?? c.sentence;
  const from = text.indexOf(c.raw);
  const after = from < 0 ? text : text.slice(from + c.raw.length);
  NEG_BOUNDARY.lastIndex = 0;
  const b = NEG_BOUNDARY.exec(after);
  const scope = b ? after.slice(0, b.index) : after;
  const firstIn = (s: string): string | null => {
    let best: { idx: number; end: number; cls: string } | null = null;
    for (const { re, cls } of NOUN_SCOPES) {
      re.lastIndex = 0;
      const m = re.exec(s);
      if (m && (!best || m.index < best.idx)) best = { idx: m.index, end: m.index + m[0].length, cls };
    }
    if (!best) return null;
    // "no verified record OF an amount" — an evidence-class noun linked by
    // of/من/عن defers its class to the complement's subject.
    if (best.cls === "evidence") {
      const rest = s.slice(best.end);
      OF_LINK.lastIndex = 0;
      const link = OF_LINK.exec(rest);
      if (link && link.index <= 12) {
        const inner: string | null = firstIn(rest.slice(link.index + link[0].length));
        if (inner && inner !== "evidence") return inner;
      }
    }
    return best.cls;
  };
  const fwd = firstIn(scope);
  if (fwd) return fwd;
  // "no amount is verified" — the governed noun precedes the claim.
  const before = from < 0 ? "" : text.slice(Math.max(0, lastScopeBreak(text, from)), from);
  const lastB = lastMatchEnd(NEG_BOUNDARY, before);
  return firstIn(lastB < 0 ? before : before.slice(lastB));
}

/** r7(V): does the object belong to the governed noun's class? */
function objectInClass(o: EvidenceCorpus["objects"][number], cls: string): boolean {
  const entityHas = (prefix: string) => [...o.entities].some((e) => e.startsWith(prefix));
  switch (cls) {
    case "gap": return o.values.has("gap_open") || [...o.values].some((v) => /gap/.test(v));
    case "discrepancy": return o.values.has("discrepancy_pending") || [...o.values].some((v) => /discrepanc/.test(v));
    case "obligation": return entityHas("obligation:");
    case "contract": return entityHas("contract:");
    case "clause": return entityHas("clause:");
    case "member": return entityHas("member:") || entityHas("obligation:");
    // monetary needs money-semantics — a bare 4-digit leaf is a year/timestamp
    case "monetary": return [...o.values].some((v) => /amount|price|deduction|liquidated|exposure|monetary|currency|ريال|ر\.س|\bsar\b|\busd\b|[$€£]/.test(v));
    case "acknowledgement": return [...o.values].some((v) => /acknowledg|countersign|اعتماد|إقرار/.test(v));
    case "evidence": return entityHas("requirement:") || entityHas("evidence_item:") || entityHas("clause:");
    default: return true;
  }
}

/**
 * Contract-scoped value types: the value is a fact of the contract's family —
 * day counts, clause numbers, and dates (a due date recorded on the obligation
 * row describes its requirement's schedule). Amounts and percentages stay
 * entity-bound: a figure on a sibling obligation must not support the claim.
 */
const FAMILY_VALUE_TYPES = new Set<ClaimType>(["day_count", "clause_number", "iso_date"]);
/** State claims about an entity may be evidenced by its descendants' rows. */
const KIN_SUPPORT_TYPES = new Set<ClaimType>([
  "verification_state", "acknowledgement_state", "overdue_state",
  "gap_state", "unassigned_state", "iso_date", "monetary_amount", "percentage",
]);

/** r8 — the claim's own clause frames a deadline quantity (not a generic count). */
const DEADLINE_CLUE =
  /\b(?:due|deadline|overdue|upcoming|expires?|scheduled)\b|متأخر|يستحق|مستحق|استحقاق|موعد|خلال|بحلول/i;
/** A recorded leaf that literally states a deadline day count ("Due in 2 day(s)"). */
const LEAF_DEADLINE_WORD = /due|deadline|overdue|متأخر|يستحق|مستحق|استحقاق|خلال/i;
const daysBetweenIso = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** r8 — "in the next seven days"/"خلال 7 أيام" names its own window length. */
const REL_WINDOW_EXPLICIT =
  /\b(?:in|within|over|inside|through|by)\s+(?:the\s+next\s+|the\s+coming\s+)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+days?\b|خلال\s+([0-9٠-٩]{1,4}|[\u0600-\u06FF]+?)\s*(?:يومًا?|أيام|يوم)/i;
/** r8 — "this week" without a stated number: any forward day inside a week. */
const REL_WINDOW_GENERIC =
  /\b(?:this|next|the coming)\s+week\b|end of (?:the\s+)?week|الأسبوع|بنهاية الأسبوع|بحلول نهاية/i;
function windowDayOffsets(sentence: string): number[] {
  const m = sentence.match(REL_WINDOW_EXPLICIT);
  if (m) {
    const t = normalizeDigits((m[1] ?? m[2] ?? "").toLowerCase());
    const n = /^\d+$/.test(t) ? Number(t) : Number(NUM_WORDS[t]);
    if (Number.isFinite(n) && n > 0) return [n];
  }
  if (REL_WINDOW_GENERIC.test(sentence)) return [1, 2, 3, 4, 5, 6, 7];
  return [];
}

export function scoreClaims(claims: FactClaim[], corpus: EvidenceCorpus): ScoredClaim[] {
  // r7(O): entities the answer already mentions, for "no other X" accounting.
  const mentionedKeys = new Set<string>();
  const mentionedFams = new Set<string>();
  for (const c of claims) {
    if (!c.entityKey) continue;
    mentionedKeys.add(c.entityKey);
    const f = familyOf(c.entityKey, corpus.entities);
    if (f) mentionedFams.add(f);
  }
  const hasValue = (o: EvidenceCorpus["objects"][number], v: string) =>
    o.values.has(v) || valueVariantHit(o.values, v);
  return claims.map((c) => {
    // A quoted user claim is supported only by what the user actually wrote;
    // attributing something the user never said is a misattribution.
    if (c.polarity === "attributed") {
      const said = tokenHit(corpus.question, c.value) || tokenHit(corpus.question, norm(c.raw));
      return { ...c, supported: said, supportKind: said ? "user_input" : "none" };
    }
    // r7(R): an identifier the USER supplied, echoed inside a modal/refusal
    // clause ("I first need to identify the relevant ZETA-600 report"), is
    // quoted context — not a system-truth assertion. It needs neither payload
    // support nor a citation; echoing it inside a refusal discloses nothing.
    if ((c.type === "contract_number" || c.type === "clause_number") &&
        markerBefore(c.clause ?? c.sentence, (c.clause ?? c.sentence).indexOf(c.raw), MODAL_G, NEG_BOUNDARY) &&
        tokenHit(corpus.question, c.value)) {
      return { ...c, polarity: "attributed", supported: true, supportKind: "user_input" };
    }
    // r7(M): conditional and modal claims are not assertions — "remains open
    // until verified" does not claim verified; "I can retrieve the open gaps"
    // is an unexecuted offer. Neither is held to evidence support.
    if (c.polarity === "conditional" || c.polarity === "modal") {
      return { ...c, supported: true, supportKind: "context" };
    }
    if (c.polarity === "negated") {
      if (!PREDICATE_TYPES.has(c.type)) return { ...c, supported: true, supportKind: "global" };
      const otherScoped = OTHER_SCOPE.test(c.clause ?? c.sentence);
      const cls = governedNounClass(c);
      const kin = c.entityKey ? descOf(c.entityKey, corpus.entities) : null;
      const contradicted = corpus.objects.some((o) => {
        if (o.root) return false; // r7(W): aggregate wrappers contradict nothing
        // r7(W+): an object spanning several contract families aggregates
        // leaves across rows — its values cannot be attributed to the claim's
        // subject (constraint: explicit relationships, not corpus-wide value).
        const fams = new Set([...o.entities].map((e) => familyOf(e, corpus.entities)).filter(Boolean));
        if (fams.size > 1) return false;
        // r7(W+): a bound claim reads single-subject rows only. A leaf row
        // references its ancestors by id (a chain); an aggregate shell binds
        // several branches of the subtree at once and its merged values
        // describe no one subject.
        if (kin && !rowScoped(o, kin, corpus.entities)) return false;
        if (cls && !objectInClass(o, cls)) return false;
        if (!hasValue(o, c.value)) return false;
        // r7(O): "no other pending discrepancy" — an object is accounted for
        // when it binds an entity (or its contract family) already mentioned.
        if (otherScoped && [...o.entities].some((e) =>
          mentionedKeys.has(e) || mentionedFams.has(familyOf(e, corpus.entities) ?? ""))) return false;
        return true;
      });
      return { ...c, supported: !contradicted, supportKind: contradicted ? "none" : "global" };
    }
    // Entity-bound claim: value and entity must co-occur in a row-level
    // object. r7(K): state claims also read descendant/ancestor rows (a
    // contract's "no gap" is contradicted by its obligation's gap row), and
    // contract-scoped value types match same-family rows.
    if (c.entityKey) {
      const kin = descOf(c.entityKey, corpus.entities);
      const family = familyOf(c.entityKey, corpus.entities);
      const familySet = family ? new Set(
        [...(corpus.entities.families?.entries() ?? [])]
          .filter(([, f]) => f === family).map(([e]) => e),
      ) : null;
      const scopeHit = (o: EvidenceCorpus["objects"][number]) => {
        if (o.root) return false;
        if (o.entities.has(c.entityKey!)) return true;
        if (KIN_SUPPORT_TYPES.has(c.type) && rowScoped(o, kin, corpus.entities)) return true;
        if (FAMILY_VALUE_TYPES.has(c.type) && familySet && rowScoped(o, familySet, corpus.entities)) return true;
        return false;
      };
      // r4: a contract-number claim is also supported when the object links
      // the claimed entity to that contract BY ID (a gap row carries
      // contract_id, not the literal "GAMMA-300").
      const contractKey = c.type === "contract_number" ? `contract:${c.value}` : null;
      const co = corpus.objects.some((o) => scopeHit(o) &&
        (o.values.has(c.value) || valueVariantHit(o.values, c.value) ||
          (!!contractKey && [...o.entities].some((k) => k.toLowerCase() === contractKey))));
      if (co) return { ...c, supported: true, supportKind: "object" };
      // r8 — a correctly computed deadline quantity: the evidence records the
      // clock (referenceDate) and either the entity's due-date leaf or a
      // rendered "in N day(s)" line; "2 days" is then arithmetic on recorded
      // facts, not invention. Wrong arithmetic still fails — the derived count
      // must equal |recordedDate − referenceDate|, with direction checked
      // against the claim's own overdue/upcoming wording.
      if (c.polarity === "asserted" && corpus.referenceDate) {
        const ref = corpus.referenceDate;
        const claimText = c.clause ?? c.sentence;
        if (c.type === "day_count" && DEADLINE_CLUE.test(claimText)) {
          const n = Number(c.value);
          const hit = Number.isFinite(n) && corpus.objects.some((o) => !o.root && scopeHit(o) &&
            [...o.values].some((v) => {
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                const diff = daysBetweenIso(ref, v); // due − today
                const past = /overdue|متأخر|منذ|ago\b|passed/i.test(claimText);
                const fwd = /\bin\b|within|upcoming|due\b|خلال|يستحق|مستحق|بعد/i.test(claimText);
                return Math.abs(diff) === n && (past ? diff < 0 : fwd ? diff > 0 : true);
              }
              const dm = v.match(/\b(\d{1,3})\s*day/i);
              return !!dm && LEAF_DEADLINE_WORD.test(v) && Number(dm[1]) === n;
            }));
          if (hit) return { ...c, supported: true, supportKind: "derived" };
        }
        // r8 — a relative-window end date ("in the next seven days — through
        // 6 October") binds the clock, not whichever entity the sentence also
        // named; it is supported when it equals today + the stated window.
        else if (c.type === "iso_date" && /^\d{4}-\d{2}-\d{2}$/.test(c.value)) {
          if (windowDayOffsets(c.sentence).some((k) => addDaysIso(ref, k) === c.value))
            return { ...c, supported: true, supportKind: "derived" };
        }
      }
      // r8 — a monetary/percentage claim may quote its own family's
      // contract-level recorded value: the contract row carries the amount
      // and quoting it is not an invention. Sibling-row figures stay
      // inadmissible; numbers nowhere in evidence still fail.
      if ((c.type === "monetary_amount" || c.type === "percentage") && familySet) {
        const familyContractKey = [...familySet].find((k) => k.startsWith("contract:"));
        if (familyContractKey && corpus.objects.some((o) => !o.root &&
          o.entities.has(familyContractKey) && [...o.entities].every((e) => familySet.has(e)) && hasValue(o, c.value)))
          return { ...c, supported: true, supportKind: "object" };
      }
      // r7(K): a contract number bound to an entity whose recorded contract
      // IS that number is an identifier relationship, not a payload literal.
      if (contractKey && family && norm(family) === c.value) {
        return { ...c, supported: true, supportKind: "context" };
      }
      // r7(K): a contract number bound to its own contract is a self-
      // reference (a mention, not a relational claim) — global support.
      if (contractKey && c.entityKey.toLowerCase() === contractKey) {
        const known = corpus.values.has(c.value) || tokenHit(corpus.raw, c.value) ||
          corpus.objects.some((o) => o.entities.has(c.entityKey!));
        return { ...c, supported: known, supportKind: known ? "context" : "none" };
      }
      // r7(B): block-INHERITED bindings are contextual — when no row-level
      // object supports the claim, global evidence still applies. Inheritance
      // must not be stricter than the r6 unbound path it replaced.
      if (c.weakEntity && (corpus.values.has(c.value) || valueVariantHit(corpus.values, c.value) || tokenHit(corpus.raw, c.value))) {
        return { ...c, supported: true, supportKind: "global" };
      }
      return { ...c, supported: false, supportKind: "none" };
    }
    if (corpus.values.has(c.value) || valueVariantHit(corpus.values, c.value))
      return { ...c, supported: true, supportKind: "global" };
    // r7(V2): an unbound state word used as an adjective ("VAZORA's verified
    // record") describes the data, not an entity's state — context, no check.
    if (c.descriptor) return { ...c, supported: true, supportKind: "context" };
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
    // r8: a contract number bound to its own contract is a self-reference —
    // naming "BETA-200" while discussing BETA-200 establishes identity, not a
    // record claim that needs a cited payload (an answer that only clarifies
    // may have made no call at all). Other claims on the entity still count.
    if (c.type === "contract_number" && c.entityKey.toLowerCase() === `contract:${c.value}`) continue;
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
        // r5: a verified historical claim is bound to the exact event that supports it
        const ev = c.historicalEventId ? citations.find((x) => x.id === c.historicalEventId) : citations.find((x) => {
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

export type ActivityIndex = Map<string, {
  values: Set<string>; entities: Set<string>;
  /** r5: the event's action, and the statuses its content RECORDED (history only) */
  eventType?: string; recordedStates?: Set<string>;
}>;

/** r5: statuses written in an event's content — evidence of HISTORY, never of current state. */
function recordedStatesOf(node: any): Set<string> {
  const strings = new Set<string>();
  collectLeaves(node, strings);
  const states = new Set<string>();
  for (const s of strings) {
    VERIFY_STATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VERIFY_STATE.exec(s))) states.add(normalizeState(m[0]));
  }
  return states;
}

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
      idx.set(node.id, { values, entities: entitiesOf(values, entities), eventType: node.event_type, recordedStates: recordedStatesOf(node) });
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
  if (c.historicalEventId) return true; // r5: verified recorded history
  const clause = c.clause ?? c.sentence;
  if (!CHANGE_VERB.test(clause)) return false;
  if (IDENTITY_TYPES.has(c.type)) return true;
  return PAST_AUX.test(clause) && !PRESENT_STATE.test(clause);
}

// ---------- r5: recorded history -------------------------------------------------

/** "…was recorded as <state>" — the state is what an event RECORDED.
 *  r7(H2): compound forms — "was uploaded for **Monthly logistics report**
 *  and recorded as …" — carry the auxiliary to "recorded" through an
 *  intervening verb phrase (markdown emphasis, objects, "and" included). */
const RECORDED_AS = /\b(?:was|were|had been|has been|have been)\s+(?:(?!recorded|logged|registered|marked|as\b)\S+\s+){0,10}(?:recorded|logged|registered|marked)\b(?:\s+(?!as\b)\S+){0,5}\s+as\s+$|(?:\S+\s+){0,4}(?:سُ?جِّ?لَ?ت?|سُجل|وُثِّ?ق|وثّق)(?:\s+\S+){0,4}\s+(?:على أنه|على أنها|بأنه|بأنها|بوصفه|بوصفها|كـ?|كمـ?)\s*$/i;

/** The event's action must be the historical context the answer describes. */
const ACTION_FAMILIES: { clause: RegExp; event: RegExp }[] = [
  { clause: /upload|received|new version|رفع|استلام|نسخة/i, event: /upload|version|received/i },
  { clause: /confirm|تأكيد|أُكِّد/i, event: /confirm/i },
  { clause: /assign|إسناد|أُسند/i, event: /assign/i },
  { clause: /overr|تجاوز/i, event: /override/i },
];

/**
 * Resolve r5 historical claims. A claim framed as recorded history is
 * supported ONLY by an activity event the answer CITES whose
 *   (a) entity is the claimed record,
 *   (b) recorded content states that same status, and
 *   (c) action matches the context the sentence describes (e.g. an upload).
 * Otherwise it is unsupported — whatever the current state is. Current-state
 * claims are untouched (they still need current-state evidence).
 */
export function resolveHistoricalClaims(
  claims: ScoredClaim[], citations: { target: string; id: string }[], activity: ActivityIndex,
  entities?: EntityMap,
): ScoredClaim[] {
  return claims.map((c) => {
    if (!c.historical || c.polarity !== "asserted") return c;
    // r7(K): an event binding a descendant entity (the uploaded item when
    // the claim names its requirement) still matches.
    const kin = entities && c.entityKey ? descOf(c.entityKey, entities) : null;
    const hit = c.entityKey ? citations.find((x) => {
      const e = activity.get(x.id);
      const entityHit = !!e && (e.entities.has(c.entityKey!) ||
        (!!kin && [...e.entities].some((k) => kin.has(k))));
      return entityHit && !!e.recordedStates?.has(c.value) &&
        ACTION_FAMILIES.some((f) => f.clause.test(c.sentence) && f.event.test(e.eventType ?? ""));
    }) : undefined;
    return hit
      ? { ...c, supported: true, supportKind: "object", historicalEventId: hit.id }
      : { ...c, supported: false, supportKind: "none", historicalEventId: undefined };
  });
}

// ---------- r6: clarifying dates -------------------------------------------------

const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const isoDay = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const addDaysIso = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Calendar candidates the user's relative weekday wording can mean. */
export function relativeWeekdayCandidates(question: string, referenceDate: string): { phrase: string; weekday: number; dates: string[] } | null {
  const q = question.toLowerCase();
  const en = q.match(/\b(next|this|coming)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  const arIdx = WEEKDAYS_AR.findIndex((d) => question.includes(d));
  const weekday = en ? WEEKDAYS_EN.indexOf(en[2]) : arIdx;
  if (weekday < 0) return null;
  const next = en ? en[1] === "next" : /(القادم|القادمة|المقبل|المقبلة)/.test(question);
  let first = addDaysIso(referenceDate, 1);
  while (isoDay(first) !== weekday) first = addDaysIso(first, 1);
  // "next Friday" is genuinely ambiguous: the coming one, or the one after.
  return { phrase: en?.[0]?.trim() ?? WEEKDAYS_AR[weekday], weekday, dates: next ? [first, addDaysIso(first, 7)] : [first] };
}

const isQuestionSentence = (s: string) => /[?؟]["'”»*_)\s]*$/.test(s.trim());
/**
 * r8 — a clarifying request need not end in "?": "Please confirm the exact
 * date: 2026-10-02 or 2026-10-09." is the same act as "Do you mean …?".
 * The offered dates are still validated against the recorded reference
 * date — the marker only decides WHERE candidates may appear.
 */
const CLARIFY_REQUEST =
  /please\s+(?:confirm|clarify|specify)|\bconfirm\s+the\s+(?:exact|explicit|intended|target)\b|which\s+(?:date|day)\b|do you mean|did you mean|please\s+(?:choose|pick)|specify\s+the\s+(?:date|day)|أكّد|أكد|حدد|وضّح|وضح|اختر|يرجى|أتقصد|تقصد/i;
const isClarifyingSentence = (s: string) => isQuestionSentence(s) || CLARIFY_REQUEST.test(s);

export function resolveClarifyingDates(
  scored: ScoredClaim[], ctx: { question: string; referenceDate: string | null },
): { scored: ScoredClaim[]; notAssessed: string[] } {
  const notAssessed: string[] = [];
  const out = scored.map((c) => {
    if (c.type !== "iso_date" || c.supported || c.polarity !== "asserted" || !isClarifyingSentence(c.sentence)) return c;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.value)) return c;
    if (!ctx.referenceDate) {
      notAssessed.push(`clarifying date ${c.value}: no recorded reference date — not validated`);
      return { ...c, supported: true, supportKind: "context" as const, notAssessed: true };
    }
    const cand = relativeWeekdayCandidates(ctx.question, ctx.referenceDate);
    if (!cand || !cand.dates.includes(c.value)) return c;
    // A weekday written next to the date must be that date's weekday.
    const before = c.sentence.slice(Math.max(0, c.sentence.indexOf(c.raw) - 24), c.sentence.indexOf(c.raw)).toLowerCase();
    const named = WEEKDAYS_EN.findIndex((d) => before.includes(d));
    const namedAr = WEEKDAYS_AR.findIndex((d) => before.includes(d));
    const w = named >= 0 ? named : namedAr;
    if (w >= 0 && w !== isoDay(c.value)) return c;
    return { ...c, supported: true, supportKind: "context" as const };
  });
  return { scored: out, notAssessed };
}

// ---------- r6: scoped contract health --------------------------------------------

const SCOPED_EN = /no actionable issues are recorded within the checks and data available/i;
const SCOPED_AR = /لا توجد مشكلات قابلة للإجراء مسجّلة ضمن الفحوصات والبيانات المتاحة/;
const HEALTH_CLAIM = /\b(healthy|on track|in good (?:health|standing|shape))\b|سليم|بحالة جيدة/i;
const HEALTH_NEGATED = /\b(not|isn't|no longer|cannot be (?:called|described|considered))\s+(?:\w+\s+){0,2}(healthy|on track|in good)|ليس\s+سليم|غير\s+سليم/i;
const BROAD_COMPLIANCE = /\b(fully compliant|full compliance|compliant with (?:all|every|the entire|its)|all (?:contractual )?obligations (?:are |have been )?(?:met|satisfied|fulfilled)|no (?:contractual |compliance )?risks?|risk[- ]free|guaranteed)\b|ملتزم بالكامل|امتثال كامل|متوافق بالكامل|جميع الالتزامات مستوفاة/i;
const CONTRACT_REF = /\b[A-Z]{2,10}-\d{2,6}\b/g;

export function assessScopedHealth(
  text: string, trace: { tool: string; ok: boolean; payload: string }[],
): { scopedSupported: boolean; failures: string[]; usedHealthTool: boolean } {
  const health = new Map<string, any>();
  let usedHealthTool = false;
  for (const t of trace) {
    if (t.tool !== "getContractHealth" || !t.ok) continue;
    usedHealthTool = true;
    try {
      const p = JSON.parse(t.payload);
      const list = p?.truncated === true && typeof p.data === "string"
        ? completeObjects(p.data).filter((o: any) => o && o.contractNumber)
        : (p?.data?.contracts ?? []);
      for (const h of list as any[]) health.set(String(h.contractNumber).toUpperCase(), h);
    } catch { /* opaque payload */ }
  }
  const failures: string[] = [];
  let supportedStatements = 0;
  const lines = text.split("\n");
  let lastNamed: string[] = [];
  lines.forEach((line) => {
    const named = [...new Set((line.match(CONTRACT_REF) ?? []).map((x) => x.toUpperCase()))];
    const scope = named.length ? named : lastNamed;
    if (named.length) lastNamed = named;
    if (SCOPED_EN.test(line) || SCOPED_AR.test(line)) {
      if (scope.length !== 1) { failures.push(`scoped no-issues statement not attributable to exactly one contract (${scope.join(",") || "none"})`); return; }
      const h = health.get(scope[0]);
      if (!h) failures.push(`scoped no-issues statement for ${scope[0]} without that contract's own getContractHealth result`);
      else if (h.verdict !== "no_actionable_issues_recorded") failures.push(`scoped no-issues statement for ${scope[0]} but its verdict is ${h.verdict}`);
      else if ((h.coverage?.gaps ?? []).length) failures.push(`scoped no-issues statement for ${scope[0]} with incomplete coverage: ${(h.coverage.gaps as string[]).join("; ")}`);
      else supportedStatements++;
    }
    if (usedHealthTool && HEALTH_CLAIM.test(line) && !HEALTH_NEGATED.test(normalizeApostrophes(line))) {
      for (const n of scope) {
        const h = health.get(n);
        if (h && h.verdict !== "no_actionable_issues_recorded") failures.push(`${n} presented as healthy but its getContractHealth verdict is ${h.verdict}`);
      }
    }
    if (BROAD_COMPLIANCE.test(line)) failures.push(`broad compliance claimed from a limited health assessment: "${line.trim().slice(0, 80)}"`);
  });
  return { scopedSupported: supportedStatements > 0 && failures.length === 0, failures, usedHealthTool };
}
