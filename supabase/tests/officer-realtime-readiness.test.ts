// Phase 4A CP4 — Phase 4B backend readiness.
// The Officer backend must be reusable by a realtime client. These are static
// guarantees: no React, no request object, no cookies, no UI coupling in the
// grounding/authority path, and no model access to data or tenancy.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-realtime-readiness.test.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

import { PHASE_4B_READINESS, speakableCitations, speechCueFor } from "../../src/lib/officer/realtime-contract";
import { listOfficerTools, TOOL_GROUPS } from "../../src/lib/officer/tools";
import { ACTION_CLASS, ROLE_CAPABILITIES } from "../../src/lib/officer/authority";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} — ${detail}`); }
}

const read = (p: string) => readFileSync(join(root, p), "utf8");

// ---- the grounding path must not touch the text UI -------------------------
const CORE = [
  "src/lib/officer/converse.ts",
  "src/lib/officer/conversation.ts",
  "src/lib/officer/tools.ts",
  "src/lib/officer/citations.ts",
  "src/lib/officer/actions.ts",
  "src/lib/officer/memory.ts",
  "src/lib/officer/brief.ts",
  "src/lib/officer/sweep.ts",
  "src/lib/officer/observations.ts",
  "src/lib/officer/context.ts",
  "src/lib/officer/detectors.ts",
  "src/lib/officer/prompt.ts",
  "src/lib/officer/transport.ts",
  "src/lib/officer/provider.ts",
];
for (const file of CORE) {
  const src = read(file);
  check(`ui-free-${file.split("/").pop()}`,
    !/from "react"|from "next\/navigation"|next-intl|next\/headers|\.tsx"|"use client"/.test(src),
    "core officer logic must not import React, next-intl, navigation or components");
}

// ---- the realtime contract compiles against real runtime types -------------
{
  const answer = {
    text: "BETA-200 is overdue.", citations: [], toolInvocations: [],
    proposedActionIds: [], uncertainty: false, budgetExhausted: false,
    provider: "p", model: "m", usage: { inputTokens: 1, outputTokens: 1 }, durationMs: 10,
  };
  check("cue-neutral", speechCueFor(answer, []) === "neutral");
  check("cue-uncertainty", speechCueFor({ ...answer, uncertainty: true }, []) === "uncertainty");
  check("cue-budget-exhausted-is-uncertain",
    speechCueFor({ ...answer, budgetExhausted: true }, []) === "uncertainty");
  check("cue-approval-request",
    speechCueFor({ ...answer, proposedActionIds: ["a"] }, []) === "approval_request");
  check("cue-critical",
    speechCueFor(answer, [{ severity: "critical", status: "active" } as never]) === "critical");
  check("cue-resolved-critical-ignored",
    speechCueFor(answer, [{ severity: "critical", status: "resolved" } as never]) === "neutral");
  check("speakable-citations-require-identity",
    speakableCitations([
      { target: "contract", id: "x", label: "ALPHA-100" },
      { target: "contract", id: "y", label: "" },
    ] as never).length === 1);
}

// ---- readiness invariants are asserted, not asserted-by-comment ------------
check("readiness-flags-all-true", Object.values(PHASE_4B_READINESS).every(Boolean),
  JSON.stringify(PHASE_4B_READINESS));

// ---- the model still has no data or tenancy access ------------------------
{
  const toolsSrc = read("src/lib/officer/tools.ts");
  check("tools-accept-no-organization-id",
    !/organizationId:\s*z\./.test(toolsSrc),
    "no tool schema may accept an organization id");
  check("tools-schemas-are-strict",
    (toolsSrc.match(/\.strict\(\)/g) ?? []).length >= 10,
    "every object schema must reject unexpected keys");
  const converseSrc = read("src/lib/officer/converse.ts");
  check("converse-has-round-cap", /MAX_ROUNDS\s*=\s*\d+/.test(converseSrc));
  check("converse-has-call-cap", /MAX_TOOL_CALLS\s*=\s*\d+/.test(converseSrc));
  check("converse-validates-citations", converseSrc.includes("validateCitations"));
  const providerSrc = read("src/lib/officer/provider.ts");
  check("provider-has-no-db-handle", !/supabase/i.test(providerSrc));
}

// ---- external communication stays unreachable -----------------------------
check("external-action-declared-but-ungranted",
  ACTION_CLASS["external.send_message"] === "APPROVAL_REQUIRED" &&
  Object.values(ROLE_CAPABILITIES).every((caps) => !caps.includes("external.communicate")),
  "no role may hold external.communicate in Phase 4A");

// ---- every tool is reachable by a realtime client -------------------------
{
  const grouped = new Set(Object.values(TOOL_GROUPS).flat());
  const names = listOfficerTools().map((t) => t.name);
  check("all-tools-grouped-for-selection", names.every((n) => grouped.has(n)),
    names.filter((n) => !grouped.has(n)).join(","));
  check("tool-count-stable", names.length === 17, `${names.length} tools`);
}

// ---- the sweep endpoint is the documented headless entry point ------------
{
  const routeSrc = read("src/app/api/officer/sweep/route.ts");
  check("headless-sweep-exists", routeSrc.includes("export async function POST"));
  check("headless-sweep-needs-no-browser",
    !routeSrc.includes("cookies()") && routeSrc.includes("x-vazora-sweep-secret"));
}

console.log(`\nofficer-realtime-readiness: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
