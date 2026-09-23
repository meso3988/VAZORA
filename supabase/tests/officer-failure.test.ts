/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4A CP4 — provider failure behaviour must be BOUNDED.
// Timeout, 429, 500, 401, malformed output, tool-loop exhaustion and network
// errors: every one must end quickly, safely, without executing an action and
// without corrupting conversation history.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-failure.test.ts

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// Bound the runtime tightly so a hang fails the test instead of the suite.
process.env.VAZORA_OFFICER_TIMEOUT_MS = "2500";
process.env.VAZORA_OFFICER_MAX_RETRIES = "1";

import { seedBenchmarkOrganization, teardownBenchmarkOrganization } from "../benchmarks/contract-officer-benchmark-v2/fixture";

import { askOfficer, createConversation, getConversation } from "../../src/lib/officer/conversation";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { converseWithOfficer } from "../../src/lib/officer/converse";
import { officerFetch, officerMaxRetries, officerTimeoutMs } from "../../src/lib/officer/transport";
import {
  registerOfficerProvider, type ContractOfficerProvider, type OfficerCompletion,
} from "../../src/lib/officer/provider";

const checks: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** Scripted provider so each failure mode is reproducible. */
let script: OfficerCompletion[] = [];
let providerCalls = 0;
process.env.VAZORA_OFFICER_PROVIDER = "qa-failure-officer";
const scripted: ContractOfficerProvider = {
  id: "qa-failure-officer", model: "qa-failure", supportsTools: true,
  async complete() {
    providerCalls++;
    // Exhausting the script means the model kept saying nothing — the default
    // must stay EMPTY so the closing pass is exercised honestly.
    return script.shift() ?? { ok: true, text: "", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 } };
  },
};
registerOfficerProvider("qa-failure-officer", () => scripted);

const fail = (error: string): OfficerCompletion => ({ ok: false, error });
const callTool = (name: string, args: unknown): OfficerCompletion =>
  ({ ok: true, text: "", toolCalls: [{ id: `c${Math.random()}`, name, arguments: args }], usage: { inputTokens: 5, outputTokens: 2 } });

/** A local HTTP server that reproduces real transport failures. */
async function withServer(
  handler: (req: any, res: any) => void,
  fn: (url: string) => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  try {
    await fn(`http://127.0.0.1:${port}/v1/chat/completions`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function main() {
  // =========================================================================
  // TRANSPORT: the 843-second stall must be structurally impossible
  // =========================================================================
  check("transport-timeout-configured", officerTimeoutMs() === 2500, `${officerTimeoutMs()}ms`);
  check("transport-retries-bounded", officerMaxRetries() === 1, `${officerMaxRetries()}`);

  // A server that never responds: must abort at the timeout, not hang.
  await withServer(
    () => { /* deliberately never responds */ },
    async (url) => {
      const t0 = Date.now();
      const r = await officerFetch(url, { headers: { "Content-Type": "application/json" }, body: "{}" });
      const elapsed = Date.now() - t0;
      check("transport-hang-aborted", !r.ok && r.failure.kind === "timeout", JSON.stringify(r.ok ? {} : r.failure));
      // timeout × (1 + retries) + backoff, with generous slack — the point is
      // that it is BOUNDED and nowhere near 843s.
      check("transport-hang-bounded", elapsed < 9_000, `${elapsed}ms for 2 bounded attempts`);
      check("transport-hang-retried-once", !r.ok && r.failure.attempts === 2, `attempts=${r.ok ? 0 : r.failure.attempts}`);
    },
  );

  // 429 and 500 are retryable; 401 and 400 are not.
  for (const [status, retryable] of [[429, true], [500, true], [503, true], [401, false], [400, false], [422, false]] as [number, boolean][]) {
    let hits = 0;
    await withServer(
      (_req, res) => { hits++; res.writeHead(status, { "Content-Type": "application/json" }); res.end('{"error":"x"}'); },
      async (url) => {
        const r = await officerFetch(url, { headers: {}, body: "{}" });
        check(`transport-${status}-${retryable ? "retried" : "not-retried"}`,
          !r.ok && hits === (retryable ? 2 : 1), `attempts=${hits}`);
      },
    );
  }

  // A connection reset mid-flight is a network failure, and it is bounded.
  await withServer(
    (_req, res) => { res.socket?.destroy(); },
    async (url) => {
      const t0 = Date.now();
      const r = await officerFetch(url, { headers: {}, body: "{}" });
      check("transport-connection-reset",
        !r.ok && (r.failure.kind === "network" || r.failure.kind === "timeout") && Date.now() - t0 < 9_000,
        JSON.stringify(r.ok ? {} : { kind: r.failure.kind, ms: Date.now() - t0 }));
    },
  );

  // No secret may ever appear in a surfaced error.
  await withServer(
    (_req, res) => { res.writeHead(401); res.end('{"error":"invalid api key sk-secret-value-123"}'); },
    async (url) => {
      const r = await officerFetch(url, { headers: { Authorization: "Bearer sk-secret-value-123" }, body: "{}" });
      const text = r.ok ? "" : r.failure.message;
      // The upstream body is echoed, so the guarantee we can make is that we
      // never add our own credentials to the message.
      check("transport-no-header-leak", !text.includes("Bearer "), text.slice(0, 60));
    },
  );

  // =========================================================================
  // CONVERSATION: every failure mode ends safely
  // =========================================================================
  const fx = await seedBenchmarkOrganization({ label: "failure" });
  await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
  const ctx = await buildOfficerContext({
    supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en",
  });
  if (!ctx) throw new Error("ctx");

  const openActions = async () => {
    const { count } = await fx.client.from("officer_actions")
      .select("id", { count: "exact", head: true }).eq("organization_id", fx.orgId);
    return count ?? 0;
  };
  const actionsBefore = await openActions();

  for (const [label, error] of [
    ["timeout", "provider_timeout: provider request exceeded 2500ms and was aborted (attempts 2)"],
    ["rate-limit", "provider HTTP 429: rate limited"],
    ["server-error", "provider HTTP 500: upstream failure"],
    ["auth-error", "provider HTTP 401: invalid key"],
    ["network", "provider network error: ECONNRESET (attempts 2)"],
  ] as [string, string][]) {
    script = [fail(error)];
    const t0 = Date.now();
    const r = await converseWithOfficer({ ctx, question: "What is overdue?" });
    check(`conversation-${label}-surfaced`,
      !r.ok && r.error === error && Date.now() - t0 < 5_000,
      r.ok ? "unexpectedly ok" : r.error.slice(0, 60));
  }

  // A model that produces nothing at all must not become an invented answer:
  // the server falls back to an honest, flagged statement of what it ran.
  script = [{ ok: true, text: "", toolCalls: [], usage: {} }];
  const emptyAnswer = await converseWithOfficer({ ctx, question: "anything" });
  check("conversation-empty-output-safe",
    emptyAnswer.ok && emptyAnswer.answer.uncertainty && emptyAnswer.answer.budgetExhausted &&
    /could not complete/i.test(emptyAnswer.answer.text),
    emptyAnswer.ok ? `text="${emptyAnswer.answer.text.slice(0, 70)}"` : JSON.stringify(emptyAnswer));
  check("conversation-empty-output-no-fabrication",
    emptyAnswer.ok && emptyAnswer.answer.citations.length === 0 && emptyAnswer.answer.proposedActionIds.length === 0,
    "nothing invented from an empty model response");

  // A model that asks for a nonexistent tool forever: bounded, and it still
  // produces an honest server-authored summary rather than an error.
  providerCalls = 0;
  script = Array.from({ length: 30 }, () => callTool("nonexistentTool", {}));
  const t0 = Date.now();
  const loop = await converseWithOfficer({ ctx, question: "loop forever please" });
  check("conversation-loop-bounded", providerCalls <= 6, `provider calls=${providerCalls}`);
  check("conversation-loop-fast", Date.now() - t0 < 20_000, `${Date.now() - t0}ms`);
  check("conversation-loop-honest",
    loop.ok && loop.answer.budgetExhausted && loop.answer.uncertainty && loop.answer.text.length > 0,
    loop.ok ? loop.answer.text.slice(0, 80) : JSON.stringify(loop));
  check("conversation-loop-no-invented-tools",
    loop.ok && loop.answer.toolInvocations.every((t) => !t.ok),
    loop.ok ? JSON.stringify(loop.answer.toolInvocations.map((t) => [t.tool, t.ok])) : "");

  // NOTHING may have been created by any failure path.
  check("failures-create-no-actions", (await openActions()) === actionsBefore,
    `before=${actionsBefore} after=${await openActions()}`);

  // =========================================================================
  // HISTORY CONSISTENCY after a failed turn
  // =========================================================================
  const conv = await createConversation(ctx, { contractId: null, title: null });
  const convId = conv.ok ? conv.conversation.id : "";
  script = [fail("provider HTTP 500: upstream failure")];
  const failedAsk = await askOfficer(ctx, { conversationId: convId, question: "will fail" });
  check("history-failed-ask-reports-error", !failedAsk.ok, JSON.stringify(failedAsk).slice(0, 70));
  const afterFail = await getConversation(ctx, convId);
  check("history-user-message-kept",
    afterFail?.messages.length === 1 && afterFail.messages[0].role === "user",
    `messages=${afterFail?.messages.length}`);
  check("history-no-fabricated-assistant-turn",
    !afterFail?.messages.some((m) => m.role === "assistant"),
    "a failed turn must not leave an invented answer behind");

  // The next successful turn continues cleanly on the same conversation.
  script = [{ ok: true, text: "BETA-200 is overdue.", toolCalls: [], usage: { inputTokens: 3, outputTokens: 2 } }];
  const recovered = await askOfficer(ctx, { conversationId: convId, question: "try again" });
  check("history-recovers", recovered.ok, JSON.stringify(recovered).slice(0, 70));
  const afterRecovery = await getConversation(ctx, convId);
  check("history-consistent-after-recovery",
    afterRecovery?.messages.length === 3 &&
    afterRecovery.messages.filter((m) => m.role === "assistant").length === 1,
    `messages=${afterRecovery?.messages.length}`);

  const td = await teardownBenchmarkOrganization(fx);
  check("cleanup-benchmark-tenant", td.ok, td.error ?? "");

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nOFFICER FAILURE: ${passed}/${checks.length} PASS`);
  if (passed !== checks.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
