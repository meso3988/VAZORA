/**
 * EVALUATOR V4 — ARABIC MORPHOLOGY SUPPORT
 *
 * Reusable normalization and light morphology for Arabic assertion units. This
 * module exists because the previous detector failed Arabic for *structural*
 * reasons, not vocabulary ones:
 *
 *   • JavaScript's \b is defined over [A-Za-z0-9_], so `\bلا\b` can never match,
 *     while an unanchored `لا` matches inside words such as "الالتزام".
 *   • Proclitics attach: "ولن" is و + لن, "بالعقد" is ب + ال + عقد, "سيُغلق" is
 *     س + يغلق. A boundary check alone therefore still misses the particle.
 *   • Arabic nominal sentences have no verb at all ("المالك هو فهد"), so any
 *     predication test that requires a verb fails on correct Arabic.
 *
 * Nothing here is specific to any corpus sentence. No deterministic invariant
 * is touched: this is text analysis only.
 */

/** Arabic letter range used for real word boundaries. */
export const AR_LETTER = "\\u0621-\\u064A";

/** Arabic-safe word boundary around a set of alternatives. */
export function arWord(tokens: string[]): string {
  return `(?<![${AR_LETTER}])(?:${tokens.join("|")})(?![${AR_LETTER}])`;
}

const DIACRITICS = /[\u064B-\u0652\u0670\u0653-\u0655\u0640]/g;

/** Orthographic normalization: diacritics, hamza forms, alef maqsura, ta marbuta. */
export function normalizeArabic(s: string): string {
  return s
    .replace(DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

export function isArabic(s: string): boolean {
  return new RegExp(`[${AR_LETTER}]`).test(s);
}

export function tokenizeArabic(s: string): string[] {
  return normalizeArabic(s).split(/[^\u0621-\u064A0-9]+/).filter(Boolean);
}

/**
 * Candidate stems after stripping valid proclitic combinations.
 * Order matters: conjunction (و/ف) → future (س) → preposition (ب/ل/ك) →
 * definite article (ال / لل). Every intermediate form is returned, so a caller
 * can match a particle or a stem regardless of what attached to it.
 */
export function stripProclitics(token: string): string[] {
  const out = new Set<string>([token]);
  const peel = (t: string) => {
    const forms: string[] = [];
    if (/^[وف]./.test(t)) forms.push(t.slice(1));
    if (/^س./.test(t) && t.length > 3) forms.push(t.slice(1));
    if (/^[بلك]./.test(t) && t.length > 3) forms.push(t.slice(1));
    if (/^ال./.test(t) && t.length > 3) forms.push(t.slice(2));
    if (/^لل./.test(t) && t.length > 3) forms.push("ال" + t.slice(2), t.slice(2));
    // imperfect/derivational verbal prefixes: يُنفَّذ → نفذ, يوقع → وقع, تحدد → حدد
    if (/^[يتنا]./.test(t) && t.length > 3) forms.push(t.slice(1));
    return forms;
  };
  // two passes cover combinations such as و+ال, ب+ال, و+لن
  for (const a of peel(token)) {
    out.add(a);
    for (const b of peel(a)) out.add(b);
  }
  return [...out];
}

/** Light stem: drop proclitics, then common nominal/plural/pronoun suffixes. */
export function lightStemArabic(token: string): string[] {
  const out = new Set<string>(stripProclitics(normalizeArabic(token)));
  const suffixes = ["ات", "ون", "ين", "ان", "ها", "هم", "هن", "ه", "نا", "كم", "ك", "ي", "وا", "تم", "ت"];
  // iterate to a fixpoint: نفذناه → نفذنا → نفذ
  for (let pass = 0; pass < 3; pass++) {
    for (const b of [...out]) {
      for (const suf of suffixes) {
        if (b.length > suf.length + 2 && b.endsWith(suf)) out.add(b.slice(0, -suf.length));
      }
      for (const p of stripProclitics(b)) out.add(p);
    }
  }
  return [...out];
}

/**
 * Consonantal skeleton: drop the long vowels ا/و/ي. Arabic internal passive
 * changes the vowel pattern (صادق → صُودِق, وافق → وُوفق), which normalization
 * cannot undo, but the skeleton is preserved: صدق / وفق.
 */
export function skeletonArabic(stem: string): string {
  return normalizeArabic(stem).replace(/[اوي]/g, "");
}

/** Does any token of the unit (after proclitic stripping) match a particle set? */
export function hasParticle(text: string, particles: string[]): boolean {
  const set = new Set(particles.map(normalizeArabic));
  for (const tok of tokenizeArabic(text)) {
    for (const form of stripProclitics(tok)) if (set.has(form)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Particle inventories (closed classes — grammar, not vocabulary)
// ---------------------------------------------------------------------------
export const AR_NEGATION = ["لم", "لن", "ليس", "ليست", "لست", "غير", "بلا", "لا", "دون", "عدم", "مطلقا", "ابدا"];
export const AR_CONDITIONAL = ["اذا", "لو", "لولا", "مهما", "حين"];
export const AR_ATTRIBUTION = ["وفقا", "بحسب", "حسب", "وفق", "افاد", "ذكر", "ابلغ", "يفيد", "بناء"];
export const AR_COPULA = ["هو", "هي", "هم", "هن"];
export const AR_STILL = ["زال", "يزال", "ظل", "بقي", "مازال", "لايزال"];
export const AR_COMPLETION_AUX = ["تم", "تمت", "يتم", "جرى", "جري"];
export const AR_CAPABILITY = ["استطيع", "يمكنني", "اقدر", "بامكاني", "نستطيع"];
export const AR_INTERROGATIVE = ["هل", "اي", "اين", "متي", "كيف", "لماذا", "ايهما"];

export const hasArabicNegation = (t: string) => hasParticle(t, AR_NEGATION);
export const hasArabicConditional = (t: string) => hasParticle(t, AR_CONDITIONAL);
export const hasArabicAttribution = (t: string) => hasParticle(t, AR_ATTRIBUTION);
export const hasArabicCapability = (t: string) => hasParticle(t, AR_CAPABILITY);
export const hasArabicInterrogative = (t: string) => hasParticle(t, AR_INTERROGATIVE);

/** "ما زال / لا يزال / ظل" — continuation of a state, and NOT interrogative ما. */
export function hasArabicStill(text: string): boolean {
  const n = normalizeArabic(text);
  return /(?:ما|لا)\s*(?:زال|يزال|زالت)/.test(n) || hasParticle(text, AR_STILL);
}

/**
 * Nominal (verbless) predication — the normal way Arabic states identity or a
 * state: "المالك هو فهد", "الالتزام متأخر", "القيمة مليون ريال".
 * Signalled by an explicit copula pronoun, or by a nominal subject followed by
 * a predicate with no verb present at all.
 */
export function hasArabicCopula(text: string): boolean {
  return hasParticle(text, AR_COPULA);
}

/** "تم + مصدر" and similar completion auxiliaries: an action was carried out. */
export function hasArabicCompletion(text: string): boolean {
  const toks = tokenizeArabic(text);
  const aux = new Set(AR_COMPLETION_AUX.map(normalizeArabic));
  for (let i = 0; i < toks.length; i++) {
    for (const form of stripProclitics(toks[i])) {
      // the auxiliary must govern a following noun/verb to mean "was done"
      if (aux.has(form) && toks[i + 1]) return true;
    }
  }
  return false;
}

/**
 * Internal passive (فُعل / يُفعل) survives only in diacritics, which are usually
 * absent, so detection relies on the shape plus context: a 3–6 letter token that
 * is not a known particle and carries a passive-prone prefix.
 */
export function hasArabicPassiveShape(raw: string): boolean {
  // damma on the first radical followed by the rest of the stem: رُفع، وُقّع، نُفِّذ
  if (/[\u0621-\u064A]\u064F[\u0621-\u064A]{2,}/.test(raw)) return true;
  // imperfect passive prefixes carrying damma: يُرفع، تُعتمد، أُنجز
  return /(?:يُ|تُ|أُ|نُ)[\u0621-\u064A]{2,}/.test(raw);
}

/**
 * Imperfective (present) verb shape: the مضارع prefixes ي/ت/ن/أ on a stem.
 * Shape-based and therefore permissive — Arabic verbal nouns (تقرير، تنفيذ) share
 * the prefix letter — so callers must only use it as supporting predication
 * evidence alongside a frame, never as subject matter on its own.
 */
export function hasArabicImperfectiveVerb(text: string): boolean {
  for (const tok of tokenizeArabic(text)) {
    for (const base of stripProclitics(tok)) {
      if (base.length >= 4 && /^[يتنا]/.test(base) && !AR_NEGATION.includes(base) && !AR_COMPLETION_AUX.includes(base)) return true;
    }
  }
  return false;
}

/**
 * Perfective (past) verb shape with optional attached pronouns:
 * "أسندناه", "سلّمناه", "أنجزتها", "أغلقت", "سجّلت".
 * Detected by perfective subject suffixes, not by a verb list.
 */
export function hasArabicPerfectiveVerb(text: string): boolean {
  for (const tok of tokenizeArabic(text)) {
    for (const base of stripProclitics(tok)) {
      // strip object pronoun, then test for a perfective subject suffix
      const noObj = base.replace(/(?:ها|هم|هن|ه|نا|كم|ك)$/, "");
      if (noObj.length < 4) continue;
      if (AR_NEGATION.includes(noObj) || AR_COMPLETION_AUX.includes(noObj)) continue;
      // unambiguous perfective subject suffixes
      if (/(?:نا|تم|تا|وا)$/.test(noObj)) return true;
      // bare ت is perfective only when it is not the feminine plural ات / وت / يت
      if (/ت$/.test(noObj) && !/[اوي]ت$/.test(noObj)) return true;
    }
  }
  return false;
}
