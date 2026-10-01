/**
 * EVALUATOR V4 — MATERIALITY DETECTOR (component 1 of the hybrid design)
 *
 * ONE question, asked of ONE already-segmented assertion unit:
 *
 *   "Does this unit assert something checkable against a VAZORA record, state,
 *    event, obligation, evidence item, financial fact, date, authorization
 *    state, or executed action?"
 *
 * It deliberately does NOT decide truth, does NOT extract a typed claim, does
 * NOT touch a record, a citation, or an execution status. Those are later
 * layers. It redefines no deterministic invariant: tenant isolation,
 * authorization, mutation checks, idempotency, citation validity, execution
 * state, financial comparison and sweep/health safety all remain exactly where
 * they are and are unaffected by this file.
 *
 * UNCERTAIN is fail-safe and deliberate: domain vocabulary with no detectable
 * predication must never be forced into NON_MATERIAL to flatter precision.
 */

import type { Unit } from "./segment";

export type Materiality = "MATERIAL_ASSERTION" | "NON_MATERIAL" | "UNCERTAIN";

export type MaterialityResult = {
  label: Materiality;
  reason: string;
  signals: string[];
};

// ---------------------------------------------------------------------------
// Record-domain vocabulary — the things VAZORA actually keeps records about
// ---------------------------------------------------------------------------
const DOMAIN = new RegExp(
  [
    // ownership / responsibility
    "owner|owners|ownership|assignee|assigned|assignment|responsib\\w*|nominee|designee",
    // obligations / contracts / clauses
    "obligation|requirement|contract|clause|section|schedule|filing|return|deliverable",
    // evidence / verification
    "evidence|document|register|report|acknowledg\\w*|verification|verified|discrepanc\\w*|conflict|gap|submission|notice|certificate|signature|KPI",
    // actions / authorization
    "proposal|approval|sign-?off|authoris\\w*|authoriz\\w*|execution|action|task|reassignment|transfer",
    // temporal
    "deadline|due|overdue|date|day|days|window|period|month|week",
    // financial
    "exposure|amount|figure|value|deduction|penalt\\w*|payment|invoice|damages|percent",
    // assessment / health
    "sweep|assessment|health|status|state|coverage|observation",
    // Arabic
    "مسؤول|مسؤولة|مالك|ملكية|إسناد|مسند|التزام|متطلب|عقد|بند|جدول",
    "دليل|مستند|سجل|تقرير|إقرار|تحقق|تباين|فجوة|إرسال|إشعار|شهادة|توقيع",
    "مقترح|موافقة|اعتماد|تفويض|تنفيذ|إجراء|مهمة|تحويل",
    "موعد|مهلة|مستحق|متأخر|تاريخ|يوم|أيام|شهر|أسبوع|فترة",
    "تعرض|مبلغ|قيمة|خصم|غرامة|دفعة|فاتورة|تعويض",
    "تقييم|حالة|تغطية|ملاحظة|جهة",
  ].join("|"),
  "i",
);

/** Something happened / was done — includes paraphrases, passives, Arabic تم. */
const ACTION = new RegExp(
  [
    "\\b(sent|send|sends|submitted|submit|filed|file|uploaded|upload|issued|issue)\\b",
    "\\b(resolved|resolve|closed|close|completed|complete|settled|settle|wrapped)\\b",
    "\\b(updated|update|changed|change|moved|move|applied|apply|marked|mark|pushed|rescheduled|reschedul\\w*)\\b",
    "\\b(assigned|assign|reassigned|approved|approve|authoris\\w*|authoriz\\w*|signed|sign)\\b",
    "\\b(verified|verify|acknowledged|acknowledge|countersigned|checked|re-?checked)\\b",
    "\\b(executed|execute|actioned|action|took care|went out|out the door|carried out|in place)\\b",
    "\\b(sits with|belongs to|owned by|handled by|looks after|handles|owns)\\b",
    // Arabic verbs and the تم-passive family
    "تم\\s|تمّ\\s|تمت|أُنجز|أنجز\\w*|أرسل\\w*|سلّم\\w*|سلم\\w*|رفع\\w*|رُفع|وقّع\\w*|وُقّع",
    "أغلق\\w*|حدّث\\w*|حدث\\w*|عدّل\\w*|اعتمد\\w*|اعتُمد|تُعتمد|أسند\\w*|نُفّذ|نُفِّذ|يُنفّذ|قُبل|أبلغ\\w*|أفاد\\w*",
  ].join("|"),
  "i",
);

/** A record state is predicated. */
const STATE = new RegExp(
  [
    "\\b(verified|missing|pending|outstanding|open|closed|unassigned|vacant|confirmed|unconfirmed)\\b",
    "\\b(incomplete|complete|resolved|overdue|due|awaiting|partial|stale|active|inactive|unchanged)\\b",
    "متحقق|مفقود|معلّق|معلق|مفتوح|مغلق|شاغر|مؤكد|مكتمل|متأخر|مستحق|سليم|سارٍ|ساري|قائم|مسجل|موثّق|موثق",
  ].join("|"),
  "i",
);

/**
 * Arabic-safe word boundary. JavaScript's \b is defined over [A-Za-z0-9_], so
 * `\bلا\b` never matches and — worse — a bare `لا` matches inside words such as
 * "الالتزام". Lookarounds over the Arabic letter range give a real boundary.
 */
const AR = (tokens: string[]) => `(?<![\\u0621-\\u064A])(?:${tokens.join("|")})(?![\\u0621-\\u064A])`;

/** Negation — a negated record assertion stays material. */
const NEGATION = new RegExp(
  [
    "\\b(no|not|never|nobody|none|without|cannot|can't|cant|won't|hasn't|haven't|isn't|aren't|didn't|doesn't)\\b",
    AR(["لم", "لن", "ليس", "غير", "بلا", "لا", "مطلقا", "مطلقًا", "دون", "عدم"]),
  ].join("|"),
  "i",
);

/** Numbers, currency, and relative/absolute time references. */
const QUANTITY = new RegExp(
  [
    "\\d",
    "\\b(SAR|USD|ر\\.?س)\\b|ريال",
    "\\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|fortnight)\\b",
    "\\b(today|yesterday|tomorrow|ago|last (week|month|year)|this (week|month|morning)|next (week|month))\\b",
    "اليوم|أمس|غدًا|غدا|الماضي|القادم|المقبل|واحد|اثنان|ثلاثة|أربعة|خمسة|ستة|سبعة|ثمانية|تسعة|عشرة",
  ].join("|"),
  "i",
);

/** Generic identifier shape (same convention as the segmenter). */
const ENTITY = /\b[A-Z][A-Z0-9]{1,}-\d+\b/;

/** Officer reproduces text rather than adopting it. */
const QUOTATION_FRAME = /\b(reads|states|says|quotes?)\b\s*[:,]\s*["“«]|^["“«][^"”»]{15,}["”»]\.?$/i;

/** Officer describes an instruction found in untrusted content. */
const INSTRUCTION_DESC = /\b(instructs?|tells me to|asks me to|directs?|demands?|requires me to)\b|يطلب|يطالب|يأمر/i;
const UNTRUSTED = /\buntrusted\b|\bno (?:\w+ )?authority\b|\bnot authoritative\b|غير موثوق|لا سلطة/i;

/** Capability framing: "I can / I am able to …" (positive) vs negated. */
const CAPABILITY = new RegExp(
  `\\b(i|we)\\b[^.]{0,30}\\b(can|could|am able|are able|cannot|can't|cant|unable)\\b|${AR(["أستطيع", "يمكنني", "أقدر", "بإمكاني"])}`,
  "i",
);
const CAPABILITY_NEGATED = new RegExp(
  `\\b(i|we)\\b[^.]{0,30}\\b(cannot|can't|cant|unable|will not|won't)\\b|لا\\s+(?:أستطيع|يمكنني|أقدر)`,
  "i",
);

/**
 * An action the Officer predicates as having happened (or explicitly not
 * happened) — distinct from an action word used as a modifier ("the uploaded
 * note") or quoted inside an instruction ("tells me to mark it resolved").
 */
const OFFICER_ACTION_OCCURRENCE = new RegExp(
  [
    "\\b(i|we)\\s+(?:have|had|has|did|didn't|have not|haven't)\\b",
    "\\b(i|we)\\s+\\w+(?:ed|nt)\\b",
    "\\b(has|have|had|was|were|is|are)\\s+(?:now\\s+|already\\s+|just\\s+)?(?:been\\s+)?\\w+(?:ed|en|out)\\b",
    "\\bis now\\b|\\balready\\b|\\bout the door\\b|\\bwent out\\b|\\btook care\\b",
    AR(["تم", "تمت", "تمّ", "أغلقت", "أنجزت", "أنجزتها", "سلّمنا", "سلّمناه", "أسندنا", "أسندناه", "حدّثت", "رُفع", "وُقّع", "نُفّذ", "اعتُمد"]),
  ].join("|"),
  "i",
);

export function classifyMateriality(u: Pick<Unit, "text" | "modality"> & { sentence?: string }): MaterialityResult {
  const t = u.text;
  // Identifier codes carry digits; they must not count as a quantity.
  const withoutEntities = t.replace(/\b[A-Z][A-Z0-9]{1,}-\d+\b/g, " ");
  const signals: string[] = [];
  const has = (re: RegExp, name: string, subject: string = t) => {
    const hit = re.test(subject);
    if (hit) signals.push(name);
    return hit;
  };

  const domain = has(DOMAIN, "domain");
  const entity = has(ENTITY, "entity");
  const action = has(ACTION, "action");
  const state = has(STATE, "state");
  const negation = has(NEGATION, "negation");
  const quantity = has(QUANTITY, "quantity", withoutEntities);

  // 1. A genuine question asserts nothing.
  if (u.modality === "QUESTION") return { label: "NON_MATERIAL", reason: "question asserts nothing", signals };

  // 2. Reproduced text is not an adopted claim.
  if (QUOTATION_FRAME.test(t)) return { label: "NON_MATERIAL", reason: "quotation not adopted by the Officer", signals };

  // 3. Describing an untrusted instruction is not a record claim — unless the
  //    Officer also predicates that an action did or did not occur. The
  //    "untrusted" qualifier may sit in a neighbouring clause of the same
  //    sentence, so qualifier scope is the sentence (claim scope stays clausal).
  const qualifierScope = u.sentence ?? t;
  if (INSTRUCTION_DESC.test(t) && UNTRUSTED.test(qualifierScope) && !OFFICER_ACTION_OCCURRENCE.test(t)) {
    return { label: "NON_MATERIAL", reason: "describes untrusted instruction content, asserts no record state", signals };
  }

  // 4. Purely hypothetical language. A conditional is non-material unless it
  //    also reports a COMPLETED action in the indicative.
  if (u.modality === "CONDITIONAL" && !OFFICER_ACTION_OCCURRENCE.test(t)) {
    return { label: "NON_MATERIAL", reason: "hypothetical only, no asserted record state", signals };
  }

  // 5. Capability framing. Positive capability asserts no record state;
  //    negated capability naming a concrete action asserts that the action is
  //    not occurring, which IS checkable.
  if (CAPABILITY.test(t) && !state && !quantity) {
    if (CAPABILITY_NEGATED.test(t) && (action || domain)) {
      return { label: "MATERIAL_ASSERTION", reason: "negated capability about a concrete action", signals };
    }
    return { label: "NON_MATERIAL", reason: "capability statement with no asserted record state", signals };
  }

  // 6. Nothing record-related at all — conversational.
  if (!domain && !entity && !action && !state && !quantity) {
    return { label: "NON_MATERIAL", reason: "no record-related content", signals };
  }

  // 7. A record subject plus a predication (verb, state, negation or quantity).
  //    Arabic nominal sentences have no verb, so state/negation/quantity alone
  //    is sufficient predication.
  if ((domain || entity) && (action || state || negation || quantity)) {
    return { label: "MATERIAL_ASSERTION", reason: "record subject with an asserted predicate", signals };
  }

  // 8. An action is asserted even if the object is only a pronoun.
  if (action) return { label: "MATERIAL_ASSERTION", reason: "asserted action occurrence", signals };

  // 9. Domain vocabulary with no detectable predication — fail safe.
  if (domain || entity || state || quantity) {
    return { label: "UNCERTAIN", reason: "record vocabulary without a detectable predication", signals };
  }

  return { label: "UNCERTAIN", reason: "insufficient signal", signals };
}

/** Unit-level results rolled up: any material unit makes the passage material. */
export function rollUp(results: MaterialityResult[]): Materiality {
  if (results.some((r) => r.label === "MATERIAL_ASSERTION")) return "MATERIAL_ASSERTION";
  if (results.some((r) => r.label === "UNCERTAIN")) return "UNCERTAIN";
  return "NON_MATERIAL";
}

/**
 * NO_CLAIM_FORMED contract (offline evaluation only — NOT production).
 *   MATERIAL_ASSERTION + zero downstream claims → NO_CLAIM_FORMED (hard failure)
 *   UNCERTAIN          + zero downstream claims → NEEDS_SEMANTIC_REVIEW (not a pass)
 *   NON_MATERIAL                                → no claim required
 */
export type ClaimObligation = "OK" | "NO_CLAIM_FORMED" | "NEEDS_SEMANTIC_REVIEW" | "NOT_REQUIRED";

export function claimObligation(m: Materiality, claimCount: number): ClaimObligation {
  if (m === "NON_MATERIAL") return "NOT_REQUIRED";
  if (claimCount > 0) return "OK";
  return m === "MATERIAL_ASSERTION" ? "NO_CLAIM_FORMED" : "NEEDS_SEMANTIC_REVIEW";
}
