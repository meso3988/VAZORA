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
  polarity: "asserted" | "negated";
  sentence: string;
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
const DAY_COUNT = new RegExp(`${AR_NUM}\\s*(?:days?\\b|يومًا?|أيام|يوم)${AR_BOUNDARY}`, "gi");
const CONTRACT_NO = /\b[A-Z]{2,10}-\d{2,6}\b/g;
const CLAUSE_NO = /(?:clause|البند|الفقرة|المادة)\s*#?\s*(\d+(?:\.\d+)+)/gi;
const ASSIGNEE = /(?:assigned to|owner(?:\s+is|:)?|owned by|responsible(?:\s+is|:)?|المسؤول(?:\s+هو|:)?|مسؤول(?:\s+عن)?[^.:،,]{0,20}(?:هو|:)?)\s+([A-Za-z][A-Za-z.''-]{2,}|[\w.+-]+@[\w-]+\.[\w.]+|[\u0600-\u06FF]{2,}(?:\s[\u0600-\u06FF]{2,})?)/gi;
const VERIFY_STATE = /\b(verified|partially[- ]verified|incomplete|missing|needs?[ _-]?(?:a )?(?:human )?review|pending(?:\s+review)?|rejected|unverified)\b|موثّق|موثق|مُثبَت|مثبت|ناقص|مفقود|غير مكتمل|قيد المراجعة|يحتاج مراجعة|غير موثّق/gi;
const ACK_STATE = /(?:client|العميل|العميلة)\s+(?:has\s+|did\s+|have\s+)?(?:approved|acknowledged|accepted|signed|countersigned|rejected|اعتماد|اعتمد|أقرّ|اقرّ|وقّع|وقع|رفض)/gi;
const OVERDUE = /\b(?:is|are|was|became|now|currently|still)?\s*overdue\b|متأخر(?:ة|ًا|اً)?|متأخرة/gi;
const GAP_STATE = /(?:gap|فجوة|فجوات)\s+(?:is\s+|was\s+|has been\s+|now\s+)?(?:resolved|closed|reopened|opened|open)|(?:resolved|closed)\s+(?:the\s+)?gap/gi;
const UNASSIGNED = /\bunassigned\b|no\s+(?:assigned\s+)?owner|without\s+(?:an?\s+)?owner|بلا مالك|بدون مالك|دون مالك|لا مالك|غير مُسند|غير مسند/gi;
const ACTION_EXEC = /\b(?:i|i've|i have|we)\s+(?:have\s+)?(?:resolved|closed|marked|changed|updated|rescheduled|assigned|approved|sent|emailed|notified|deleted|removed)\b|(?:the\s+)?(?:gap|deadline|due date|obligation)\s+(?:is|has been|was|got)\s+(?:resolved|closed|changed|updated|extended)|تم\s+(?:حل|إغلاق|تغيير|تعيين|إرسال|اعتماد)|قمت\s+ب(?:حل|إغلاق|تغيير|تعيين|إرسال)/gi;

function normalizeState(v: string): string {
  const s = norm(v);
  if (/verified|موثّق|موثق|مُثبَت|مثبت/.test(s) && !/unverif|not verif|غير/.test(s)) return "verified";
  if (/partially/.test(s)) return "partially_verified";
  if (/missing|مفقود/.test(s)) return "missing";
  if (/incomplete|ناقص|غير مكتمل/.test(s)) return "incomplete";
  if (/needs?[ _-]?(?:a )?(?:human )?review|pending\s+review|قيد المراجعة|يحتاج مراجعة/.test(s)) return "needs_review";
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
    void k;
  }
  for (const name of fx.memberNames ?? []) add(name, `member:${name}`);
  for (const e of fx.memberEmails ?? []) { add(e, `member:${e}`); }
  return { tokens, idKeys };
}

/** Longest entity token found in the sentence → its canonical key. */
function bindEntity(sentence: string, entities: EntityMap): string | null {
  const n = norm(sentence);
  let best: string | null = null;
  let bestLen = 0;
  for (const [token, key] of entities.tokens) {
    if (token.length > bestLen && n.includes(token)) {
      best = key;
      bestLen = token.length;
    }
  }
  return best;
}

// ---------- extraction --------------------------------------------------------

export function extractClaims(text: string, entities: EntityMap): FactClaim[] {
  const claims: FactClaim[] = [];
  const sentences = text.split(/(?<=[.!؟?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const entityKey = bindEntity(sentence, entities);
    for (const clause of splitClauses(sentence)) {
      const polarity: FactClaim["polarity"] = isNegatedClause(clause) ? "negated" : "asserted";
      const push = (type: ClaimType, raw: string, value: string) => {
        if (!value) return;
        claims.push({ type, raw, value: norm(value), entityKey, polarity, sentence });
      };
      let m: RegExpExecArray | null;
      const each = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
        re.lastIndex = 0;
        while ((m = re.exec(clause))) fn(m);
      };
      each(MONEY, (mm) => {
        const digits = normalizeDigits(mm[0]).match(/[\d,.\u066C]+/);
        push("monetary_amount", mm[0], digits ? digits[0].replace(/[,.\u066C]/g, "") : mm[0]);
      });
      each(PERCENT, (mm) => push("percentage", mm[0], normalizeDigits(mm[0])));
      each(ISO_DATE, (mm) => push("iso_date", mm[0], mm[0]));
      each(MONTH_DATE, (mm) => push("iso_date", mm[0], normalizeMonthDate(mm[0])));
      each(DAY_COUNT, (mm) => {
        const d = normalizeDigits(mm[0]).match(/\d+/);
        if (d) push("day_count", mm[0], d[0]);
      });
      each(CONTRACT_NO, (mm) => push("contract_number", mm[0], mm[0]));
      each(CLAUSE_NO, (mm) => push("clause_number", mm[0], mm[1]));
      each(ASSIGNEE, (mm) => push("assignee_name", mm[0], mm[1]));
      each(VERIFY_STATE, (mm) => push("verification_state", mm[0], normalizeState(mm[0])));
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

function indexObject(node: any, entities: EntityMap, out: EvidenceCorpus["objects"], inheritedTags: string[] = []) {
  if (node == null || typeof node !== "object") return;
  const values = new Set<string>();
  collectLeaves(node, values);
  for (const t of inheritedTags) values.add(t);
  const ents = new Set<string>();
  for (const v of values) {
    const idKey = entities.idKeys.get(v);
    if (idKey) ents.add(idKey);
    for (const [token, key] of entities.tokens) {
      if (token === v || (token.length > 3 && v.includes(token))) ents.add(key);
    }
  }
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
      const parsed = JSON.parse(payload);
      collectLeaves(parsed, values);
      indexObject(parsed, opts.entities, objects, tags);
    } catch { /* payload stayed opaque; raw scan still applies */ }
  }
  for (const v of [...opts.contextValues]) collectLeaves(v, values);
  collectLeaves(opts.question, values);
  return { values, objects, raw: norm(rawParts.join("\n")) };
}

// ---------- claim support -----------------------------------------------------

export type ScoredClaim = FactClaim & {
  supported: boolean;
  /** "object" = bound entity co-occurs with value · "global" = value seen anywhere · "none" */
  supportKind: "object" | "global" | "context" | "none";
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
  return false;
}

export function scoreClaims(claims: FactClaim[], corpus: EvidenceCorpus): ScoredClaim[] {
  return claims.map((c) => {
    if (c.polarity === "negated") {
      if (!PREDICATE_TYPES.has(c.type)) return { ...c, supported: true, supportKind: "global" };
      const contradicted = c.entityKey
        ? corpus.objects.some((o) => o.entities.has(c.entityKey!) && o.values.has(c.value))
        : corpus.values.has(c.value);
      return { ...c, supported: !contradicted, supportKind: contradicted ? "none" : "global" };
    }
    // Entity-bound claim: value and entity must co-occur in the SAME
    // tool-result object. No global fallback — that is the whole point of
    // binding (a "12 days" true of XRAY-900 cannot support BETA-200).
    if (c.entityKey) {
      const co = corpus.objects.some((o) => o.entities.has(c.entityKey!) &&
        (o.values.has(c.value) || valueVariantHit(o.values, c.value)));
      if (co) return { ...c, supported: true, supportKind: "object" };
      return { ...c, supported: false, supportKind: "none" };
    }
    if (corpus.values.has(c.value) || valueVariantHit(corpus.values, c.value))
      return { ...c, supported: true, supportKind: "global" };
    if (corpus.raw.includes(c.value)) return { ...c, supported: true, supportKind: "context" };
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
): ClaimCitationCheck[] {
  const citedIds = new Set(citations.map((c) => c.id));
  const checks: ClaimCitationCheck[] = [];
  const seen = new Set<string>();
  for (const c of claims) {
    if (!c.entityKey || c.polarity !== "asserted") continue;
    // member-bound claims are contextual — no citation target exists for
    // members; citations belong on the operational entity (obligation etc.)
    if (c.entityKey.startsWith("member:")) continue;
    if (seen.has(c.entityKey)) continue;
    seen.add(c.entityKey);
    const allowed = entityToIds.get(c.entityKey) ?? new Set([c.entityKey]);
    const hits = citations.filter((x) => allowed.has(x.id)).map((x) => `${x.target}:${x.id}`);
    checks.push({
      claimEntity: c.entityKey,
      satisfied: hits.length > 0 || [...allowed].some((id) => citedIds.has(id)),
      citedBy: hits,
    });
  }
  return checks;
}
