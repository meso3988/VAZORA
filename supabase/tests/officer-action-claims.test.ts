/* eslint-disable @typescript-eslint/no-explicit-any */
// Authoritative action confirmations through the REAL conversation path
// (converseWithOfficer → tools → officer_actions → receipts), with a SCRIPTED
// provider replaying outputs recorded in the Phase 4A gate. No paid calls.
//
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-action-claims.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", "..", ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
process.env.VAZORA_OFFICER_PROVIDER = "qa-scripted-claims";

import {
  seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { approveOfficerAction } from "../../src/lib/officer/actions";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer } from "../../src/lib/officer/converse";
import { registerOfficerProvider, type ContractOfficerProvider, type OfficerCompletion } from "../../src/lib/officer/provider";
import { buildActionReceipts } from "../../src/lib/officer/receipts";

const checks: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

let script: OfficerCompletion[] = [];
let calls = 0;
const scripted: ContractOfficerProvider = {
  id: "qa-scripted-claims", model: "qa-scripted", supportsTools: true,
  async complete() { calls++; return script.shift() ?? { ok: true, text: "", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } }; },
};
registerOfficerProvider("qa-scripted-claims", () => scripted);
const tool = (name: string, args: unknown): OfficerCompletion =>
  ({ ok: true, text: "", toolCalls: [{ id: `c${Math.random()}`, name, arguments: args }], usage: { inputTokens: 1, outputTokens: 1 } });
const say = (text: string): OfficerCompletion => ({ ok: true, text, toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } });

async function main() {
  const fx = await seedBenchmarkOrganization({ label: "claims" });
  try {
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const ctx = (locale: "en" | "ar") => buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale }).then((c) => c!);
    const EN = await ctx("en");
    const AR = await ctx("ar");
    const b = fx.contracts.b;
    const turn = async (c: any, question: string, s: OfficerCompletion[]) => {
      script = s;
      const r = await converseWithOfficer({ ctx: c, question });
      if (!r.ok) throw new Error(r.error);
      return r.answer;
    };
    const Q_A05 = "Create an internal follow-up to chase the missing signed service-level report on BETA-200.";

    // ---- [GATE A05] turn 1: new proposal ---------------------------------------------
    const t1 = await turn(EN, Q_A05, [
      tool("createInternalAction", { actionType: "officer.internal_task", title: "Follow up on missing signed service-level report",
        reason: "BETA-200 has an open evidence gap.", contractId: b.contractId, obligationId: b.obligationId }),
      say("Created an internal follow-up task for the missing signed service-level report under BETA-200. The evidence gap remains open until the report is submitted and successfully verified."),
    ]);
    check("A05 t1: receipt = proposed (fresh)", t1.actionReceipts.length === 1 && t1.actionReceipts[0].outcome === "proposed" && !t1.actionReceipts[0].reused, JSON.stringify(t1.actionReceipts));
    check("A05 t1: the backed 'Created …' sentence is kept", t1.removedClaims.length === 0 && t1.text.includes("Created an internal follow-up task"));
    check("A05 t1: authoritative status leads the answer", t1.text.startsWith("Action status (from VAZORA records):"));

    // ---- [GATE A05 r3] turn 2: paraphrased repeat --------------------------------------
    const t2 = await turn(EN, Q_A05, [
      tool("createInternalAction", { actionType: "officer.internal_task", title: "Follow up on missing signed service-level report — BETA-200",
        reason: "Internal follow-up to obtain the signed service-level report.", contractId: b.contractId, obligationId: b.obligationId }),
      say("Created an internal follow-up for the missing signed service-level report under BETA-200. The related evidence gap remains open until verified evidence is recorded."),
    ]);
    check("A05 t2: same proposal id reused", t2.proposedActionIds[0] === t1.proposedActionIds[0] && t2.actionReceipts[0]?.reused === true);
    check("A05 t2: false 'Created …' removed (nothing new was created)", t2.removedClaims.length === 1 && !t2.text.includes("Created an internal follow-up"), JSON.stringify(t2.removedClaims));
    check("A05 t2: receipt says an open proposal already exists", /already exists; no new proposal was created/.test(t2.text));
    const { data: rows } = await fx.client.from("officer_actions").select("id").eq("organization_id", fx.orgId)
      .eq("action_type", "officer.internal_task").eq("obligation_id", b.obligationId);
    check("A05: one proposal row in the database", (rows ?? []).length === 1, `${rows?.length}`);

    // ---- [GATE A03] send request, no tool call, false completion prose ------------------
    const a03 = await turn(EN, "Send the ZETA-600 report to the client now.", [say("I've sent the ZETA-600 report to the client.")]);
    check("A03 (no tool): 'I've sent …' removed", a03.removedClaims.length === 1 && !/sent the ZETA-600/.test(a03.text), JSON.stringify(a03.removedClaims));
    check("A03 (no tool): receipt says no action was taken", /no action was taken in VAZORA/.test(a03.text));
    const a03ok = await turn(EN, "Send the ZETA-600 report to the client now.", [say("I can’t send external communications. I can only create an internal follow-up or propose an approval request, and no report has been sent.")]);
    check("[GATE A03 r1] recorded refusal passes through unchanged", a03ok.removedClaims.length === 0 && a03ok.text.includes("no report has been sent"));

    // ---- failed tool + claim ---------------------------------------------------------------
    const failT = await turn(EN, "Assign the EPSILON-500 obligation to Nadia.", [
      tool("proposeAssignment", { obligationId: fx.contracts.e.obligationId, assigneeUserId: crypto.randomUUID(), reason: "Nadia" }),
      say("I assigned Nadia as the owner of the EPSILON-500 obligation."),
    ]);
    check("failed tool: receipt = blocked with the tool's reason", failT.actionReceipts[0]?.outcome === "blocked" && /assignee_not_a_member/.test(failT.actionReceipts[0]?.reason ?? ""), JSON.stringify(failT.actionReceipts));
    check("failed tool: 'I assigned …' removed", failT.removedClaims.length === 1);
    check("failed tool: receipt says not done", /Not done: the owner assignment was blocked/.test(failT.text));

    // ---- pending approval + overclaim ---------------------------------------------------------
    const cc = fx.contracts.c;
    const pend = await turn(EN, "Mark the missing acknowledgement on GAMMA-300 as resolved.", [
      tool("requestHumanApproval", { actionType: "officer.escalate", summary: "Review the ack gap", reason: "User asked to resolve.", contractId: cc.contractId, obligationId: cc.obligationId }),
      say("I submitted a human-review escalation and resolved the gap. The gap remains open until an authorized review resolves it."),
    ]);
    check("pending approval: receipt = awaiting_approval", pend.actionReceipts[0]?.outcome === "awaiting_approval");
    check("pending approval: sentence claiming 'resolved the gap' removed", pend.removedClaims.length === 1 && /resolved the gap/.test(pend.removedClaims[0]));
    check("pending approval: conditional 'until … resolves it' kept", pend.text.includes("remains open until an authorized review resolves it"));
    const { data: gapNow } = await fx.client.from("evidence_gaps").select("status").eq("organization_id", fx.orgId).eq("contract_id", cc.contractId).limit(1).maybeSingle();
    check("pending approval: the gap is still open in the database (Phase 3 semantics intact)", gapNow?.status === "open", gapNow?.status);

    // ---- Arabic --------------------------------------------------------------------------------------
    const arT = await turn(AR, "أنشئ متابعة داخلية لتقرير ZETA-600 وأرسله إلى العميل", [
      tool("createInternalAction", { actionType: "officer.internal_task", title: "متابعة تقرير ZETA-600", reason: "تقرير ناقص",
        contractId: fx.contracts.f.contractId, obligationId: fx.contracts.f.obligationId }),
      say("أنشأت مهمة متابعة داخلية لتقرير ZETA-600. أرسلت التقرير إلى العميل."),
    ]);
    check("AR: legit 'أنشأت مهمة متابعة' kept (fresh proposal)", arT.text.includes("أنشأت مهمة متابعة داخلية"));
    check("AR: 'أرسلت التقرير إلى العميل' removed", arT.removedClaims.length === 1 && /أرسلت/.test(arT.removedClaims[0]), JSON.stringify(arT.removedClaims));
    check("AR: Arabic receipt rendered first", arT.text.startsWith("حالة الإجراء (من سجلات VAZORA):"));
    const arNone = await turn(AR, "أرسل التقرير إلى العميل الآن", [say("تم إرسال التقرير إلى العميل.")]);
    check("AR (no tool): 'تم إرسال …' removed and 'no action' receipt shown",
      arNone.removedClaims.length === 1 && /لم يُتخذ أي إجراء/.test(arNone.text), arNone.text);

    // ---- informational turn: history untouched ------------------------------------------------------
    const info = await turn(EN, "What changed since yesterday?", [say("ALPHA-100's obligation was assigned yesterday. A new evidence version was uploaded and recorded as awaiting verification.")]);
    check("informational turn: no receipt block, history text unchanged",
      info.actionReceipts.length === 0 && info.removedClaims.length === 0 && info.text.startsWith("ALPHA-100"));

    // ---- legitimate completed internal operation ---------------------------------------------------------
    const done = await approveOfficerAction(EN, t1.proposedActionIds[0]);
    check("internal task approved → completed", done.ok && done.data.status === "completed");
    const rec = await buildActionReceipts(EN, [{ tool: "createInternalAction", ok: true, actionId: t1.proposedActionIds[0] }]);
    check("receipt after completion: completed with exact operation", rec[0]?.outcome === "completed" && rec[0]?.operation === "officer.internal_task", JSON.stringify(rec));
    check("provider scripted — no network model calls", calls > 0);
  } finally {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} org=${fx.orgId} ${td.error ?? ""} leftovers=${vf.leftovers.join(",") || "none"}`);
  }
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nACTION CLAIMS: ${checks.length - failed.length}/${checks.length} pass`);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
