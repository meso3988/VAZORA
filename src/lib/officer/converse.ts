import "server-only";

import { z } from "zod";

import type { OfficerCitation, OfficerToolInvocation } from "@/domain/officer";
import { validateCitations, type RejectedCitation } from "@/lib/officer/citations";
import type { OfficerContext } from "@/lib/officer/context";
import { loadUsableMemory } from "@/lib/officer/memory";
import { buildOfficerSystemPrompt } from "@/lib/officer/prompt";
import {
  getOfficerProvider,
  type OfficerToolCall,
  type OfficerToolSpec,
  type OfficerTurn,
} from "@/lib/officer/provider";
import {
  listOfficerTools,
  runOfficerTool,
  selectToolGroups,
  type OfficerTool,
  type ToolGroup,
} from "@/lib/officer/tools";

// Side-effect: register officer provider adapters.
import "@/lib/officer/providers/anthropic";
import "@/lib/officer/providers/openai-compat";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Bounded server-side tool-calling loop.
 *
 * user question → model picks READ tools → server validates name+arguments
 * → authorized tool runs → result returns → (bounded repeat) → grounded answer.
 *
 * Hard limits exist so a confused or adversarial model cannot loop, re-ask
 * the same question forever, or run something that is not in the registry.
 */

const MAX_ROUNDS = 5;
const MAX_TOOL_CALLS = 12;
/** Names of every registered tool — used to detect a needed-but-unsent schema. */
const OFFICER_TOOL_NAMES = new Set(listOfficerTools().map((t) => t.name));
/** Tool payload handed back to the model — bounded so context stays small. */
const MAX_RESULT_CHARS = 6000;

/** Minimal JSON Schema for the provider, derived from the zod input shape. */
function toolSpecs(tools: readonly OfficerTool[] = listOfficerTools()): OfficerToolSpec[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodObjectToJsonSchema(t.input),
  }));
}

function zodObjectToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def: any = (schema as any)._def;
  const shape: Record<string, any> = typeof def?.shape === "function" ? def.shape() : (def?.shape ?? {});
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    let node: any = raw;
    let optional = false;
    while (node?._def?.typeName === "ZodOptional" || node?._def?.typeName === "ZodDefault") {
      optional = true;
      node = node._def.innerType;
    }
    const typeName = node?._def?.typeName;
    if (typeName === "ZodString") {
      properties[key] = node._def.checks?.some((c: any) => c.kind === "uuid")
        ? { type: "string", format: "uuid" }
        : { type: "string" };
    } else if (typeName === "ZodNumber") {
      properties[key] = { type: "integer" };
    } else if (typeName === "ZodBoolean") {
      properties[key] = { type: "boolean" };
    } else if (typeName === "ZodEnum") {
      properties[key] = { type: "string", enum: node._def.values };
    } else {
      properties[key] = { type: "string" };
    }
    if (!optional) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** Structured assistant turn — the shape a voice interface will reuse. */
export type OfficerAnswer = {
  text: string;
  citations: OfficerCitation[];
  toolInvocations: OfficerToolInvocation[];
  proposedActionIds: string[];
  /** citations the model produced that did not survive validation */
  rejectedCitations: RejectedCitation[];
  /** true when the officer reported having no verified record */
  uncertainty: boolean;
  /** the lookup budget ran out before the model produced prose */
  budgetExhausted: boolean;
  provider: string | null;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  rounds: number;
  /** which tool domains were exposed for this question */
  toolGroups: ToolGroup[];
  /** true when selection was widened to every tool */
  escalatedToFullToolset: boolean;
  toolSchemasSent: number;
};

export type ConverseOutcome =
  | { ok: true; answer: OfficerAnswer }
  | { ok: false; error: string };

/** Collect citations the tools themselves produced — these are ground truth. */
function mergeToolCitations(into: Map<string, OfficerCitation>, list: OfficerCitation[]) {
  for (const c of list) into.set(`${c.target}:${c.id}`, c);
}

const CITATION_TAG = /\[\[cite:([a-z_]+):([0-9a-fA-F-]{36})\]\]/g;

/**
 * Extract the model's explicit citation tags and strip them from the prose.
 * Tags are a claim, not a fact — every one is validated afterwards.
 */
function extractCitationTags(text: string): { clean: string; tags: { target: string; id: string }[] } {
  const tags: { target: string; id: string }[] = [];
  const clean = text.replace(CITATION_TAG, (_m, target: string, id: string) => {
    tags.push({ target, id });
    return "";
  });
  return { clean: clean.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim(), tags };
}

const UNCERTAIN_MARKERS = [
  "no verified record", "no verified evidence", "i have no record", "not recorded",
  "cannot find", "no record of", "لا يوجد سجل", "لا سجل", "لا يوجد دليل موثّق", "لا يوجد دليل موثق",
];

/**
 * Run one grounded Officer turn.
 *
 * `history` is prior conversation content (already persisted). The caller
 * supplies it; this function never reads the DB for it, so a conversation
 * the caller cannot see can never be replayed into a prompt.
 */
export async function converseWithOfficer(opts: {
  ctx: OfficerContext;
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  contractScope?: { id: string; number: string; title: string } | null;
  conversationId?: string | null;
}): Promise<ConverseOutcome> {
  const { ctx, question, contractScope } = opts;
  const provider = getOfficerProvider();
  if (!provider) return { ok: false, error: "officer_unavailable_no_provider" };
  if (!ctx.officer.enabled) return { ok: false, error: "officer_disabled_for_organization" };

  const memory = await loadUsableMemory(ctx, { contractId: contractScope?.id ?? null });
  const system = buildOfficerSystemPrompt({ ctx, memory, contractScope: contractScope ?? null }) +
    `\n\nCITING\n- Attach a tag [[cite:TARGET:UUID]] immediately after each claim it supports, using ids returned by tools (targets: contract, clause, obligation, evidence_requirement, evidence_item, evidence_version, verification_run, verification_check, evidence_gap, verification_discrepancy, activity_event). Tags are stripped before display; invalid ones are discarded.`;

  const messages: OfficerTurn[] = [
    ...(opts.history ?? []).slice(-10).map((m) => ({ role: m.role, content: m.content }) as OfficerTurn),
    { role: "user", content: question },
  ];

  // Deterministic schema selection — cuts prompt cost without hiding a tool
  // the model actually needs (see selectToolGroups).
  const selection = selectToolGroups({ question, contractScoped: !!contractScope });
  let specs = toolSpecs(selection.tools);
  let escalatedToFullToolset = selection.fullFallback;
  const toolCitations = new Map<string, OfficerCitation>();
  const invocations: OfficerToolInvocation[] = [];
  const proposedActionIds: string[] = [];
  const seenCalls = new Set<string>();
  let usageIn = 0;
  let usageOut = 0;
  let rounds = 0;
  const t0 = Date.now();
  let finalText = "";
  let model: string | null = null;

  while (rounds < MAX_ROUNDS) {
    rounds++;
    const completion = await provider.complete({ system, messages, tools: specs, maxOutputTokens: 1500 });
    if (!completion.ok) return { ok: false, error: completion.error };
    usageIn += completion.usage?.inputTokens ?? 0;
    usageOut += completion.usage?.outputTokens ?? 0;
    model = completion.model ?? provider.model;

    if (!completion.toolCalls.length) {
      finalText = completion.text.trim();
      break;
    }

    // Record the assistant's tool-call turn so the provider sees a coherent
    // transcript on the next round.
    messages.push({ role: "assistant", content: completion.text ?? "", toolCalls: completion.toolCalls });

    // SAFE FALLBACK: if the model asked for a real tool that selection left
    // out, widen to the full registry for the remaining rounds rather than
    // letting a narrowed prompt produce a worse answer.
    if (!escalatedToFullToolset &&
        completion.toolCalls.some((c) => OFFICER_TOOL_NAMES.has(c.name) && !specs.some((s) => s.name === c.name))) {
      specs = toolSpecs();
      escalatedToFullToolset = true;
    }

    for (const call of completion.toolCalls) {
      if (invocations.length >= MAX_TOOL_CALLS) {
        messages.push({ role: "tool", toolCallId: call.id, name: call.name,
          content: JSON.stringify({ ok: false, error: "tool_budget_exhausted" }) });
        continue;
      }
      const result = await executeCall(ctx, call, seenCalls);
      invocations.push(result.invocation);
      if (result.citations.length) mergeToolCitations(toolCitations, result.citations);
      if (result.actionId) proposedActionIds.push(result.actionId);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: result.payload });
    }
  }

  let budgetExhausted = false;
  if (!finalText) {
    budgetExhausted = true;
    // Budget exhausted with no prose — force one last answer WITHOUT tools so
    // the user gets a grounded summary instead of silence.
    const closing = await provider.complete({
      system,
      messages: [...messages, { role: "user", content: "Answer now with what the tool results already show. If they are insufficient, say plainly what you could not determine." }],
      tools: [],
      maxOutputTokens: 900,
    });
    if (closing.ok) {
      finalText = closing.text.trim();
      usageIn += closing.usage?.inputTokens ?? 0;
      usageOut += closing.usage?.outputTokens ?? 0;
    }
  }
  if (!finalText) {
    // A model that will not stop requesting lookups must not leave the user
    // with a bare error. This text is SERVER-authored from what actually ran
    // — no invented content — and is flagged as uncertain.
    finalText = budgetSummary(ctx.locale, invocations);
  }

  const { clean, tags } = extractCitationTags(finalText);
  const { valid, rejected } = await validateCitations(ctx, tags);

  // Tool-sourced citations are already tenant-verified; model tags are only
  // added once validated. Model tags order first (they back specific claims).
  const merged = new Map<string, OfficerCitation>();
  for (const c of valid) merged.set(`${c.target}:${c.id}`, c);
  for (const [k, c] of toolCitations) if (!merged.has(k)) merged.set(k, c);

  const lower = clean.toLowerCase();
  return {
    ok: true,
    answer: {
      text: clean,
      budgetExhausted,
      citations: [...merged.values()].slice(0, 24),
      toolInvocations: invocations,
      proposedActionIds,
      rejectedCitations: rejected,
      uncertainty: budgetExhausted || UNCERTAIN_MARKERS.some((m) => lower.includes(m)),
      provider: provider.id,
      model,
      usage: { inputTokens: usageIn, outputTokens: usageOut },
      durationMs: Date.now() - t0,
      rounds,
      toolGroups: selection.groups,
      escalatedToFullToolset,
      toolSchemasSent: specs.length,
    },
  };
}

/**
 * Deterministic, honest fallback when the model never settles on an answer.
 * States what was actually looked up and asks for a narrower question —
 * it never asserts an operational fact.
 */
function budgetSummary(locale: string, invocations: OfficerToolInvocation[]): string {
  const ran = invocations.filter((i) => i.ok).map((i) => i.tool);
  const unique = [...new Set(ran)];
  if (locale.startsWith("ar")) {
    return unique.length
      ? `لم أتمكّن من إكمال التحليل داخل حد الاستعلامات المسموح. الاستعلامات التي نُفِّذت فعلًا: ${unique.join("، ")}. لا يوجد استنتاج مؤكَّد بعد — من فضلك اسأل سؤالًا أضيق (عقد واحد أو التزام واحد).`
      : "لم أتمكّن من إكمال التحليل داخل حد الاستعلامات المسموح، ولا يوجد أي نتيجة مؤكَّدة. من فضلك اسأل سؤالًا أضيق.";
  }
  return unique.length
    ? `I could not complete this analysis within my lookup budget. Lookups that did run: ${unique.join(", ")}. I have no confirmed conclusion yet — please narrow the question to a single contract or obligation.`
    : "I could not complete this analysis within my lookup budget and have no confirmed result. Please narrow the question.";
}

/** Validate + execute one model tool call, with repeat suppression. */
async function executeCall(
  ctx: OfficerContext,
  call: OfficerToolCall,
  seen: Set<string>,
): Promise<{ invocation: OfficerToolInvocation; payload: string; citations: OfficerCitation[]; actionId: string | null }> {
  const t0 = Date.now();
  const signature = `${call.name}:${JSON.stringify(call.arguments ?? {})}`;
  if (seen.has(signature)) {
    return {
      invocation: { tool: call.name, ok: false, summary: "repeated identical call suppressed", durationMs: 0 },
      payload: JSON.stringify({ ok: false, error: "duplicate_call_already_answered" }),
      citations: [],
      actionId: null,
    };
  }
  seen.add(signature);

  const result = await runOfficerTool(ctx, call.name, call.arguments);
  const durationMs = Date.now() - t0;
  if (!result.ok) {
    return {
      invocation: { tool: call.name, ok: false, summary: result.error, durationMs },
      payload: JSON.stringify({ ok: false, error: result.error }),
      citations: [],
      actionId: null,
    };
  }

  const body = JSON.stringify({ ok: true, data: result.data, citations: result.citations });
  const payload = body.length > MAX_RESULT_CHARS
    ? JSON.stringify({
        ok: true, truncated: true,
        note: "Result truncated; narrow the query with a contractId or a smaller window.",
        data: body.slice(0, MAX_RESULT_CHARS),
      })
    : body;

  const actionId =
    result.data && typeof result.data === "object" && "id" in (result.data as any) &&
    typeof (result.data as any).status === "string"
      ? String((result.data as any).id)
      : null;

  return {
    invocation: { tool: call.name, ok: true, summary: result.summary, durationMs },
    payload,
    citations: result.citations,
    actionId,
  };
}

export { MAX_ROUNDS as OFFICER_MAX_ROUNDS, MAX_TOOL_CALLS as OFFICER_MAX_TOOL_CALLS };
