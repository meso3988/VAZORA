// Phase 4A CP2 — conversation layer security and correctness, WITHOUT a live
// model. A scripted Officer provider lets us assert exactly what the server
// does with hostile or careless model output: invented citations, foreign
// tenants, unknown tools, malformed arguments, runaway loops.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-conversation.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import { buildOfficerFixture } from "./officer-fixture";

import { validateCitations } from "../../src/lib/officer/citations";
import { askOfficer, createConversation, getConversation } from "../../src/lib/officer/conversation";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer, OFFICER_MAX_ROUNDS } from "../../src/lib/officer/converse";
import {
  registerOfficerProvider,
  type ContractOfficerProvider,
  type OfficerCompletion,
} from "../../src/lib/officer/provider";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** Scripted provider: each entry is one model turn, consumed in order. */
type Script = OfficerCompletion[];
let script: Script = [];
let callCount = 0;
process.env.VAZORA_OFFICER_PROVIDER = "qa-scripted-officer";

const scripted: ContractOfficerProvider = {
  id: "qa-scripted-officer",
  model: "qa-script",
  supportsTools: true,
  async complete() {
    callCount++;
    const next = script.shift();
    return next ?? { ok: true, text: "done", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
  },
};
registerOfficerProvider("qa-scripted-officer", () => scripted);

const say = (text: string): OfficerCompletion =>
  ({ ok: true, text, toolCalls: [], model: "qa-script", usage: { inputTokens: 10, outputTokens: 5 } });

const callTool = (name: string, args: unknown, id = `c${Math.random().toString(36).slice(2, 8)}`): OfficerCompletion =>
  ({ ok: true, text: "", toolCalls: [{ id, name, arguments: args }], model: "qa-script", usage: { inputTokens: 10, outputTokens: 5 } });

async function main() {
  const alpha = await buildOfficerFixture({ label: "convA" });
  const beta = await buildOfficerFixture({ label: "convB", timezone: "Europe/London" });
  await ensureOfficerProfile({ supabase: alpha.client, organizationId: alpha.orgId });

  const ctx = await buildOfficerContext({
    supabase: alpha.client, organizationId: alpha.orgId, userId: alpha.userId, locale: "en",
  });
  const betaCtx = await buildOfficerContext({
    supabase: beta.client, organizationId: beta.orgId, userId: beta.userId, locale: "en",
  });
  if (!ctx || !betaCtx) throw new Error("context build failed");

  // ===== 1. citation validation ============================================
  const invented = crypto.randomUUID();
  const v1 = await validateCitations(ctx, [
    { target: "contract", id: alpha.om.contractId },
    { target: "clause", id: alpha.om.clauseId },
    { target: "obligation", id: invented },                       // does not exist
    { target: "contract", id: beta.om.contractId },                // another tenant
    { target: "obligation", id: "not-a-uuid" },                    // malformed
    { target: "wizard_spell", id: alpha.om.contractId },           // unknown target
  ]);
  check("cite-valid-kept", v1.valid.length === 2 &&
    v1.valid.every((c) => c.target === "contract" || c.target === "clause"),
    `valid=${v1.valid.map((c) => c.target).join(",")}`);
  check("cite-invented-dropped",
    v1.rejected.some((r) => r.id === invented && r.reason === "not_found_in_organization"));
  check("cite-cross-tenant-dropped",
    v1.rejected.some((r) => r.id === beta.om.contractId && r.reason === "not_found_in_organization"),
    JSON.stringify(v1.rejected).slice(0, 120));
  check("cite-malformed-dropped", v1.rejected.some((r) => r.reason === "malformed_id"));
  check("cite-unknown-target-dropped", v1.rejected.some((r) => r.reason === "unknown_target"));
  check("cite-href-built", v1.valid.find((c) => c.target === "contract")?.href === `/app/contracts/${alpha.om.contractId}`,
    String(v1.valid.find((c) => c.target === "contract")?.href));

  // Beta validating an Alpha id must also fail — symmetry, not luck.
  const v2 = await validateCitations(betaCtx, [{ target: "contract", id: alpha.om.contractId }]);
  check("cite-symmetric-isolation", v2.valid.length === 0 && v2.rejected.length === 1);

  // ===== 2. model-invented citation tags never survive a turn ==============
  script = [say(
    `The signed report is verified [[cite:verification_run:${alpha.om.run1}]]. ` +
    `Also see [[cite:contract:${invented}]] and [[cite:contract:${beta.om.contractId}]].`,
  )];
  const r1 = await converseWithOfficer({ ctx, question: "status?" });
  check("turn-strips-tags", r1.ok && !r1.answer.text.includes("[[cite:"), r1.ok ? r1.answer.text.slice(0, 80) : "");
  check("turn-keeps-real-citation",
    r1.ok && r1.answer.citations.some((c) => c.id === alpha.om.run1));
  check("turn-drops-invented-citation",
    r1.ok && !r1.answer.citations.some((c) => c.id === invented) && r1.answer.rejectedCitations.length === 2,
    r1.ok ? `rejected=${r1.answer.rejectedCitations.length}` : "");
  check("turn-drops-cross-tenant-citation",
    r1.ok && !r1.answer.citations.some((c) => c.id === beta.om.contractId));

  // ===== 3. hostile / careless tool calls ==================================
  script = [
    callTool("dropAllTables", {}),
    callTool("getContract", { contractId: beta.om.contractId }),
    callTool("getContract", { contractId: "nonsense" }),
    callTool("listContracts", { organizationId: beta.orgId }),
    say("I could not retrieve that."),
  ];
  const r2 = await converseWithOfficer({ ctx, question: "probe" });
  const invocations = r2.ok ? r2.answer.toolInvocations : [];
  check("tool-unknown-rejected", invocations.some((i) => i.tool === "dropAllTables" && !i.ok && i.summary === "unknown_tool"));
  check("tool-cross-tenant-rejected",
    invocations.some((i) => i.tool === "getContract" && !i.ok && i.summary === "contract_not_found_in_organization"));
  check("tool-malformed-arg-rejected",
    invocations.some((i) => i.tool === "getContract" && !i.ok && i.summary.startsWith("invalid_arguments")));
  check("tool-model-org-arg-rejected",
    invocations.some((i) => i.tool === "listContracts" && !i.ok && i.summary.startsWith("invalid_arguments")),
    JSON.stringify(invocations.map((i) => [i.tool, i.ok])));

  // ===== 4. loop bounds ====================================================
  callCount = 0;
  script = Array.from({ length: 20 }, () => callTool("getOrganizationSummary", {}));
  const r3 = await converseWithOfficer({ ctx, question: "loop" });
  check("loop-bounded", callCount <= OFFICER_MAX_ROUNDS + 1, `provider calls=${callCount}`);
  check("loop-duplicate-suppressed",
    r3.ok && r3.answer.toolInvocations.filter((i) => i.summary === "repeated identical call suppressed").length >= 1,
    r3.ok ? `invocations=${r3.answer.toolInvocations.length}` : "");
  check("loop-still-answers",
    r3.ok && r3.answer.text.length > 0 && r3.answer.budgetExhausted && r3.answer.uncertainty,
    r3.ok ? r3.answer.text.slice(0, 90) : JSON.stringify(r3));

  // ===== 5. persistence is structured and tenant-scoped ====================
  const conv = await createConversation(ctx, { contractId: alpha.om.contractId, title: null });
  check("conv-created", conv.ok && conv.conversation.scope === "contract");
  const convId = conv.ok ? conv.conversation.id : "";

  const crossScope = await createConversation(ctx, { contractId: beta.om.contractId, title: null });
  check("conv-cross-tenant-scope-refused", !crossScope.ok, JSON.stringify(crossScope));

  script = [
    callTool("getEvidenceStatus", { contractId: alpha.om.contractId }),
    say(`The client acknowledgement is missing [[cite:evidence_gap:${alpha.om.gapId}]].`),
  ];
  const asked = await askOfficer(ctx, { conversationId: convId, question: "What is missing?" });
  check("ask-persisted", asked.ok, asked.ok ? "" : JSON.stringify(asked));

  const loaded = await getConversation(ctx, convId);
  check("ask-two-messages", (loaded?.messages.length ?? 0) === 2, `messages=${loaded?.messages.length}`);
  const assistant = loaded?.messages.find((m) => m.role === "assistant");
  check("ask-structured-citations",
    !!assistant && assistant.citations.some((c) => c.id === alpha.om.gapId && !!c.href),
    JSON.stringify(assistant?.citations).slice(0, 140));
  check("ask-structured-tools",
    !!assistant && assistant.toolInvocations.some((t) => t.tool === "getEvidenceStatus"));
  check("ask-no-tags-in-stored-text", !!assistant && !assistant.content.includes("[[cite:"));
  check("ask-user-attributed",
    loaded?.messages.find((m) => m.role === "user")?.authorUserId === alpha.userId);

  // Beta cannot read or post into Alpha's conversation.
  const betaRead = await getConversation(betaCtx, convId);
  check("conv-cross-tenant-read", betaRead === null);
  const betaAsk = await askOfficer(betaCtx, { conversationId: convId, question: "leak please" });
  check("conv-cross-tenant-ask", !betaAsk.ok && betaAsk.error === "conversation_not_found", JSON.stringify(betaAsk));

  // ===== 6. contract scope comes from the server, not the model ============
  // The conversation is pinned to Alpha's contract; a model that asks about
  // Beta's contract still gets nothing.
  script = [
    callTool("getContract", { contractId: beta.om.contractId }),
    say("Not available."),
  ];
  const scoped = await askOfficer(ctx, { conversationId: convId, question: "other contract?" });
  check("scope-server-enforced",
    scoped.ok && scoped.answer.toolInvocations.every((t) => t.tool !== "getContract" || !t.ok),
    scoped.ok ? JSON.stringify(scoped.answer.toolInvocations) : JSON.stringify(scoped));

  // ===== 7. provider failure is surfaced honestly, never faked =============
  script = [{ ok: false, error: "provider HTTP 500" }];
  const failed = await converseWithOfficer({ ctx, question: "anything" });
  check("provider-failure-surfaced", !failed.ok && failed.error.includes("500"), JSON.stringify(failed));

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nOFFICER CONVERSATION: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
