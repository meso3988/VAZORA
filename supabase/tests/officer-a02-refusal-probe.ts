/* eslint-disable @typescript-eslint/no-explicit-any */
// A02 refusal-surface probe — NO model calls (DB only).
// Seeds one synthetic tenant, proves the server-side authority rules that
// refuse a proposal: foreign contract id, non-member context, unknown
// action type; and records the by-design behavior that a member may draft
// a proposal while EXECUTION remains gated by authorizeAction.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-a02-refusal-probe.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

import {
  seedBenchmarkOrganization, teardownBenchmarkOrganization, verifyBenchmarkCleanup,
} from "../benchmarks/contract-officer-benchmark-v3/fixture";
import { buildOfficerContext, ensureOfficerProfile } from "../../src/lib/officer/context";
import { runOfficerTool } from "../../src/lib/officer/tools";
import { authorizeAction } from "../../src/lib/officer/authority";

async function main() {
  const fx = await seedBenchmarkOrganization({ label: "a02rf" });
  try {
    await ensureOfficerProfile({ supabase: fx.client, organizationId: fx.orgId });
    const owner = await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.userId, locale: "en" });
    const member = fx.secondUserId
      ? await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: fx.secondUserId, locale: "en" })
      : null;
    const b = fx.contracts.b;
    const ok = (n: string, p: boolean, d = "") => console.log(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);

    // member's role resolved correctly
    ok("member ctx resolves role=member", member?.role === "member", member?.role ?? "null");

    // member CAN draft a proposal (design: execution is re-checked at approval)
    const draft = await runOfficerTool(member!, "requestHumanApproval", {
      actionType: "officer.escalate", summary: "deadline change needs review", reason: "probe", contractId: b.contractId,
    });
    ok("member proposal draft allowed by design (execution stays gated)", draft.ok === true, (draft as any).error ?? "");

    // but member can never EXECUTE it — the server-side authority gate
    const auth = authorizeAction("member", "officer.escalate");
    ok("member lacks execute capability for escalate", !auth.allowed && auth.reason === "missing_capability", JSON.stringify(auth));
    const authResched = authorizeAction("member", "obligation.change_due_date");
    ok("member lacks obligation.reschedule (deadline mutation gate)", !authResched.allowed, JSON.stringify(authResched));

    // foreign contract id → refused before any query
    const foreign = await runOfficerTool(owner!, "requestHumanApproval", {
      actionType: "officer.escalate", summary: "probe", reason: "foreign contract", contractId: crypto.randomUUID(),
    });
    ok("foreign contract refused", foreign.ok === false && /not_found|not found|scope/i.test((foreign as any).error ?? ""), (foreign as any).error ?? "");

    // member on a foreign contract → refused (unauthorized context)
    const mForeign = await runOfficerTool(member!, "requestHumanApproval", {
      actionType: "officer.escalate", summary: "probe", reason: "foreign contract", contractId: crypto.randomUUID(),
    });
    ok("member + foreign contract refused", mForeign.ok === false, (mForeign as any).error ?? "");

    // non-member → no officer context at all (conversation refused upstream)
    const stranger = await buildOfficerContext({ supabase: fx.client, organizationId: fx.orgId, userId: crypto.randomUUID(), locale: "en" });
    ok("non-member gets no officer context", stranger === null);

    // member proposing a channel that ships nothing in 4A
    const ch = await runOfficerTool(member!, "requestHumanApproval", {
      actionType: "external.send_message" as any, summary: "probe", reason: "channel probe", contractId: b.contractId,
    });
    ok("external channel / unknown enum refused", ch.ok === false, (ch as any).error ?? "");
  } finally {
    const td = await teardownBenchmarkOrganization(fx);
    const vf = await verifyBenchmarkCleanup(fx);
    console.log(`CLEANUP ${td.ok && vf.clean ? "ok" : "FAIL"} leftovers=${vf.leftovers.join(",") || "none"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
