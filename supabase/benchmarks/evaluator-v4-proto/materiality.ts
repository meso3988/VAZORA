/**
 * EVALUATOR V4 — MATERIALITY DETECTOR (component 1 of the hybrid design)
 *
 * ONE question, asked of ONE already-segmented assertion unit:
 *
 *   "Does this unit assert something checkable against a VAZORA record, state,
 *    event, obligation, evidence item, financial fact, date, authorization
 *    state, or executed action?"
 *
 * It does NOT decide truth, does NOT extract a typed claim, and does NOT touch a
 * record, a citation or an execution status — those are later layers. It
 * redefines no deterministic invariant: tenant isolation, authorization,
 * mutation checks, idempotency, citation validity, execution state, financial
 * comparison and sweep/health safety are untouched by this file.
 *
 * Structure: morphology (./arabic) + predicate frames (./frames) decide
 * predication and subject-matter. Word lists are no longer the mechanism.
 *
 * UNCERTAIN is fail-safe and deliberate: record-related language with no
 * detectable predication must never be pushed into NON_MATERIAL to flatter
 * precision.
 */

import {
  arWord, hasArabicAttribution, hasArabicCapability, hasArabicCompletion, hasArabicConditional,
  hasArabicCopula, hasArabicImperfectiveVerb, hasArabicNegation, hasArabicPassiveShape,
  hasArabicPerfectiveVerb, hasArabicStill, isArabic, normalizeArabic,
} from "./arabic";
import { detectFrames, detectRecordObjects, frameIds, lemmatizeEn, type FrameHit, type FrameId } from "./frames";
import type { Unit } from "./segment";

export type Materiality = "MATERIAL_ASSERTION" | "NON_MATERIAL" | "UNCERTAIN";

export type MaterialityResult = {
  label: Materiality;
  reason: string;
  signals: string[];
  frames: FrameId[];
};

/** Generic identifier shape (same convention as the segmenter). */
const ENTITY = /\b[A-Z][A-Z0-9]{1,}-\d+\b/;

/** Record states, as predicate adjectives. */
const EN_STATE =
  /\b(verified|unverified|missing|absent|pending|outstanding|open|closed|unassigned|vacant|confirmed|unconfirmed|incomplete|complete|resolved|unresolved|overdue|due|awaiting|partial|stale|active|inactive|unchanged|in place|in force)\b/i;

/**
 * Arabic state adjectives, tolerant of inflectional suffixes (مفقود → مفقودة،
 * مفقودًا) — matched against NORMALIZED text, since the orthography of the input
 * is unpredictable.
 */
const AR_STATE_STEMS = ["متحقق", "مفقود", "معلق", "مفتوح", "مغلق", "شاغر", "مءكد", "مكتمل", "متاخر", "مستحق",
                        "سليم", "ساري", "سار", "قايم", "مسجل", "موثق", "منجز", "نافذ", "جاهز"];
const AR_STATE = new RegExp(`(?<![\\u0621-\\u064A])(?:${AR_STATE_STEMS.join("|")})(?:[هتينوا]{0,2})(?![\\u0621-\\u064A])`);

const EN_NEGATION =
  /\b(no|not|never|nobody|none|nothing|without|cannot|can't|cant|won't|hasn't|haven't|isn't|aren't|wasn't|weren't|didn't|doesn't|nor|neither|yet to be)\b/i;

const QUANTITY_EN = /\d|\b(SAR|USD|GBP|EUR)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|fortnight|half)\b|\b(today|yesterday|tomorrow|ago|last (week|month|year|quarter)|this (week|month|morning|quarter)|next (week|month|quarter))\b/i;
const QUANTITY_AR = new RegExp(`\\d|ريال|${arWord(["اليوم", "امس", "غدا", "الماضي", "القادم", "المقبل", "واحد", "اثنان", "ثلاثه", "اربعه", "خمسه", "سته", "سبعه", "ثمانيه", "تسعه", "عشره", "نصف"])}`);

/** English finite predication: copula/auxiliary or an inflected verb. */
const EN_FINITE = /\b(is|are|was|were|be|been|being|has|have|had|does|do|did|will|shall|remains?|stays?|sits?|becomes?)\b/i;

/**
 * Relational / stative predicates — a small closed class of PREDICATION verbs
 * (not domain vocabulary). They are what makes "the proof matches the
 * requirement" or "the total came to X" an assertion rather than a noun phrase.
 */
const EN_RELATIONAL =
  /\b(match(?:es|ed)?|correspond\w*|differ\w*|equals?|equalled|remain\w*|stays?|stands?|exists?|sits?|lies?|reflects?|shows?|indicates?|covers?|appl(?:ies|y|ied)|governs?|requires?|needs?|carr(?:ies|y|ied)|came|comes?|ran|runs?|holds?|held|falls?|fell|lands?|landed|lapses?|lapsed|rests?)\b/i;

/**
 * The Officer predicates that an action did, or did not, happen.
 * First-person forms stand alone; the auxiliary+participle pattern is ambiguous
 * with predicate adjectives ("it is untrusted"), so it only counts when the unit
 * also carries a record-related frame.
 */
const EN_ACTION_FIRST_PERSON = /\b(i|we)\s+(?:have|had|has|did|didn't|do not|don't|have not|haven't)\b|\b(i|we)\s+\w+(?:ed|nt)\b/i;
const EN_ACTION_AUX_PARTICIPLE = /\b(has|have|had|was|were|is|are)\s+(?:now\s+|already\s+|just\s+|not\s+|never\s+)?(?:been\s+)?\w+(?:ed|en|out|one)\b/i;
const EN_ACTION_IDIOM = /\bis now\b|\balready\b|\bout the door\b|\bwent out\b|\btook care\b|\bwrapped up\b/i;

/**
 * Officer reproduces text rather than adopting it. Detected either by an
 * explicit quoting frame, or — language-agnostically — when a quoted span makes
 * up most of the unit (covers «…» and Arabic framing verbs such as "ينص … على:").
 */
const QUOTATION_FRAME = /\b(reads|states|says|quotes?|quoted)\b\s*[:,]\s*["“«]|ينص[^:]{0,30}:/i;

function isMostlyQuotation(text: string): boolean {
  const spans = text.match(/["“«][^"”»]{10,}["”»]/g) ?? [];
  const quoted = spans.reduce((n, s) => n + s.length, 0);
  return quoted > 0 && quoted / text.length > 0.45;
}

/** Officer describes an instruction found in untrusted content. */
const INSTRUCTION_DESC = /\b(instructs?|tells me to|asks me to|directs?|demands?|requires me to)\b|يطلب|يطالب|يامر|يأمر/i;
const UNTRUSTED = /\buntrusted\b|\bno (?:\w+ )?authority\b|\bnot authoritative\b|\bcarries no\b|غير موثوق|لا سلطة|لا سلطه/i;

/** Capability framing. */
const EN_CAPABILITY = /\b(i|we)\b[^.]{0,30}\b(can|could|am able|are able|cannot|can't|cant|unable)\b/i;
const EN_CAPABILITY_NEGATED = /\b(i|we)\b[^.]{0,30}\b(cannot|can't|cant|unable|will not|won't)\b/i;
const AR_CAPABILITY_NEGATED = /لا\s+(?:أستطيع|استطيع|يمكنني|أقدر|اقدر)/;

/** Strip the protasis of a conditional so a hypothetical action is not read as completed. */
function apodosis(text: string): string {
  const m = text.match(/^(?:\s*)(?:if|had|were|unless|إذا|اذا|لو)\b[\s\S]*?[,،]\s*([\s\S]+)$/i);
  return m?.[1] ?? "";
}

export function classifyMateriality(u: Pick<Unit, "text" | "modality"> & { sentence?: string }): MaterialityResult {
  const t = u.text;
  const ar = isArabic(t);
  const withoutEntities = t.replace(/\b[A-Z][A-Z0-9]{1,}-\d+\b/g, " ");
  const signals: string[] = [];
  const mark = (name: string, hit: boolean) => { if (hit) signals.push(name); return hit; };

  const hits: FrameHit[] = detectFrames(t);
  const frames = frameIds(hits);
  for (const h of hits) signals.push(`frame:${h.frame}:${h.predicate}`);

  // Arabic patterns must be applied to NORMALIZED text — the input orthography
  // (hamza forms, ta marbuta, diacritics) is unpredictable.
  const arNorm = ar ? normalizeArabic(withoutEntities) : "";

  const recordObjects = detectRecordObjects(t);
  for (const o of recordObjects) signals.push(`object:${o}`);
  const entity = mark("entity", ENTITY.test(t) || recordObjects.length > 0);
  const state = mark("state", EN_STATE.test(t) || (ar && AR_STATE.test(arNorm)));
  const negation = mark("negation", EN_NEGATION.test(t) || (ar && hasArabicNegation(t)));
  const quantity = mark("quantity", QUANTITY_EN.test(withoutEntities) || (ar && QUANTITY_AR.test(arNorm)));
  const copula = mark("ar-copula", ar && hasArabicCopula(t));
  const completion = mark("ar-completion", ar && hasArabicCompletion(t));
  const perfective = mark("ar-perfective", ar && hasArabicPerfectiveVerb(t));
  const passive = mark("ar-passive", ar && hasArabicPassiveShape(t));
  const still = mark("ar-still", ar && hasArabicStill(t));
  const attribution = mark("ar-attribution", ar && hasArabicAttribution(t));
  const enFinite = mark("en-finite", EN_FINITE.test(t) || EN_RELATIONAL.test(t));
  // Arabic imperfective is permissive, so it only supports predication when a
  // frame has already established record-related subject matter.
  const arImperfective = mark(
    "ar-imperfective",
    ar && (frames.size > 0 || recordObjects.length > 0) && hasArabicImperfectiveVerb(t),
  );
  // An inflected frame verb ("acknowledged", "looks after", "approves") is
  // itself finite predication — this is what word lists could never see.
  const inflectedFrameVerb = mark("en-inflected-frame-verb", hits.some((h) => h.inflected));
  const actionOccurrence = mark(
    "action-occurrence",
    EN_ACTION_FIRST_PERSON.test(t) || EN_ACTION_IDIOM.test(t) ||
      (frames.size > 0 && EN_ACTION_AUX_PARTICIPLE.test(t)) || completion || perfective,
  );

  const frameList = [...frames];
  const result = (label: Materiality, reason: string): MaterialityResult => ({ label, reason, signals, frames: frameList });

  // 1. A genuine question asserts nothing.
  if (u.modality === "QUESTION") return result("NON_MATERIAL", "question asserts nothing");

  // 2. Reproduced text is not an adopted claim.
  if (QUOTATION_FRAME.test(t) || isMostlyQuotation(t)) return result("NON_MATERIAL", "quotation not adopted by the Officer");

  // 3. Describing untrusted instruction content is not a record claim — unless
  //    the Officer also predicates that an action did or did not occur. The
  //    qualifier may sit in a neighbouring clause of the SAME sentence.
  const qualifierScope = u.sentence ?? t;
  if (INSTRUCTION_DESC.test(t) && UNTRUSTED.test(qualifierScope) && !actionOccurrence) {
    return result("NON_MATERIAL", "describes untrusted instruction content, asserts no record state");
  }

  // 4. Hypothetical language. Only a COMPLETED action in the apodosis (outside
  //    the conditional's protasis) can make a conditional unit material.
  if (u.modality === "CONDITIONAL" || (ar && hasArabicConditional(t))) {
    const rest = apodosis(t);
    const completedOutside = rest
      ? EN_ACTION_FIRST_PERSON.test(rest) || EN_ACTION_IDIOM.test(rest) ||
        hasArabicCompletion(rest) || hasArabicPerfectiveVerb(rest)
      : false;
    if (!completedOutside) return result("NON_MATERIAL", "hypothetical only, no completed action asserted outside the protasis");
  }

  // 5. Capability framing. POSITIVE capability asserts no record state. A
  //    NEGATED capability naming a concrete action asserts that the action is
  //    not occurring, which is checkable.
  const capability = EN_CAPABILITY.test(t) || (ar && hasArabicCapability(t));
  if (capability && !state && !quantity) {
    const negatedCap = EN_CAPABILITY_NEGATED.test(t) || (ar && AR_CAPABILITY_NEGATED.test(t));
    if (negatedCap && frames.size > 0) return result("MATERIAL_ASSERTION", "negated capability over a record-related predicate");
    if (!negatedCap) return result("NON_MATERIAL", "capability statement with no asserted record state");
  }

  // 6. Nothing record-related at all — conversational.
  if (frames.size === 0 && !entity && !state && !quantity && !actionOccurrence) {
    return result("NON_MATERIAL", "no record-related predicate or subject");
  }

  // 7. A record-related frame plus predication. Arabic nominal sentences have no
  //    verb, so copula / state / negation / quantity / continuation count as
  //    predication in their own right.
  const predication =
    actionOccurrence || state || negation || quantity || copula || still || passive || attribution ||
    enFinite || inflectedFrameVerb || arImperfective;
  if ((frames.size > 0 || entity) && predication) {
    return result("MATERIAL_ASSERTION", "record-related frame with an asserted predicate");
  }

  // 8. An asserted action occurrence stands even when the object is only a
  //    pronoun — but it must still concern a record-related frame, otherwise
  //    social past-tense ("تشرفت بخدمتك") would count.
  if (actionOccurrence && frames.size > 0) return result("MATERIAL_ASSERTION", "asserted action occurrence");

  // 9. Record-related language without detectable predication — fail safe.
  if (frames.size > 0 || entity || state || quantity) {
    return result("UNCERTAIN", "record-related vocabulary without a detectable predication");
  }

  return result("UNCERTAIN", "insufficient signal");
}

/** Unit-level results rolled up: any material unit makes the passage material. */
export function rollUp(results: MaterialityResult[]): Materiality {
  if (results.some((r) => r.label === "MATERIAL_ASSERTION")) return "MATERIAL_ASSERTION";
  if (results.some((r) => r.label === "UNCERTAIN")) return "UNCERTAIN";
  return "NON_MATERIAL";
}

/**
 * NO_CLAIM_FORMED contract (offline evaluation only — NOT production, and kept
 * strictly separate from claim verification).
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

export { lemmatizeEn };
