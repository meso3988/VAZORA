/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 5 — recorded history vs current state, PAIRED cases.
//
//   REPRO  frozen r4 rejects supported recorded-history wording
//   FIXED  r5 accepts it — only with a matching CITED event
//   GUARD  r5 still rejects every closely related unsupported variant
// Deterministic; no model, no network. Payload shapes mirror tools.ts.

import * as r4 from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/fact-ledger";
import * as r5 from "../benchmarks/contract-officer-benchmark-v3/fact-ledger";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name} ${detail}`); }
}

const REQ_F = "f2222222-2222-2222-2222-222222222222";
const ITEM_F = "f3333333-3333-3333-3333-333333333333";
const REQ_K = "d2222222-2222-2222-2222-222222222222";
const EV_UPLOAD = "a2222222-2222-2222-2222-222222222222";
const EV_CONFIRM = "a1111111-1111-1111-1111-111111111111";
const EV_KPI = "a3333333-3333-3333-3333-333333333333";
const fx: any = {
  contracts: {
    d: { number: "DELTA-400", title: "Asset management", contractId: "c-d", obligationId: "o-d", obligationTitle: "Signed asset register", clauseId: "cl-d", clauseNumber: "11.5",
         kpiReq: { reqId: REQ_K, name: "KPI results table" } },
    f: { number: "ZETA-600", title: "Logistics and warehousing", contractId: "c-f", obligationId: "o-f", obligationTitle: "Monthly logistics report", clauseId: "cl-f", clauseNumber: "12.9",
         req: { reqId: REQ_F, itemId: ITEM_F, name: "Monthly logistics report item" } },
  },
};
const E4 = r4.buildEntityMap(fx);
const E5 = r5.buildEntityMap(fx);
const P = (tool: string, data: unknown) => ({ tool, payload: JSON.stringify({ ok: true, data }) });

// the upload event recorded, at upload time, "received — awaiting verification"
const events = [P("getRecentActivity", { changes: [
  { id: EV_UPLOAD, event_type: "evidence.version_uploaded", entity_type: "evidence_item", entity_id: ITEM_F,
    label: "Monthly logistics report item", contract_number: "ZETA-600",
    details: { contract: "ZETA-600", requirement: "Monthly logistics report item", note: "received — awaiting verification" } },
  { id: EV_CONFIRM, event_type: "obligation.due_date_confirmed", entity_type: "obligation", entity_id: "o-f",
    label: "Monthly logistics report", contract_number: "ZETA-600",
    details: { contract: "ZETA-600", requirement: "Monthly logistics report item", note: "awaiting verification noted" } },
  { id: EV_KPI, event_type: "evidence.version_uploaded", entity_type: "evidence_item", entity_id: "i-k",
    label: "KPI results table", details: { requirement: "KPI results table", note: "received — awaiting verification" } },
] })];
const UPLOAD_CITE = [{ target: "activity_event", id: EV_UPLOAD }];

function r5state(text: string, payloads: any[], cites: { target: string; id: string }[]) {
  const scored = r5.scoreClaims(r5.extractClaims(text, E5), r5.buildCorpus({ toolPayloads: payloads, question: "", contextValues: [], entities: E5 }));
  const resolved = r5.resolveHistoricalClaims(scored, cites, r5.buildActivityIndex(payloads, E5));
  return resolved.find((c) => c.type === "verification_state");
}
function r4state(text: string, payloads: any[]) {
  return r4.scoreClaims(r4.extractClaims(text, E4), r4.buildCorpus({ toolPayloads: payloads, question: "", contextValues: [], entities: E4 }))
    .find((c) => c.type === "verification_state");
}

const HIST = "A new version of the Monthly logistics report item on ZETA-600 was uploaded and was recorded as awaiting verification.";
const HIST2 = "At upload time, the Monthly logistics report item was recorded as awaiting verification.";

// ---- supported historical wording ------------------------------------------------
{
  const old = r4state(HIST, events);
  check("H REPRO r4 rejects supported recorded-history wording", !!old && !old.supported, JSON.stringify(old));
  const c = r5state(HIST, events, UPLOAD_CITE);
  check("H FIXED r5: cited upload event matches record + status + context → supported",
    !!c && c.historical === true && c.supported && c.historicalEventId === EV_UPLOAD, JSON.stringify(c));
  const c2 = r5state(HIST2, events, UPLOAD_CITE);
  check("H FIXED r5: 'At upload time, … was recorded as …' → supported", !!c2 && c2.historical === true && c2.supported, JSON.stringify(c2));
}

// ---- the same wording asserted as CURRENT state, no current lookup ---------------
{
  const cur = r5state("The Monthly logistics report item on ZETA-600 is awaiting verification.", events, UPLOAD_CITE);
  check("H GUARD current-state wording + only the upload event cited → unsupported", !!cur && !cur.historical && !cur.supported, JSON.stringify(cur));
  const past = r5state("The Monthly logistics report item on ZETA-600 was awaiting verification after the upload.", events, UPLOAD_CITE);
  check("H GUARD past tense alone (no 'recorded as') is not recorded history → unsupported", !!past && !past.historical && !past.supported, JSON.stringify(past));
}

// ---- citation alone / no citation --------------------------------------------------
{
  const uncited = r5state(HIST, events, []);
  check("H GUARD correct history but the event is NOT cited → unsupported", !!uncited && uncited.historical === true && !uncited.supported);
}

// ---- invented historical status ---------------------------------------------------
{
  const inv = r5state("A new version of the Monthly logistics report item on ZETA-600 was uploaded and was recorded as verified.", events, UPLOAD_CITE);
  check("H GUARD invented historical status ('recorded as verified') → unsupported", !!inv && inv.historical === true && !inv.supported, JSON.stringify(inv));
}

// ---- correct status, wrong record / wrong event / wrong context ------------------
{
  const wrongItem = r5state("A new version of the KPI results table on DELTA-400 was uploaded and was recorded as awaiting verification.", events, UPLOAD_CITE);
  check("H GUARD correct status but a DIFFERENT record than the cited event → unsupported", !!wrongItem && !wrongItem.supported, JSON.stringify(wrongItem));
  const wrongEvent = r5state(HIST, events, [{ target: "activity_event", id: EV_CONFIRM }]);
  check("H GUARD citing an event with a different action (due-date confirmation) → unsupported", !!wrongEvent && !wrongEvent.supported, JSON.stringify(wrongEvent));
  const wrongContext = r5state("When the due date was confirmed, the Monthly logistics report item was recorded as awaiting verification.", events, UPLOAD_CITE);
  check("H GUARD context mismatch (sentence says confirmation, event is an upload) → unsupported", !!wrongContext && !wrongContext.supported, JSON.stringify(wrongContext));
}

// ---- a NEWER current status differs from the historical event --------------------
{
  const withCurrent = [...events, P("getEvidenceStatus", { requirements: [{ requirementId: REQ_F, name: "Monthly logistics report item", status: "verified", operationalStatus: "verified" }] })];
  const hist = r5state(HIST, withCurrent, UPLOAD_CITE);
  check("H FIXED history may still be described when the current status is newer", !!hist && hist.historical === true && hist.supported, JSON.stringify(hist));
  const cur = r5state("The Monthly logistics report item on ZETA-600 is awaiting verification.", withCurrent, UPLOAD_CITE);
  check("H GUARD …but it may not be presented as current (current = verified)", !!cur && !cur.supported, JSON.stringify(cur));
  const nowVerified = r5state("The Monthly logistics report item on ZETA-600 is verified.", withCurrent, [...UPLOAD_CITE]);
  check("H SANITY the newer current status itself is supported by the current lookup", !!nowVerified && nowVerified.supported);
}

// ---- free text never becomes current status or official acceptance --------------
{
  const freeText = [P("getRecentActivity", { changes: [
    { id: EV_UPLOAD, event_type: "evidence.version_uploaded", entity_type: "evidence_item", entity_id: ITEM_F,
      details: { requirement: "Monthly logistics report item", note: "uploader wrote: verified and approved" } },
  ] })];
  const hist = r5state("A new version of the Monthly logistics report item was uploaded and was recorded as verified.", freeText, UPLOAD_CITE);
  check("H FIXED what the event content recorded can be described as history", !!hist && hist.supported);
  const cur = r5state("The Monthly logistics report item is verified.", freeText, UPLOAD_CITE);
  check("H GUARD free-text 'verified' in an event never proves CURRENT status", !!cur && !cur.supported, JSON.stringify(cur));
}

// ---- citation support uses the exact supporting event ------------------------------
{
  const scored = r5.resolveHistoricalClaims(
    r5.scoreClaims(r5.extractClaims(HIST2, E5), r5.buildCorpus({ toolPayloads: events, question: "", contextValues: [], entities: E5 })),
    UPLOAD_CITE, r5.buildActivityIndex(events, E5));
  const ids = new Map<string, Set<string>>([[`requirement:${REQ_F}`, new Set([REQ_F, ITEM_F])]]);
  const checks = r5.bindCitationsToClaims(scored.filter((c) => c.supported), UPLOAD_CITE, ids, r5.buildActivityIndex(events, E5));
  check("H FIXED the historical claim's citation support is the supporting event", checks.length > 0 && checks.every((c) => c.satisfied), JSON.stringify(checks));
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) { console.error(`failures: ${failures.join(", ")}`); process.exit(1); }
