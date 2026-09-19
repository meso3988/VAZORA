import "server-only";

/**
 * Deterministic temporal engine.
 *
 * The LLM finds the SOURCE SPAN; this module derives frequency and due rule
 * from the exact clause text. Both matter: frequency answers "how often", due
 * answers "which day / within how long". Both stay UNKNOWN until proven.
 */

export type TemporalRule = {
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "annually" | null;
  due: string | null;
  relativeDays: number | null;
  calendar: "hijri" | "gregorian" | null;
  kind: "calendar_day" | "relative" | "frequency_only" | null;
  raw: string | null;
};

const AR_DAY_WORDS: Record<string, number> = {
  "الأول": 1, "الثاني": 2, "الثالث": 3, "الرابع": 4, "الخامس": 5,
  "السادس": 6, "السابع": 7, "الثامن": 8, "التاسع": 9, "العاشر": 10,
  "الحادي عشر": 11, "الحادي والعشرين": 21, "الخامس والعشرين": 25,
};

function arDay(text: string): number | null {
  const d = text.match(/اليوم\s+(\d{1,2}(?:\s*(?:من|بعد|إلى)?\s*)?)/); // Arabic digit
  if (d?.[1] && /^\d+/.test(d[1])) return Number(d[1]);
  const w = text.match(/اليوم\s+(الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|الحادي عشر(?: [ا-يء-ي]+)?|الحادي والعشرين|الخامس والعشرين)/);
  if (w?.[1]) return AR_DAY_WORDS[w[1]] ?? null;
  return null;
}

const MONT_H = /كل شهر|كل شهرا?|شهريً?ا|شهريًا/;
const WEEK_H = /أسبوعيًا|كل أسبوع/;
const QUART = /ربع سنوي|كل ربع سنة|ربعية|كل ثلاثة أشهر/;
const ANNU = /سنويًا|كل سنة/;
const REL_AR = /(?:خلال|بعد)\s+(?:الاستلام|التسليم|الإستلام|ب\頂)?\s*(\d+|(?:\u0660-\u0669)|[ا-يء-ي]+(?: [ا-يء-ي]+)?)\s*(يوم|أيام)/;
const BEFORE_MONTH_END = /قبل نهاية(?:\s+كل)?\s+الشهر|نهاية (?:الشهر|كل شهر)/;

const EN_DAY_OF_MONTH = /(?:on|by)\s+(?:the\s+)?(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:st|nd|rd|th)?\s+(?:day\s+of\s+each month|of (?:each|every) month|day of the month|day of every month|day following (?:the )?(?:month|period) end)/i;
const EN_BY_DAY = /(?:no later than|by)\s+(?:the\s+)?(\d{1,2}|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:st|nd|rd|th)?\s+of\s+(?:each|every|the)\s+month/i;
const EN_REL = /(?:within|no later than)\s+(\d{1,2})\s+days(?:\s+(?:of|after)\s+(?:receipt|acceptance|delivery|month(?:ly)? end|period end))?/i;
const EN_DAY_WORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
const EN_MONTHLY = /\bmonthly\b|\bevery month\b|\beach month\b/i;

function enDayMatch(text: string): number | null {
  const m = text.match(EN_DAY_OF_MONTH) ?? text.match(EN_BY_DAY);
  if (!m?.[1]) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : EN_DAY_WORDS[m[1].toLowerCase()] ?? null;
}
const EN_WEEKLY = /\bweekly\b|\bevery week\b|\beach week\b/i;
const EN_QUARTERLY = /\bquarterly\b|\bevery quarter\b/i;
const EN_ANNUAL = /\bannual(?:ly)?\b|\bevery year\b/i;
const EN_BEFORE_MONTH_END = /\bbefore month[- ]end\b|\bby end[- ]of[- ]month\b/i;

export function extractTemporal(text: string): TemporalRule {
  if (!text?.trim()) return { frequency: null, due: null, relativeDays: null, calendar: null, kind: null, raw: null };
  const t = text;

  // ---- Arabic relative-day forms first ----
  const relAr = t.match(REL_AR);
  if (relAr) {
    const n = /^\d+$/.test(relAr[1]) ? Number(relAr[1]) : (() => {
      const map: Record<string, number> = { "خمسة": 5, "سبعة": 7, "ثمانية": 8, "عشرة": 10, "خمسة عشر": 15 };
      const key = Object.keys(map).find((k) => t.includes(k));
      return key ? map[key] : null;
    })();
    if (n) return { frequency: null, due: `relative_days_${n}`, relativeDays: n, calendar: null, kind: "relative", raw: relAr[0] };
    return { frequency: null, due: null, relativeDays: null, calendar: null, kind: "relative", raw: relAr[0] };
  }

  // ---- Arabic calendar day-of-month ----
  if (MONT_H.test(t) || /(من|في)\s*(الشهر|كل شهر|شهر)/.test(t)) {
    if (BEFORE_MONTH_END.test(t)) return { frequency: "monthly", due: "monthly_end", relativeDays: null, calendar: "gregorian", kind: "calendar_day", raw: t.match(BEFORE_MONTH_END)![0] };
    const d = arDay(t) ?? (() => {
      const m = t.match(/(\d{1,2})\s*(?:من|بعد)\s*(?:نهاية\s*)?(?:الشهر|كل شهر)/);
      return m ? Number(m[1]) : null;
    })();
    if (d) return { frequency: "monthly", due: `monthly_day_${d}`, relativeDays: null, calendar: "gregorian", kind: "calendar_day", raw: t.match(/(من|في)\s*(الشهر|كل شهر|شهر)|شهريً?ا|شهريًا/)?.[0] ?? t.match(MONT_H)![0] };
    return { frequency: "monthly", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(MONT_H)![0] };
  }
  if (BEFORE_MONTH_END.test(t)) {
    return { frequency: "monthly", due: "monthly_end", relativeDays: null, calendar: "gregorian", kind: "calendar_day", raw: t.match(BEFORE_MONTH_END)![0] };
  }
  if (WEEK_H.test(t)) return { frequency: "weekly", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(WEEK_H)![0] };
  if (QUART.test(t)) return { frequency: "quarterly", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(QUART)![0] };
  if (ANNU.test(t)) return { frequency: "annually", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(ANNU)![0] };

  // ---- English relative forms ----
  const relEn = t.match(EN_REL);
  if (relEn) {
    const n = Number(relEn[1]);
    return { frequency: null, due: `relative_days_${n}`, relativeDays: n, calendar: null, kind: "relative", raw: relEn[0] };
  }
  // "no later than N days after X" without the word "within"
  const relEn2 = t.match(/no later than\s+(\d{1,2})\s+days/i);
  if (relEn2) {
    const n = Number(relEn2[1]);
    return { frequency: null, due: `relative_days_${n}`, relativeDays: n, calendar: null, kind: "relative", raw: relEn2[0] };
  }
  const enDom = enDayMatch(t);
  if (enDom) {
    return { frequency: "monthly", due: `monthly_day_${enDom}`, relativeDays: null, calendar: "gregorian", kind: "calendar_day", raw: (t.match(EN_DAY_OF_MONTH) ?? t.match(EN_BY_DAY))![0] };
  }
  // English month-end variants
  if (EN_BEFORE_MONTH_END.test(t)) return { frequency: "monthly", due: "monthly_end", relativeDays: null, calendar: "gregorian", kind: "calendar_day", raw: t.match(EN_BEFORE_MONTH_END)![0] };
  // Mixed Arabic-English pattern: English cadence word + Arabic day number.
  if (EN_MONTHLY.test(t)) {
    const d = arDay(t);
    if (d) return { frequency: "monthly", due: `monthly_day_${d}`, relativeDays: null, calendar: "gregorian", kind: "calendar_day", raw: t.match(/اليوم\s+\S+/)?.[0] ?? t.match(EN_MONTHLY)![0] };
    return { frequency: "monthly", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(EN_MONTHLY)![0] };
  }
  if (EN_QUARTERLY.test(t)) return { frequency: "quarterly", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(EN_QUARTERLY)![0] };
  if (EN_WEEKLY.test(t)) return { frequency: "weekly", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(EN_WEEKLY)![0] };
  if (EN_ANNUAL.test(t)) return { frequency: "annually", due: null, relativeDays: null, calendar: null, kind: "frequency_only", raw: t.match(EN_ANNUAL)![0] };

  return { frequency: null, due: null, relativeDays: null, calendar: null, kind: null, raw: null };
}
