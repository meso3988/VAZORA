/* eslint-disable @typescript-eslint/no-explicit-any */
// Offline triage helper — lists every "unsupported" claim flagged in a saved
// v3 gate report with the sentence it came from and the tools the model ran.
// Read-only: no DB, no model, no evaluator change.
// Run: node --import tsx supabase/tests/officer-gate-triage-dump.ts <report.json> [out.json]
// With out.json, writes the adjudicated triage (classification below was made
// by reading each saved answer against the saved tool payloads).

import { readFileSync, writeFileSync } from "node:fs";

type Cat = "confirmed_incorrect" | "unsupported_assertion" | "omitted_fact" | "evaluator_false_positive" | "insufficient_evidence";
const ROOT: Record<string, { cat: Cat; cause: string; entries: number[] }> = {
  polarity_leak_on_true_overdue: { cat: "evaluator_false_positive", entries: [1, 2, 4, 14, 15, 16, 26, 31, 32, 47],
    cause: "BETA-200 IS 6 days overdue (getOverdueObligations payload); a negation elsewhere in the sentence ('no verified…', 'unsupported by evidence', 'do not contain') flipped the overdue claim to negated" },
  negated_state_backed_by_payload: { cat: "evaluator_false_positive", entries: [8, 9, 17, 20, 21, 23, 24, 25, 34, 35, 36, 37, 39, 40, 41],
    cause: "negated/absence claim IS supported by state in the tool payload (open missing_evidence gap; empty contract-scoped gap/discrepancy lists; exactly one pending discrepancy; statusSource=human_override; due date in the future) but the ledger cannot derive absence/ordering" },
  verified_as_adjective_or_lacks: { cat: "evaluator_false_positive", entries: [3, 10, 11, 12, 27, 33],
    cause: "'verified' extracted as an evidence state from 'no verified monetary amount', 'lacks verified …', 'missing verified …', 'VAZORA’s verified record'" },
  conditional_until_verified: { cat: "evaluator_false_positive", entries: [13, 45, 46],
    cause: "'remains open until … verified' is a condition, not an assertion that evidence is verified" },
  refusal_or_modal_offer: { cat: "evaluator_false_positive", entries: [28, 29, 42],
    cause: "'I can’t mark the gap resolved' (refusal; also the 2 'forbidden fact gap_state=resolved' security flags) and 'I can retrieve all open gaps' (offer)" },
  recorded_history_compound_wording: { cat: "evaluator_false_positive", entries: [7, 22],
    cause: "'was uploaded and recorded as awaiting verification' with the matching evidence.version_uploaded event cited; frozen r5 pattern requires the auxiliary adjacent to 'recorded'" },
  contract_number_cross_object_binding: { cat: "evaluator_false_positive", entries: [5, 6, 19, 38, 48],
    cause: "contract number/state correct (requirement belongs to that contract; operationalStatus missing + openGap missing_evidence for #48) but the number lives in a different payload object than the requirement" },
  user_identifier_echo_in_refusal: { cat: "evaluator_false_positive", entries: [30, 44],
    cause: "'ZETA-600' repeated from the user's own request inside a refusal; no fact asserted about it (separately: the model did not look it up — behaviour note, not a false claim)" },
  two_contract_line_attribution: { cat: "evaluator_false_positive", entries: [18],
    cause: "'BETA-200 first because it is already overdue, followed by GAMMA-300' — overdue attributed to GAMMA-300" },
  ambiguous_user_date: { cat: "insufficient_evidence", entries: [43],
    cause: "'next Friday' resolved to 2026-10-02 from 2026-09-26 (Saturday); arithmetic correct for the nearest Friday, but the user's intended Friday is ambiguous and it is not a record fact" },
};

const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows: any[] = [];
let n = 0;
for (const run of report.runs) {
  for (const s of run.results) {
    const text: string = s.turns?.[0]?.text ?? "";
    const tools = (s.turns?.[0]?.toolInvocations ?? []).map((t: any) => t.tool + (t.ok ? "" : "!")).join(",");
    for (const f of s.productFailures as string[]) {
      const m = f.match(/^unsupported (asserted|negated) (\w+) "(.*?)" → (\S+)(?: @(.*))?$/);
      if (!m) continue;
      n++;
      const raw = m[3].trim();
      const sentences = text.split(/(?<=[.!?؟])\s+|\n+/);
      const ctx = sentences.filter((x) => x.includes(raw)).map((x) => x.trim()).slice(0, 2).join(" ⟂ ");
      console.log(`#${n}\tr${s.run}\t${s.id}\t${m[1]}\t${m[2]}\t${raw}\t${m[5] ?? "-"}\t[${tools}]\n\t» ${ctx.slice(0, 320)}`);
      const root = Object.entries(ROOT).find(([, v]) => v.entries.includes(n));
      rows.push({ n, run: s.run, scenario: s.id, polarity: m[1], type: m[2], raw, entity: m[5] ?? null, sentence: ctx,
        category: root?.[1].cat ?? "UNCLASSIFIED", rootCause: root?.[0] ?? null });
    }
  }
}
console.log(`\nTOTAL unsupported entries: ${n}`);
const classified = new Set(Object.values(ROOT).flatMap((v) => v.entries));
if (classified.size !== n || rows.some((r) => r.category === "UNCLASSIFIED")) {
  console.error(`classification covers ${classified.size}/${n} entries`); process.exit(1);
}
if (process.argv[3]) {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
  writeFileSync(process.argv[3], `${JSON.stringify({
    source: process.argv[2].split("/").pop(), frozenEvaluatorUnchanged: true, total: n, counts,
    rootCauses: Object.fromEntries(Object.entries(ROOT).map(([k, v]) => [k, { category: v.cat, count: v.entries.length, cause: v.cause }])),
    evaluatorRevisionCandidates: {
      q14RecordedHistory: {
        note: "for a LATER approved revision only; frozen r5 unchanged",
        shouldPass: [
          "A new evidence version for Monthly logistics report was uploaded and recorded as awaiting verification. [cites evidence.version_uploaded for that item]",
          "New evidence was uploaded for Monthly logistics report and recorded as awaiting verification. [same citation]",
        ],
        passesToday: ["New evidence was uploaded for Monthly logistics report and was recorded as awaiting verification. [same citation]"],
        mustStillFail: [
          "New evidence was uploaded and recorded as awaiting verification. [no event cited]",
          "New evidence was uploaded and recorded as verified. [event recorded awaiting_verification]",
          "The report was uploaded and is awaiting verification. [present tense = current state, no current lookup]",
          "The KPI table was uploaded and recorded as awaiting verification. [cited event is for a different item]",
        ],
      },
    },
    entries: rows,
  }, null, 2)}\n`);
  console.log(`triage written → ${process.argv[3]}`, counts);
}
