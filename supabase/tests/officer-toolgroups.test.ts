// Phase 4A CP3 — tool-schema selection: correctness first, then cost.
// Measures the schema payload before/after grouping and proves selection can
// never hide a tool the question needs.
// Run: node --require ./supabase/tests/harness-cjs-preload.cjs --import tsx supabase/tests/officer-toolgroups.test.ts

import { z } from "zod";

import { listOfficerTools, selectToolGroups, TOOL_GROUPS } from "../../src/lib/officer/tools";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} — ${detail}`); }
}

/** Approximate the JSON schema payload the provider receives. */
function schemaChars(tools: readonly { name: string; description: string; input: z.ZodTypeAny }[]): number {
  return tools.reduce((n, t) => n + t.name.length + t.description.length + 120, 0);
}
/** ~4 chars per token is the usual rule of thumb for English JSON. */
const asTokens = (chars: number) => Math.round(chars / 4);

const ALL = listOfficerTools();
const baselineChars = schemaChars(ALL);

console.log(`baseline: ${ALL.length} tools · ~${asTokens(baselineChars)} schema tokens per round\n`);

// ---- every tool belongs to exactly one group ------------------------------
{
  const grouped = Object.values(TOOL_GROUPS).flat();
  const names = ALL.map((t) => t.name);
  check("g1-all-tools-grouped",
    names.every((n) => grouped.includes(n)),
    names.filter((n) => !grouped.includes(n)).join(","));
  check("g2-no-duplicate-membership",
    new Set(grouped).size === grouped.length,
    `grouped=${grouped.length} unique=${new Set(grouped).size}`);
}

type Case = { q: string; scoped?: boolean; expect: string[]; label: string };

const CASES: Case[] = [
  { label: "overdue", q: "What is overdue right now?", expect: ["getOverdueObligations"] },
  { label: "due this week", q: "What is due this week?", expect: ["getUpcomingObligations"] },
  { label: "evidence missing", q: "What evidence is missing for this obligation?", expect: ["getEvidenceStatus", "getEvidenceGaps"] },
  { label: "discrepancies", q: "Are there pending verification discrepancies?", expect: ["getVerificationDiscrepancies"] },
  { label: "source clause", q: "Show me the source clause for obligation 14.2", expect: ["getContractClause", "getObligation"] },
  { label: "who owns", q: "Who is responsible for this obligation?", expect: ["getAssignments", "getOrganizationMembers"] },
  { label: "what changed", q: "What changed since yesterday?", expect: ["getRecentActivity"] },
  { label: "propose", q: "Propose a follow-up to obtain the missing acknowledgement", expect: ["requestHumanApproval", "createInternalAction"] },
  { label: "arabic overdue", q: "إيش المتأخر عندي؟", expect: ["getOverdueObligations"] },
  { label: "arabic evidence", q: "إيش الدليل الناقص؟", expect: ["getEvidenceStatus", "getEvidenceGaps"] },
  { label: "arabic owner", q: "مين المسؤول عن هذا الالتزام؟", expect: ["getAssignments"] },
  { label: "arabic changed", q: "إيش تغيّر منذ أمس؟", expect: ["getRecentActivity"] },
];

let savedTotal = 0;
for (const c of CASES) {
  const sel = selectToolGroups({ question: c.q, contractScoped: !!c.scoped });
  const names = sel.tools.map((t) => t.name);
  const missing = c.expect.filter((e) => !names.includes(e));
  const chars = schemaChars(sel.tools);
  savedTotal += baselineChars - chars;
  check(`sel-${c.label}`, missing.length === 0,
    `missing=[${missing.join(",")}] got=[${sel.groups.join(",")}]`);
  console.log(`        ${sel.tools.length}/${ALL.length} tools · ~${asTokens(chars)} tokens (−${Math.round((1 - chars / baselineChars) * 100)}%)${sel.fullFallback ? " [full fallback]" : ""}`);
}

// ---- orientation is always available -------------------------------------
{
  const sel = selectToolGroups({ question: "What is overdue?", contractScoped: false });
  check("o1-orientation-always",
    sel.tools.some((t) => t.name === "listContracts") && sel.tools.some((t) => t.name === "getOrganizationSummary"));
}

// ---- contract and evidence travel together ------------------------------
{
  const a = selectToolGroups({ question: "What is due this week?", contractScoped: false });
  check("p1-contract-implies-evidence",
    a.tools.some((t) => t.name === "getEvidenceStatus"),
    a.groups.join(","));
  const b = selectToolGroups({ question: "Is the evidence verified?", contractScoped: false });
  check("p2-evidence-implies-contract",
    b.tools.some((t) => t.name === "listObligations"),
    b.groups.join(","));
}

// ---- an unclassifiable question gets EVERYTHING -------------------------
{
  const sel = selectToolGroups({ question: "hmm", contractScoped: false });
  check("f1-unknown-question-full-fallback",
    sel.fullFallback && sel.tools.length === ALL.length,
    `${sel.tools.length}/${ALL.length} fallback=${sel.fullFallback}`);
  const sel2 = selectToolGroups({ question: "", contractScoped: false });
  check("f2-empty-question-full-fallback", sel2.tools.length === ALL.length);
}

// ---- Phase 4A.2: resolve/chase intents reach the proposal tools --------
{
  const has = (q: string, tool: string) => selectToolGroups({ question: q, contractScoped: false }).tools.some((t) => t.name === tool);
  check("r1-resolve-gap-reaches-human-review", has("Mark the missing acknowledgement on GAMMA-300 as resolved.", "requestHumanApproval"));
  check("r2-close-gap-reaches-human-review", has("Please close the evidence gap on BETA-200.", "requestHumanApproval"));
  check("r3-arabic-close-reaches-human-review", has("أغلق فجوة الدليل على BETA-200", "requestHumanApproval"));
  check("r4-chase-reaches-internal-action", has("Create an internal follow-up to chase the missing client acknowledgement.", "createInternalAction"));
  check("r5-read-question-stays-narrow", !has("Which obligations are overdue?", "requestHumanApproval"));
  const names = listOfficerTools().map((t) => t.name).join(",");
  check("r6-no-closing-tool-exists", !/close|resolve|dismiss|approve|execute|override/i.test(names), names);
}

// ---- selection never invents a tool -------------------------------------
{
  const all = new Set(ALL.map((t) => t.name));
  const sel = selectToolGroups({ question: "what is overdue and who owns it?", contractScoped: false });
  check("s1-no-phantom-tools", sel.tools.every((t) => all.has(t.name)));
}

const avgSaving = Math.round((savedTotal / CASES.length / baselineChars) * 100);
console.log(`\naverage schema reduction across ${CASES.length} classified questions: ${avgSaving}%`);
console.log(`officer-toolgroups tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
