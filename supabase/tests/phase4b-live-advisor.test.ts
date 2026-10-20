/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4B — Live AI Contract Advisor unit tests ($0.00, no model calls).
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/phase4b-live-advisor.test.ts

import {
  PHASE_4B_READINESS,
  speakableCitations,
  speechCueFor,
  type OfficerAnswerEnvelope,
} from "../../src/lib/officer/realtime-contract";
import {
  toSpokenScript,
  visemeSequenceForText,
} from "../../src/lib/officer/voice";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function main() {
  // 1. Phase 4B readiness invariants
  check(
    "PHASE_4B_READINESS invariants are locked",
    PHASE_4B_READINESS.groundingIsServerSide === true &&
      PHASE_4B_READINESS.tenancyFromSessionOnly === true &&
      PHASE_4B_READINESS.citationsValidatedBeforeDisplay === true &&
      PHASE_4B_READINESS.actionsRequireServerReauthorization === true &&
      PHASE_4B_READINESS.clockResolvedServerSide === true &&
      PHASE_4B_READINESS.modelHasNoDirectDataAccess === true &&
      PHASE_4B_READINESS.externalCommunicationUnavailable === true,
  );

  // 2. Spoken script formatting (EN-US, EN-GB, AR-SA)
  const mdEn = [
    "### Portfolio Status",
    "**Contract ALPHA-100** has 1 overdue obligation.",
    "| Obligation | Due | Status |",
    "|---|---|---|",
    "| Monthly report | 2026-10-05 | Overdue |",
    "| Safety log | 2026-10-10 | Open |",
    "See [Clause 5.1](https://example.com) for details.",
  ].join("\n");

  const spokenEnUs = toSpokenScript(mdEn, "en-US");
  const spokenEnGb = toSpokenScript(mdEn, "en-GB");
  check(
    "toSpokenScript (EN-US/EN-GB): strips Markdown formatting and summarizes tables without reading pipes",
    !spokenEnUs.includes("|") &&
      !spokenEnUs.includes("**") &&
      !spokenEnUs.includes("###") &&
      !spokenEnUs.includes("https://") &&
      spokenEnUs.includes("Contract ALPHA-100 has 1 overdue obligation.") &&
      spokenEnUs.includes("A detailed table with 2 documented entries is shown in the transcript below.") &&
      spokenEnGb === spokenEnUs,
    spokenEnUs,
  );

  const mdAr = [
    "## ملخص الالتزامات",
    "**العقد GAMMA-300** يتضمن التزامًا متأخرًا.",
    "| البند | الاستحقاق |",
    "|---|---|",
    "| التقرير الشهري | 2026-10-05 |",
  ].join("\n");
  const spokenAr = toSpokenScript(mdAr, "ar-SA");
  check(
    "toSpokenScript (AR-SA): summarizes table in Arabic and preserves contract identifiers",
    !spokenAr.includes("|") &&
      !spokenAr.includes("**") &&
      spokenAr.includes("العقد GAMMA-300") &&
      spokenAr.includes("جدول مفصّل يتضمن 1 صفوف موثقة"),
    spokenAr,
  );

  // 3. Viseme sequence generation (EN + AR)
  const visEn = visemeSequenceForText("Monthly report overdue");
  const visAr = visemeSequenceForText("التقرير الشهري متأخر");
  check(
    "visemeSequenceForText (EN): produces lip-sync visemes ending in sil",
    visEn.length > 4 && visEn.includes("MBP") && visEn.at(-1) === "sil",
    visEn.join(","),
  );
  check(
    "visemeSequenceForText (AR): produces lip-sync visemes for Arabic words ending in sil",
    visAr.length > 4 && visAr.at(-1) === "sil",
    visAr.join(","),
  );
  check(
    "visemeSequenceForText (empty): returns ['sil']",
    JSON.stringify(visemeSequenceForText("   ")) === JSON.stringify(["sil"]),
  );

  // 4. Speech cues from validated OfficerAnswerEnvelope
  const baseAnswer: OfficerAnswerEnvelope = {
    text: "All checked.",
    citations: [],
    toolInvocations: [],
    proposedActionIds: [],
    uncertainty: false,
    budgetExhausted: false,
    provider: "deterministic-tools",
    model: "zero-cost",
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 12,
  };
  check("speechCueFor: neutral when no uncertainty, proposals or critical observations", speechCueFor(baseAnswer, []) === "neutral");
  check(
    "speechCueFor: uncertainty when answer.uncertainty is true",
    speechCueFor({ ...baseAnswer, uncertainty: true }, []) === "uncertainty",
  );
  check(
    "speechCueFor: approval_request when proposedActionIds is non-empty",
    speechCueFor({ ...baseAnswer, proposedActionIds: ["act-1"] }, []) === "approval_request",
  );
  check(
    "speechCueFor: critical when an active critical observation exists",
    speechCueFor(baseAnswer, [{ severity: "critical", status: "active" } as any]) === "critical",
  );

  // 5. Speakable citations filter
  const cites = speakableCitations([
    { target: "contract", id: "c-1", label: "ALPHA-100" },
    { target: "obligation", id: "", label: "Missing id" },
    { target: "clause", id: "cl-1", label: "" },
  ]);
  check(
    "speakableCitations keeps only citations with both id and label",
    cites.length === 1 && cites[0].id === "c-1",
  );

  console.log(`\n${passed}/${passed + failed} passed`);
  process.exit(failed ? 1 : 0);
}

main();
