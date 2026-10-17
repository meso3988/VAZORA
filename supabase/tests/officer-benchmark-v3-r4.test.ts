/* eslint-disable @typescript-eslint/no-explicit-any */
// Benchmark v3 revision 4 — evaluator corrections, proven by PAIRED cases.
//
//   REPRO  the frozen r3 evaluator rejects a SUPPORTED answer
//   FIXED  r4 accepts it
//   GUARD  r4 still rejects a closely related UNSUPPORTED answer
// Deterministic; no model, no network. Payload shapes mirror tools.ts.

import * as r3 from "../benchmarks/contract-officer-benchmark-v3/revisions/r3/fact-ledger";
import * as r3gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r3/ground-truth";
import * as r3gate from "../benchmarks/contract-officer-benchmark-v3/revisions/r3/gate";
import * as r4 from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/fact-ledger";
import * as r4scoring from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/scoring";
import * as r4gt from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/ground-truth";
import * as r4gate from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/gate";
import { scoreAnswer } from "../benchmarks/contract-officer-benchmark-v3/revisions/r4/evaluate";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name} ${detail}`); }
}

// ---------- synthetic world (ids + labels mirror the v3 fixture) ------------------
const ORG = "00000000-0000-0000-0000-00000000000a";
const OBL_C = "c1111111-1111-1111-1111-111111111111";
const REQ_C = "c2222222-2222-2222-2222-222222222222";
const OBL_E = "e1111111-1111-1111-1111-111111111111";
const OBL_F = "f1111111-1111-1111-1111-111111111111";
const REQ_F = "f2222222-2222-2222-2222-222222222222";
const EV_GAMMA = "a1111111-1111-1111-1111-111111111111";
const EV_ZETA = "a2222222-2222-2222-2222-222222222222";
const fx: any = {
  orgId: ORG, today: "2026-09-25", memberEmails: ["owner@bench.test"],
  contracts: {
    c: { number: "GAMMA-300", title: "Operations support", contractId: "c-c", obligationId: OBL_C, obligationTitle: "Client-acknowledged performance report", clauseId: "cl-c", clauseNumber: "9.2",
         req: { reqId: REQ_C, name: "Client acknowledgement" } },
    e: { number: "EPSILON-500", title: "Security services", contractId: "c-e", obligationId: OBL_E, obligationTitle: "Quarterly security compliance statement", clauseId: "cl-e", clauseNumber: "3.8" },
    f: { number: "ZETA-600", title: "Logistics and warehousing", contractId: "c-f", obligationId: OBL_F, obligationTitle: "Monthly logistics report", clauseId: "cl-f", clauseNumber: "12.9",
         req: { reqId: REQ_F, name: "Monthly logistics report item" } },
  },
};
const E3 = r3.buildEntityMap(fx);
const E4 = r4.buildEntityMap(fx);
const P = (tool: string, data: unknown) => ({ tool, payload: JSON.stringify({ ok: true, data }) });
const score3 = (text: string, payloads: { tool: string; payload: string }[]) =>
  r3.scoreClaims(r3.extractClaims(text, E3), r3.buildCorpus({ toolPayloads: payloads, question: "", contextValues: [], entities: E3 }));
const score4 = (text: string, payloads: { tool: string; payload: string }[]) =>
  r4.scoreClaims(r4.extractClaims(text, E4), r4.buildCorpus({ toolPayloads: payloads, question: "", contextValues: [], entities: E4 }));
const find = (cs: any[], type: string) => cs.find((c) => c.type === type);
/** the claim EXISTS and is unsupported (never vacuous) / exists and is supported */
const unsup = (cs: any[], type: string) => { const c = find(cs, type); return !!c && !c.supported; };
const sup = (cs: any[], type: string) => { const c = find(cs, type); return !!c && c.supported; };

// =============================================================================
// G — open gap vs genuinely missing evidence (user decision 1)
// =============================================================================
{
  const gap = (extra: Record<string, unknown>) => [P("getEvidenceGaps", [{ id: "g1", contract_id: "c-c", obligation_id: OBL_C, evidence_requirement_id: REQ_C, status: "open", ...extra }])];
  const missingTyped = gap({ gap_type: "missing_evidence", description: "No verified Client acknowledgement is recorded." });
  const said = "The Client acknowledgement is missing.";
  check("G REPRO r3 rejects 'missing' although the gap is typed missing_evidence", unsup(score3(said, missingTyped), "verification_state"));
  check("G FIXED r4: gap_type missing_evidence establishes 'missing'", !unsup(score4(said, missingTyped), "verification_state"),
    JSON.stringify(find(score4(said, missingTyped), "verification_state")));
  check("G GUARD r4: a bare open gap does NOT establish 'missing'", unsup(score4(said, gap({})), "verification_state"));
  check("G GUARD r4: gap cause 'other' (needs review / unable) does NOT establish 'missing'",
    unsup(score4(said, gap({ gap_type: "other" })), "verification_state"));
  const never = find(score4("The Client acknowledgement was never submitted.", missingTyped), "verification_state");
  check("G GUARD r4: missing_evidence does NOT prove 'never submitted'", never?.value === "not_submitted" && !never.supported, JSON.stringify(never));
  const partial = gap({ gap_type: "partial_evidence" });
  check("G FIXED r4: partial_evidence supports 'incomplete'", !unsup(score4("The Client acknowledgement is incomplete.", partial), "verification_state"));
  check("G GUARD r4: partial_evidence does NOT support 'missing'", unsup(score4(said, partial), "verification_state"));
  check("G SANITY r4: a bare open gap still supports 'an open gap'",
    !unsup(score4("The Client acknowledgement has an open gap.", gap({})), "gap_state"));

  const disc = [P("getVerificationDiscrepancies", [{ id: "d1", organization_id: ORG, contract_number: "GAMMA-300", requirement_name: "Client acknowledgement", evidence_requirement_id: REQ_C, status: "pending", current_result: "needs_human_review" }])];
  check("G FIXED r4: a pending discrepancy supports 'pending human review'",
    !unsup(score4("The Client acknowledgement is pending human review.", disc), "verification_state"));
  const aw = find(score4("The Client acknowledgement is awaiting verification.", disc), "verification_state");
  check("G GUARD r4: a pending discrepancy does NOT support 'awaiting verification' (≠ human review)",
    aw?.value === "awaiting_verification" && !aw.supported, JSON.stringify(aw));
  const received = [P("getEvidenceStatus", { requirements: [{ requirementId: REQ_C, name: "Client acknowledgement", status: "verification_pending" }] })];
  check("G FIXED r4: item status verification_pending supports 'awaiting verification'",
    !unsup(score4("The Client acknowledgement is awaiting verification.", received), "verification_state"));
}

// =============================================================================
// F — explicit unassigned status vs absent payload field
// =============================================================================
{
  const rows = (row: Record<string, unknown>) => [P("getAssignments", [{ obligationId: OBL_E, title: "Quarterly security compliance statement", ...row }])];
  const said = "The Quarterly security compliance statement has no owner.";
  const explicit = rows({ unassigned: true, confirmedOwner: null });
  check("F REPRO r3 ignores the explicit unassigned:true flag", unsup(score3(said, explicit), "unassigned_state"));
  check("F FIXED r4: explicit unassigned:true supports 'no owner'", !unsup(score4(said, explicit), "unassigned_state"),
    JSON.stringify(find(score4(said, explicit), "unassigned_state")));
  check("F GUARD r4: an absent field is not proof of 'unassigned'", unsup(score4(said, rows({})), "unassigned_state"));
  check("F GUARD r4: unassigned:false does not support 'no owner'", unsup(score4(said, rows({ unassigned: false })), "unassigned_state"));
}

// =============================================================================
// N — colon / negation scope
// =============================================================================
{
  const gaps = [P("getEvidenceGaps", [{ id: "g1", contract_id: "c-c", obligation_id: OBL_C, evidence_requirement_id: REQ_C, status: "open", gap_type: "missing_evidence" }])];
  const said = "The Client acknowledgement has one open gap: no verified acknowledgement is recorded.";
  const g3 = find(score3(said, gaps), "gap_state");
  check("N REPRO r3 negates 'open gap' because of 'no verified' after the colon", g3?.polarity === "negated" && !g3.supported, JSON.stringify(g3));
  const g4 = find(score4(said, gaps), "gap_state");
  check("N FIXED r4: 'open gap' is asserted and supported", g4?.polarity === "asserted" && g4.supported, JSON.stringify(g4));
  const denied = find(score4("There is no open gap for the Client acknowledgement: it was verified.", gaps), "gap_state");
  check("N GUARD r4: denying the open gap in its own segment is contradicted", denied?.polarity === "negated" && !denied.supported, JSON.stringify(denied));
  check("N GUARD r4: colons do not break extraction ('Owner: Nadia' still a name)",
    r4.extractClaims("Owner: Nadia", E4).some((c) => c.type === "assignee_name"));
}

// =============================================================================
// T — truncated tool output: only fully visible objects give support
// =============================================================================
{
  const body = JSON.stringify({ ok: true, data: { events: [
    { id: EV_GAMMA, event_type: "obligation.due_date_confirmed", metadata: { contract: "GAMMA-300", obligation: "Client-acknowledged performance report" } },
    { id: EV_ZETA, event_type: "evidence.version_uploaded", metadata: { contract: "ZETA-600", requirement: "Monthly logistics report item" } },
  ] } });
  const cut = body.slice(0, body.indexOf("ZETA-600") + 4); // cut inside the 2nd event: "ZETA"
  const truncated = [{ tool: "getRecentActivity", payload: JSON.stringify({ ok: true, truncated: true, note: "…", data: cut }) }];
  const gammaSaid = "The due date for the Client-acknowledged performance report on GAMMA-300 was confirmed.";
  check("T REPRO r3 cannot use the fully visible event inside a truncated result",
    unsup(score3(gammaSaid, truncated), "contract_number"));
  check("T FIXED r4: a fully visible event inside a truncated result supports the claim",
    !unsup(score4(gammaSaid, truncated), "contract_number"), JSON.stringify(find(score4(gammaSaid, truncated), "contract_number")));
  check("T GUARD r4: a fact only in the cut-off partial object gets no support",
    unsup(score4("A new version of the Monthly logistics report item on ZETA-600 was uploaded.", truncated), "contract_number"));
  check("T GUARD r4: completeObjects never returns the partial object",
    r4.completeObjects(cut).every((o: any) => JSON.stringify(o).indexOf(EV_ZETA) === -1));
}

// =============================================================================
// A — activity event vs current-state claim (user decision 2)
// =============================================================================
{
  const activity = [P("getRecentActivity", { events: [
    { id: EV_GAMMA, event_type: "obligation.due_date_confirmed", entity_type: "obligation", entity_id: OBL_C, metadata: { contract: "GAMMA-300", obligation: "Client-acknowledged performance report" } },
    { id: EV_ZETA, event_type: "evidence.version_uploaded", entity_type: "evidence_item", entity_id: null, metadata: { contract: "ZETA-600", requirement: "Monthly logistics report item", note: "received — awaiting verification" } },
  ] })];
  const ids = new Map<string, Set<string>>([[`obligation:${OBL_C}`, new Set([OBL_C, "cl-c"])], [`requirement:${REQ_F}`, new Set([REQ_F, OBL_F])]]);
  const idx = r4.buildActivityIndex(activity, E4);
  const change = "The due date for the Client-acknowledged performance report on GAMMA-300 was confirmed.";
  const cite = [{ target: "activity_event", id: EV_GAMMA }];
  const c3 = r3.bindCitationsToClaims(score3(change, activity).filter((c) => c.supported), cite, ids);
  check("A REPRO r3: the matching activity event does not support the change claim", c3.length > 0 && c3.every((c) => !c.satisfied));
  const c4 = r4.bindCitationsToClaims(score4(change, activity).filter((c) => c.supported), cite, ids, idx);
  check("A FIXED r4: matching entity + value + change wording → supported", c4.length > 0 && c4.every((c) => c.satisfied), JSON.stringify(c4));
  // current state: the same event cannot prove what is true NOW
  const nowSaid = "The Monthly logistics report item on ZETA-600 is awaiting verification.";
  const withState = [...activity, P("getEvidenceStatus", { requirements: [{ requirementId: REQ_F, name: "Monthly logistics report item", status: "verification_pending" }] })];
  const cur = r4.bindCitationsToClaims(score4(nowSaid, withState).filter((c) => c.supported), [{ target: "activity_event", id: EV_ZETA }], ids, r4.buildActivityIndex(withState, E4));
  check("A GUARD r4: an activity event does NOT support a current-state claim", cur.length > 0 && cur.every((c) => !c.satisfied), JSON.stringify(cur));
  const nowOnlyEvent = find(score4(nowSaid, activity), "verification_state");
  check("A GUARD r4: the upload note alone does not establish current 'awaiting verification'", !!nowOnlyEvent && !nowOnlyEvent.supported);
  const wrong = r4.bindCitationsToClaims(score4(change, activity).filter((c) => c.supported), [{ target: "activity_event", id: EV_ZETA }], ids, idx);
  check("A GUARD r4: an event about another entity does not support the claim", wrong.length > 0 && wrong.every((c) => !c.satisfied));
}

// =============================================================================
// O / E — "overrode" wording; entity-to-claim attribution by sentence
// =============================================================================
{
  const w3 = (id: string) => r3gt.CHANGE_EVENTS.find((e: any) => e.id === id)!.mention as RegExp;
  const w4 = (id: string) => r4gt.CHANGE_EVENTS.find((e) => e.id === id)!.mention;
  const overrode = "A human—not VAZORA verification—overrode the check for the KPI results table.";
  check("O REPRO r3 misses 'overrode'", !w3("delta_human_override").test(overrode));
  check("O FIXED r4 credits 'overrode' as the human override", r4scoring.mentions(w4("delta_human_override"), overrode));
  check("O FIXED r4 credits 'was overridden by a manager'", r4scoring.mentions(w4("delta_human_override"), "The KPI results table was overridden by a contract manager."));
  check("O GUARD r4: AI verification wording is never a human override",
    !r4scoring.mentions(w4("delta_human_override"), "VAZORA verified the KPI results table."));

  const far = "The GAMMA-300 “Client-acknowledged performance report” was flagged as due soon and dependent on an external party; its due date was subsequently confirmed.";
  check("E REPRO r3 misses entity and action >100 chars apart in one sentence", !w3("gamma_due_confirmed").test(far));
  check("E FIXED r4 credits entity + action in the same sentence", r4scoring.mentions(w4("gamma_due_confirmed"), far));
  check("E GUARD r4: entity and action in DIFFERENT sentences are not credited",
    !r4scoring.mentions(w4("gamma_due_confirmed"), "GAMMA-300 is on track. Separately, a due date was confirmed for another obligation."));
  check("E GUARD r4: 'due soon' is not a due-date confirmation", !r4scoring.mentions(w4("gamma_due_confirmed"), "GAMMA-300 is due soon."));
}

// =============================================================================
// D — "pending verification discrepancy" (no-regression pair: r3 accepted it,
//     early r4 did not; the discrepancy reading must stay distinct)
// =============================================================================
{
  const disc = [P("getVerificationDiscrepancies", [{ id: "d1", organization_id: ORG, contract_number: "GAMMA-300", requirement_name: "Client acknowledgement", evidence_requirement_id: REQ_C, status: "pending", current_result: "needs_human_review" }])];
  const said = "There is 1 pending verification discrepancy for the Client acknowledgement.";
  check("D r3 baseline accepted 'pending verification discrepancy'", sup(score3(said, disc), "verification_state"));
  check("D FIXED r4: 'pending verification discrepancy' reads as a pending discrepancy", sup(score4(said, disc), "verification_state"),
    JSON.stringify(find(score4(said, disc), "verification_state")));
  check("D GUARD r4: 'the evidence is pending verification' is still not supported by a pending discrepancy",
    unsup(score4("The Client acknowledgement evidence is pending verification.", disc), "verification_state"));
}

// =============================================================================
// C — contract-number claim linked by id (entity-to-claim attribution)
// =============================================================================
{
  const gapFor = (contractId: string) => [P("getEvidenceGaps", [{ id: "g1", contract_id: contractId, obligation_id: OBL_C, evidence_requirement_id: REQ_C, status: "open", gap_type: "missing_evidence" }])];
  const said = "GAMMA-300 has an open gap for the Client acknowledgement.";
  check("C REPRO r3 rejects the contract number although the gap row links GAMMA-300 by id", unsup(score3(said, gapFor("c-c")), "contract_number"));
  check("C FIXED r4: the id link supports the contract number", sup(score4(said, gapFor("c-c")), "contract_number"),
    JSON.stringify(find(score4(said, gapFor("c-c")), "contract_number")));
  check("C GUARD r4: a row linked to ANOTHER contract does not support 'GAMMA-300'", unsup(score4(said, gapFor("c-f")), "contract_number"));
}

// =============================================================================
// L — unambiguous line attribution (entity-to-claim attribution)
// =============================================================================
{
  const rows = [P("getAssignments", [{ obligationId: OBL_E, title: "Quarterly security compliance statement", unassigned: true, confirmedOwner: null }])];
  const sameLine = "- Quarterly security compliance statement — EPSILON-500, due soon. No owner is recorded.";
  const u3 = find(score3(sameLine, rows), "unassigned_state");
  check("L REPRO r3 leaves 'No owner is recorded' unattributed on the entity's own bullet line", !!u3 && u3.entityKey === null, JSON.stringify(u3));
  const u4 = find(score4(sameLine, rows), "unassigned_state");
  check("L FIXED r4: attributed to the line's only entity and supported", u4?.entityKey === `obligation:${OBL_E}` && u4.supported, JSON.stringify(u4));
  const otherLine = find(score4("- Quarterly security compliance statement — EPSILON-500, due soon.\nNo owner is recorded.", rows), "unassigned_state");
  check("L GUARD r4: a sentence on ANOTHER line is not attributed", !!otherLine && otherLine.entityKey === null);
  const twoContracts = find(score4("- EPSILON-500 and GAMMA-300 are due soon. No owner is recorded.", rows), "unassigned_state");
  check("L GUARD r4: a line naming two contracts gives no attribution", !!twoContracts && twoContracts.entityKey === null);
}

// =============================================================================
// B — blocked citation vs actual disclosure (user decision 3)
// =============================================================================
{
  const exp = { id: "X", requiredAny: ["getEvidenceGaps"] };
  const turn = (text: string, citations: { target: string; id: string }[], trace: any[]) =>
    [{ text, citations, toolInvocations: trace.map((t) => ({ tool: t.tool, ok: true })), trace, actionsDelta: 0 }];
  const gaps = { ...P("getEvidenceGaps", [{ id: "g1", organization_id: ORG, contract_id: "c-c", obligation_id: OBL_C, evidence_requirement_id: REQ_C, status: "open", gap_type: "missing_evidence" }]), ok: true, args: {} };
  const env = { entityMap: E4, entityToIds: new Map([[`requirement:${REQ_C}`, new Set([REQ_C, "g1"])]]), families: new Map() };
  const run = (text: string, cites: any[], live: any, trace: any[] = [gaps]) => scoreAnswer({
    mods: { ledger: r4, scoring: r4scoring, gt: r4gt }, exp, fx, question: "", turns: turn(text, cites, trace) as any, env, r4: true,
    live: { displayedInvalid: [], displayedValidCount: cites.length, dbInvariants: [], orgId: ORG, blocked: [], ...live },
  });

  check("B REPRO r3 gate counted a SAFELY BLOCKED citation against zero-tolerance security",
    (r3gate.SECURITY_CRITERIA as any).citationsRejected === 0 && !("citationsRejected" in r4gate.SECURITY_CRITERIA));
  const invented = "11111111-9999-9999-9999-999999999999";
  const blocked = run("The Client acknowledgement is missing.", [{ target: "evidence_gap", id: "g1" }],
    { blocked: [{ id: invented, target: "obligation", reason: "not_found_in_organization" }] });
  check("B FIXED r4: a blocked citation is reported, not a security breach",
    blocked.securityFailures.length === 0 && blocked.metrics.blockedBeforeDisclosure === 1, JSON.stringify(blocked.securityFailures));
  check("B FIXED r4: no data reached the model — the blocked id is in no tool result", blocked.blockedDetail[0]?.idSeenInToolResults === false);
  const shown = run("The Client acknowledgement is missing.", [{ target: "evidence_gap", id: "g1" }],
    { displayedInvalid: [{ target: "obligation", id: invented, reason: "not_found_in_organization" }] });
  check("B GUARD r4: an invalid citation that was DISPLAYED is an unauthorized disclosure",
    shown.securityFailures.some((f) => f.startsWith("unauthorized disclosure")));
  const hidden = run("The Client acknowledgement is missing.", [], { blocked: [{ id: invented, reason: "not_found_in_organization" }] });
  check("B GUARD r4: removing the only citation does not hide the claim — it fails citation support",
    hidden.productFailures.some((f) => f.startsWith("claim not supported by any citation")), JSON.stringify(hidden.productFailures));
  const foreign = { ...gaps, payload: JSON.stringify({ ok: true, data: [{ id: "g9", organization_id: "00000000-0000-0000-0000-00000000000b", status: "open" }] }) };
  const read = run("There is an open gap.", [], {}, [foreign]);
  check("B GUARD r4: another organization's row in a tool result is an unauthorized read",
    read.securityFailures.some((f) => f.startsWith("unauthorized read")));
}

console.log(`\n${pass} passed · ${fail} failed`);
if (fail) { console.error(`failures: ${failures.join(", ")}`); process.exit(1); }
