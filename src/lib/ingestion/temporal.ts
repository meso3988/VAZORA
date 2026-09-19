import "server-only";

/**
 * Deterministic temporal extraction. Arabic-first plus English. Recurrence is
 * derived ONLY from explicit wording — anything ambiguous stays null, and the
 * caller must surface UNKNOWN rather than invent a rule.
 */

export type TemporalRule = {
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annually" | null;
  /** Conceptual rule e.g. monthly_day_5, relative_days_7 — normalized codes */
  due: string | null;
  /** raw wording we matched (proof) */
  raw: string | null;
};

const AR_DAY = /اليوم\s+(\d+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/;
const AR_DAY_WORDS: Record<string, number> = {
  "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
  "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10,
};
const AR_MONTHLY = /كل شهر|شهريً?ا|شهرية/;
const AR_QUARTERLY = /ربع سنوي|كل ربع سنة|ربعية/;
const AR_ANNUAL = /سنويًا|كل سنة/;
const AR_REL_DAYS = /خلال\s+(\d+)\s*(يوم|أيام)/;

const EN_DAY = /(?:by|on)\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)?\s+(?:day\s+of\s+each month|of each month|day following(?: the)? (?:month|period|reporting month)?(?:\s+end)?|day after (?:period end|month(?:ly)? end))/i;
const EN_MONTHLY = /monthly|each month|every month/i;
const EN_WEEKLY = /weekly|each week|every week/i;
const EN_QUARTERLY = /quarterly|each quarter/i;
const EN_ANNUAL = /annual|annually|each year|every year/i;
const EN_REL_DAYS = /within\s+(\d+)\s+days/i;

export function extractTemporal(text: string): TemporalRule {
  if (!text?.trim()) return { frequency: null, due: null, raw: null };

  // Arabic — first
  if (AR_MONTHLY.test(text)) {
    const m = text.match(AR_DAY);
    if (m) {
      const day = /^\d+$/.test(m[1]) ? Number(m[1]) : AR_DAY_WORDS[m[1]];
      if (day) return { frequency: "monthly", due: `monthly_day_${day}`, raw: m[0] };
    }
    return { frequency: "monthly", due: null, raw: text.match(AR_MONTHLY)![0] };
  }
  if (AR_QUARTERLY.test(text)) return { frequency: "quarterly", due: null, raw: text.match(AR_QUARTERLY)![0] };
  if (AR_ANNUAL.test(text)) return { frequency: "annually", due: null, raw: text.match(AR_ANNUAL)![0] };

  const relAr = text.match(AR_REL_DAYS);
  if (relAr) return { frequency: null, due: `relative_days_${relAr[1]}`, raw: relAr[0] };

  // English
  const day = text.match(EN_DAY);
  if (day && day[1]) return { frequency: "monthly", due: `monthly_day_${day[1]}`, raw: day[0] };
  if (EN_MONTHLY.test(text)) return { frequency: "monthly", due: null, raw: text.match(EN_MONTHLY)![0] };
  if (EN_WEEKLY.test(text)) return { frequency: "weekly", due: null, raw: text.match(EN_WEEKLY)![0] };
  if (EN_QUARTERLY.test(text)) return { frequency: "quarterly", due: null, raw: text.match(EN_QUARTERLY)![0] };
  if (EN_ANNUAL.test(text)) return { frequency: "annually", due: null, raw: text.match(EN_ANNUAL)![0] };

  const rel = text.match(EN_REL_DAYS);
  if (rel) return { frequency: null, due: `relative_days_${rel[1]}`, raw: rel[0] };

  return { frequency: null, due: null, raw: null };
}
