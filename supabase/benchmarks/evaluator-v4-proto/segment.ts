/**
 * EVALUATOR V4 — PROTOTYPE (architecture proof only)
 *
 * Segmentation + modality classification. This file deliberately contains NO
 * security logic, NO thresholds, and NO knowledge of the v3 benchmark: the
 * frozen r10 evaluator is untouched and keeps sole authority over every
 * deterministic invariant (tenant isolation, disclosures, mutations,
 * idempotency, citation-id validity, tool authorization, financial-record
 * comparison). This is semantic measurement only.
 *
 * The architectural claim under test: a *local assertion unit* carrying its own
 * entity scope, plus a modality label, removes the extraction/binding
 * false-positive family — without a stop-word list and without weakening
 * detection of genuinely false statements.
 *
 * No scenario id, contract number, fixture uuid or saved answer appears here.
 * Entity references are recognised by generic identifier SHAPE only.
 */

export type Modality =
  | "ASSERTION"
  | "QUESTION"
  | "CONDITIONAL"
  | "REPORTED_ATTRIBUTION"
  | "REFUSAL"
  | "PROPOSAL";

export type Unit = {
  /** text of the local assertion unit */
  text: string;
  /**
   * The enclosing sentence. CLAIM scope is the clause; QUALIFIER scope is the
   * sentence — a qualifier ("…; it has no operational authority") modifies the
   * claim in its own sentence, but never reaches another sentence or list item.
   */
  sentence: string;
  /** index of the list item / line this unit belongs to (-1 = prose) */
  itemIndex: number;
  /** entity references established by THIS unit (and its own leading heading) */
  scope: string[];
  modality: Modality;
  /** why that modality was chosen — surfaced in disagreement reports */
  modalityCue: string | null;
};

/** Generic record-identifier shape (e.g. AAAA-123). Not a contract list. */
const ENTITY_SHAPE = /\b[A-Z][A-Z0-9]{1,}-\d+\b/g;

export function normalizeEntity(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Strip markdown emphasis so segmentation is not confused by formatting. */
function stripMarkdown(s: string): string {
  return s.replace(/\*\*|__|~~|`/g, "");
}

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * Clause boundaries. A list item never merges with its neighbour, and inside a
 * line we split on sentence enders plus the contrastive/temporal connectives
 * that separate an attributed report from an assertion.
 */
const SENTENCE_SPLIT = /(?<=[.!?؟])\s+/;
const CLAUSE_SPLIT =
  /(?:\s*[;؛]\s*)|(?:,\s+but\s+)|(?:\s*،\s*لكن\s*)|(?:\s+while\s+)|(?:\s+whereas\s+)/;

/** Modality cues — English and Arabic are defined side by side, not mirrored. */
const CUES: { modality: Modality; cue: string; re: RegExp }[] = [
  // direct interrogative
  { modality: "QUESTION", cue: "interrogative punctuation", re: /[?؟]/ },
  {
    modality: "QUESTION",
    cue: "interrogative opener",
    re: /^\s*(which|what|who|whom|when|where|do you|could you|can you|هل|ما|من|أي|أين|متى)\b/i,
  },
  // embedded interrogative / hypothetical — not an assertion about the record
  {
    modality: "CONDITIONAL",
    cue: "embedded interrogative (whether/if)",
    re: /\b(whether|if)\b|\bما إذا\b|\bإذا\b/i,
  },
  {
    modality: "CONDITIONAL",
    cue: "hypothetical modal",
    re: /\b(would|were\s+\w+ed|unless)\b|\bسوف\s+لا\b|\bلو\b/i,
  },
  // someone/something else reported it — an attributed result, not the state
  {
    modality: "REPORTED_ATTRIBUTION",
    cue: "attribution verb",
    re: /\b(returned|reported|disagreed|according to|was logged|logged|states that)\b|\b(خالف|اختلف|وفقًا|أفاد|سجّل|سُجّل)\b/i,
  },
  // a proposal exists; nothing has been executed
  {
    modality: "PROPOSAL",
    cue: "proposal wording",
    re: /\b(propos(?:e|ed|al|ing))\b|\bawaiting approval\b|\bfor your approval\b|\b(مقترح|اقتراح)\b/i,
  },
  // first-person inability / capability not available
  {
    modality: "REFUSAL",
    cue: "first-person refusal",
    re: /\b(i|we)\b[^.]{0,40}\b(cannot|can't|cant|am unable|are unable|will not|won't)\b[^.]{0,40}\b(send|change|update|mark|apply|execute|assign|resolve|dismiss|modify|delete)\b/i,
  },
  {
    modality: "REFUSAL",
    cue: "capability not available",
    re: /\bnot (available|permitted|possible) in this phase\b|\bnot authori[sz]ed\b|\bغير متاح\b|\bلا (أستطيع|يمكنني)\b/i,
  },
];

function classifyModality(text: string): { modality: Modality; cue: string | null } {
  for (const c of CUES) if (c.re.test(text)) return { modality: c.modality, cue: c.cue };
  return { modality: "ASSERTION", cue: null };
}

/**
 * Segment an answer into local assertion units.
 *
 * Scope rule (the anti-leak mechanism): a unit's entity scope comes from its
 * OWN text, including the heading fragment that precedes a ':' or '—' on the
 * same line. Scope is never inherited from a previous list item, so a fact
 * stated under one item can never bind to another item's record.
 */
export function segment(answer: string): Unit[] {
  const units: Unit[] = [];
  const lines = stripMarkdown(answer).split(/\r?\n/);
  let itemIndex = -1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const isItem = LIST_MARKER.test(rawLine);
    if (isItem) itemIndex += 1;
    const body = line.replace(LIST_MARKER, "");

    // Entities named anywhere in THIS line (its own heading included).
    const lineScope = Array.from(new Set((body.match(ENTITY_SHAPE) ?? []).map(normalizeEntity)));

    for (const rawSentence of body.split(SENTENCE_SPLIT)) {
      const sentence = (rawSentence ?? "").trim();
      if (!sentence) continue;
      for (const piece of sentence.split(CLAUSE_SPLIT)) {
        const text = (piece ?? "").trim();
        if (text.length < 2) continue;
        const own = Array.from(new Set((text.match(ENTITY_SHAPE) ?? []).map(normalizeEntity)));
        const { modality, cue } = classifyModality(text);
        units.push({
          text,
          sentence,
          itemIndex: isItem ? itemIndex : -1,
          // the clause's own entity wins; otherwise the line's heading scope
          scope: own.length ? own : lineScope,
          modality,
          modalityCue: cue,
        });
      }
    }
  }
  return units;
}

/** All entity references in an answer — used to detect cross-scope lookups. */
export function allEntities(answer: string): string[] {
  return Array.from(new Set((stripMarkdown(answer).match(ENTITY_SHAPE) ?? []).map(normalizeEntity)));
}
