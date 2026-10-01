/**
 * EVALUATOR V4 — PREDICATE FRAMES (materiality level only)
 *
 * The previous detector depended on flat action/domain word lists, so any
 * unseen verb ("put forward", "acted on", "drafted", "approves") silently
 * produced no signal. Frames fix that at the level of predicate structure:
 *
 *   predicate = lemma (+ optional particle)  →  frame
 *
 * English lemmas are produced by light inflectional stripping, so approves /
 * approved / approving all reach `approve`. Arabic predicates are matched on
 * light stems after proclitic stripping, so "وأسندناه" reaches "اسند".
 *
 * These frames say only "this unit predicates something a record would know
 * about". They do NOT judge truth, do not type a claim, and do not touch a
 * record, citation or execution state.
 */

import { isArabic, lightStemArabic, normalizeArabic, skeletonArabic, tokenizeArabic } from "./arabic";

export type FrameId =
  | "A-responsibility"
  | "B-state-change"
  | "C-communication"
  | "D-authorization"
  | "E-temporal"
  | "F-quantity"
  | "G-evidence"
  | "H-execution";

type Frame = {
  id: FrameId;
  /** English predicate lemmas (verbs and heads) */
  en: string[];
  /** English verb+particle pairs, e.g. put/forward, sit/with */
  enParticle?: [string, string][];
  /** Arabic predicate stems (after light stemming) */
  ar: string[];
};

const FRAMES: Frame[] = [
  {
    id: "A-responsibility",
    en: ["own", "owner", "ownership", "assign", "assignee", "assignment", "responsible", "responsibility",
         "nominate", "nominee", "designate", "designee", "delegate", "handle", "handler", "custodian", "accountable"],
    enParticle: [["put", "forward"], ["sit", "with"], ["look", "after"], ["belong", "to"], ["rest", "with"],
                 ["hand", "over"], ["take", "ownership"], ["pass", "to"], ["allocate", "to"]],
    ar: ["مالك", "ملكيه", "مسءول", "مسئول", "مسؤول", "اسند", "سند", "مسند", "تعيين", "عين", "كلف", "مكلف", "جهه", "عاتق"],
  },
  {
    id: "B-state-change",
    en: ["change", "update", "modify", "move", "shift", "revise", "amend", "adjust", "reschedule", "extend",
         "close", "reopen", "open", "resolve", "settle", "reverse", "withdraw", "cancel"],
    enParticle: [["push", "back"], ["wrap", "up"], ["roll", "back"], ["bring", "forward"]],
    ar: ["غير", "عدل", "حدث", "نقل", "مدد", "اغلق", "فتح", "حل", "سوي", "الغي", "ارجع", "اجل", "تحويل", "اقفال", "معالجه"],
  },
  {
    id: "C-communication",
    en: ["send", "submit", "file", "issue", "dispatch", "deliver", "forward", "notify", "share", "upload",
         "transmit", "circulate", "lodge", "submission", "notice"],
    enParticle: [["go", "out"], ["send", "out"], ["hand", "in"], ["put", "in"]],
    ar: ["ارسل", "رسال", "سلم", "رفع", "قدم", "بلغ", "شارك", "وزع", "اصدر", "اشعار", "تسليم", "ايداع"],
  },
  {
    id: "D-authorization",
    en: ["approve", "approval", "authorise", "authorize", "authorisation", "authorization", "sign", "signoff",
         "accept", "endorse", "ratify", "permit", "sanction", "grant", "mandate", "clearance", "consent",
         // the pre-approval pathway: a proposal exists to be approved
         "propose", "proposal", "draft", "recommend", "recommendation", "suggest", "suggestion"],
    enParticle: [["sign", "off"], ["give", "approval"], ["put", "through"]],
    ar: ["اعتمد", "اعتماد", "وافق", "موافقه", "اجاز", "صادق", "اذن", "تفويض", "توقيع", "وقع", "اقر", "تصديق",
         "مقترح", "اقترح", "اقتراح", "مسوده", "توصيه"],
  },
  {
    id: "E-temporal",
    en: ["due", "overdue", "deadline", "date", "expire", "lapse", "slip", "land", "window", "period",
         "timeline", "schedule", "late", "today", "tomorrow", "yesterday", "day", "week", "month", "year", "quarter"],
    enParticle: [["fall", "due"], ["fall", "overdue"], ["run", "out"]],
    ar: ["مستحق", "متاخر", "موعد", "مهله", "تاريخ", "انتهي", "يحل", "اجل", "مدة", "مده", "غدا", "امس", "اليوم",
         "يوم", "ايام", "اسبوع", "شهر", "سنه", "ربع", "استحقاق"],
  },
  {
    id: "F-quantity",
    en: ["amount", "figure", "value", "exposure", "deduction", "penalty", "fee", "damages", "percent",
         "percentage", "sum", "total", "cost", "price", "invoice", "payment"],
    ar: ["مبلغ", "قيمه", "تعرض", "خصم", "غرامه", "نسبه", "ريال", "فاتوره", "دفعه", "تعويض", "مجموع", "كلفه"],
  },
  {
    id: "G-evidence",
    en: ["evidence", "document", "register", "report", "acknowledgement", "acknowledgment", "acknowledge",
         "verify", "verification", "check", "discrepancy", "conflict", "gap", "certificate", "signature",
         "record", "proof", "attachment", "filing", "return",
         // a verification RUN and its result are evidence-domain objects too
         "run", "result", "outcome", "review", "audit", "status", "state", "finding"],
    ar: ["دليل", "ادله", "مستند", "سجل", "تقرير", "اقرار", "تحقق", "تباين", "فجوه", "شهاده", "اثبات", "مرفق", "محضر",
         "تشغيل", "نتيجه", "مراجعه", "تدقيق", "حاله", "ملاحظه"],
  },
  {
    id: "H-execution",
    en: ["execute", "execution", "complete", "completion", "finish", "perform", "action", "act", "do", "done",
         "carry", "implement", "apply", "mark", "effect"],
    enParticle: [["carry", "out"], ["act", "on"], ["take", "care"], ["follow", "through"], ["put", "in place"]],
    ar: ["نفذ", "تنفيذ", "انجز", "اتم", "اكمل", "قام", "باشر", "طبق", "اجراء"],
  },
];

/** Light English lemmatizer — inflectional only, no derivation. */
export function lemmatizeEn(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z-]/g, "");
  if (!w) return [];
  const out = new Set<string>([w]);
  const rules: [RegExp, string][] = [
    [/ies$/, "y"], [/ied$/, "y"], [/ying$/, "ie"],
    [/sses$/, "ss"], [/ches$/, "ch"], [/shes$/, "sh"], [/xes$/, "x"],
    [/([^s])s$/, "$1"], [/ed$/, ""], [/ing$/, ""], [/d$/, ""], [/e$/, ""],
    // light derivation: endorsement → endorse, authorisation → authorise
    [/ment$/, ""], [/ation$/, ""], [/ition$/, ""], [/sion$/, ""], [/tion$/, ""],
    [/ance$/, ""], [/ence$/, ""], [/ure$/, ""], [/al$/, ""], [/ness$/, ""],
  ];
  for (const [re, rep] of rules) if (re.test(w)) out.add(w.replace(re, rep));
  // restore a dropped silent e: "mov" → "move", "settl" → "settle"
  for (const f of [...out]) if (f.length >= 3 && !/e$/.test(f)) out.add(f + "e");
  return [...out];
}

export type FrameHit = {
  frame: FrameId; predicate: string; via: "en-lemma" | "en-particle" | "ar-stem";
  /** the surface token was an inflected verb form (approves/approved/acted) */
  inflected?: boolean;
};

/** Surface token looks like an inflected form of `lemma` (finite predication). */
function isInflectedForm(surface: string, lemma: string): boolean {
  if (surface === lemma) return false;
  return new RegExp(`^${lemma.replace(/e$/, "")}(?:e?[sd]|e?es|ed|ing|ies|ied)$`).test(surface);
}

export function detectFrames(text: string): FrameHit[] {
  const hits: FrameHit[] = [];
  const lower = text.toLowerCase();
  const raw = lower.split(/[^a-z-]+/).filter(Boolean);
  // keep hyphenated compounds AND their parts: "sign-off" → sign-off, sign, off
  const enTokens = [...raw, ...raw.flatMap((t) => (t.includes("-") ? t.split("-").filter(Boolean) : []))];
  const enLemmas = new Set(enTokens.flatMap(lemmatizeEn));
  // also treat a hyphenated compound as its joined form: sign-off → signoff
  for (const t of raw) if (t.includes("-")) enLemmas.add(t.replace(/-/g, ""));
  const arStems = new Set(isArabic(text) ? tokenizeArabic(text).flatMap(lightStemArabic) : []);
  const arSkeletons = new Set([...arStems].map(skeletonArabic).filter((s) => s.length >= 3));
  const arNorm = normalizeArabic(text);

  for (const f of FRAMES) {
    for (const lemma of f.en) {
      if (!enLemmas.has(lemma)) continue;
      const inflected = enTokens.some((tok) => isInflectedForm(tok, lemma));
      hits.push({ frame: f.id, predicate: lemma, via: "en-lemma", inflected });
      break;
    }
    for (const [verb, particle] of f.enParticle ?? []) {
      // verb … particle within a short window — frame, not a fixed phrase
      const vl = [verb, ...lemmatizeEn(verb)];
      const idx = enTokens.findIndex((t) => lemmatizeEn(t).some((l) => vl.includes(l)));
      if (idx >= 0) {
        const window = enTokens.slice(idx + 1, idx + 4).join(" ");
        if (window.includes(particle)) {
          hits.push({ frame: f.id, predicate: `${verb} ${particle}`, via: "en-particle", inflected: isInflectedForm(enTokens[idx], verb) });
          break;
        }
      }
    }
    for (const stem of f.ar) {
      const s = normalizeArabic(stem);
      const sk = skeletonArabic(s);
      if (arStems.has(s) || (s.length >= 4 && arNorm.includes(s)) || (sk.length >= 3 && arSkeletons.has(sk))) {
        hits.push({ frame: f.id, predicate: stem, via: "ar-stem" });
        break;
      }
    }
  }
  return hits;
}

/**
 * RECORD OBJECTS — the entities VAZORA keeps records about. Frames model
 * PREDICATES; this models SUBJECTS. Both are needed: "the undertaking was never
 * amended" needs the object (undertaking) as much as the predicate (amend).
 * Kept separate from the A–H frame taxonomy on purpose.
 */
const RECORD_OBJECT_EN = ["obligation", "contract", "clause", "section", "schedule", "requirement", "deliverable",
  "milestone", "undertaking", "agreement", "amendment", "variation", "order", "entitlement", "term", "condition"];
const RECORD_OBJECT_AR = ["التزام", "عقد", "بند", "ماده", "ملحق", "متطلب", "تسليم", "مرحله", "اتفاقيه", "تعديل",
  "امر", "شرط", "حكم", "استحقاق"];

export function detectRecordObjects(text: string): string[] {
  const found: string[] = [];
  const raw = text.toLowerCase().split(/[^a-z-]+/).filter(Boolean);
  const lemmas = new Set(raw.flatMap(lemmatizeEn));
  for (const o of RECORD_OBJECT_EN) if (lemmas.has(o)) found.push(o);
  if (isArabic(text)) {
    const stems = new Set(tokenizeArabic(text).flatMap(lightStemArabic));
    const arNorm = normalizeArabic(text);
    for (const o of RECORD_OBJECT_AR) {
      const n = normalizeArabic(o);
      if (stems.has(n) || (n.length >= 4 && arNorm.includes(n))) found.push(o);
    }
  }
  return found;
}

export function frameIds(hits: FrameHit[]): Set<FrameId> {
  return new Set(hits.map((h) => h.frame));
}
