import type { OfficerContext } from "@/lib/officer/context";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Authoritative action outcomes.
 *
 * The status of anything the Officer was asked to DO is rendered from the
 * officer_actions record (or the tool's refusal), never from model prose.
 * A proposal is not completed work; an internal bookkeeping task completing
 * does not mean a message was sent, evidence was verified or a gap resolved;
 * Phase 4A has no external channel at all.
 *
 * Model sentences that claim a completion the records do not back are removed
 * (not disclaimed) — the receipt states what actually happened instead.
 */

export type ActionAttempt = {
  tool: string;
  ok: boolean;
  error?: string | null;
  actionId?: string | null;
  reused?: boolean;
};

export type ActionOutcomeKind =
  | "proposed" | "awaiting_approval" | "approved_not_executed" | "completed" | "blocked" | "failed";

export type ActionReceipt = {
  tool: string;
  actionId: string | null;
  actionType: string | null;
  outcome: ActionOutcomeKind;
  /** an identical open proposal already existed — nothing new was created */
  reused: boolean;
  /** completed only: the exact operation recorded in execution_result */
  operation: string | null;
  reason: string | null;
};

const TOOL_ACTION_TYPE: Record<string, string> = {
  createInternalAction: "officer.internal_task",
  proposeAssignment: "obligation.assign_owner",
  requestHumanApproval: "officer.escalate",
};

export function receiptFromRow(attempt: ActionAttempt, row: any): ActionReceipt {
  const base = {
    tool: attempt.tool, actionId: row.id as string, actionType: row.action_type as string,
    reused: !!attempt.reused, operation: null as string | null, reason: null as string | null,
  };
  switch (row.status) {
    case "suggested": return { ...base, outcome: "proposed" };
    case "waiting_for_approval": return { ...base, outcome: "awaiting_approval" };
    case "approved":
    case "executing":
      return { ...base, outcome: "approved_not_executed", reason: row.execution_result?.held ?? null };
    case "completed":
      return row.execution_result?.executed === true
        ? { ...base, outcome: "completed", operation: String(row.execution_result.kind ?? row.action_type) }
        : { ...base, outcome: "approved_not_executed" };
    case "failed": return { ...base, outcome: "failed", reason: row.error_message ?? "failed" };
    default: return { ...base, outcome: "blocked", reason: row.rejection_reason ?? row.status };
  }
}

const POLICY_REFUSAL =
  /^(unauthorized|action_channel_not_available|target_mismatch|unknown_action|invalid_arguments|[a-z_]*not_found_in_organization|assignee_not_a_member|repeated identical call|tool_budget)/;

export function receiptFromError(attempt: ActionAttempt): ActionReceipt {
  const reason = attempt.error ?? "unknown";
  return {
    tool: attempt.tool, actionId: null, actionType: TOOL_ACTION_TYPE[attempt.tool] ?? null,
    outcome: POLICY_REFUSAL.test(reason) ? "blocked" : "failed", reused: false, operation: null, reason,
  };
}

/** Load the authoritative record for every action attempted in a turn. */
export async function buildActionReceipts(ctx: OfficerContext, attempts: ActionAttempt[]): Promise<ActionReceipt[]> {
  const ids = [...new Set(attempts.filter((a) => a.ok && a.actionId).map((a) => a.actionId as string))];
  const rows = new Map<string, any>();
  if (ids.length) {
    const { data } = await ctx.supabase
      .from("officer_actions")
      .select("id, action_type, status, execution_result, error_message, rejection_reason")
      .eq("organization_id", ctx.organizationId).in("id", ids);
    for (const r of data ?? []) rows.set(r.id, r);
  }
  const seen = new Set<string>();
  const out: ActionReceipt[] = [];
  for (const a of attempts) {
    if (a.ok && a.actionId) {
      if (seen.has(a.actionId)) continue;
      seen.add(a.actionId);
      const row = rows.get(a.actionId);
      out.push(row ? receiptFromRow(a, row) : receiptFromError({ ...a, error: "action_record_not_found" }));
    } else if (!a.ok) {
      out.push(receiptFromError(a));
    }
  }
  return out;
}

// ---------- rendering ------------------------------------------------------------

const LABEL: Record<string, { en: string; ar: string }> = {
  "officer.internal_task": { en: "internal follow-up task", ar: "مهمة متابعة داخلية" },
  "officer.note": { en: "internal note", ar: "ملاحظة داخلية" },
  "officer.request_evidence_internal": { en: "internal evidence request", ar: "طلب دليل داخلي" },
  "officer.escalate": { en: "escalation to a human reviewer", ar: "تصعيد إلى مراجع بشري" },
  "obligation.assign_owner": { en: "owner assignment", ar: "إسناد مالك للالتزام" },
  "obligation.change_due_date": { en: "due-date change", ar: "تغيير تاريخ الاستحقاق" },
};

function label(r: ActionReceipt, ar: boolean) {
  const l = LABEL[r.actionType ?? ""] ?? { en: "requested action", ar: "الإجراء المطلوب" };
  return ar ? l.ar : l.en;
}

function line(r: ActionReceipt, ar: boolean): string {
  const l = label(r, ar);
  if (ar) {
    switch (r.outcome) {
      case "proposed": return r.reused
        ? `يوجد مقترح مفتوح مسبقًا لـ${l}؛ لم يُنشأ مقترح جديد، ولم يُنفَّذ بعد.`
        : `اقتُرحت ${l} وتنتظر تأكيد شخص مخوّل؛ لم تُنفَّذ بعد.`;
      case "awaiting_approval": return r.reused
        ? `يوجد طلب موافقة مفتوح مسبقًا لـ${l}؛ لم يُنشأ طلب جديد. لم يُنفَّذ أو يُرسل شيء.`
        : `طلب الموافقة على ${l} بانتظار قرار بشري؛ لم يُنفَّذ أو يُرسل شيء.`;
      case "approved_not_executed": return `${l}: تمت الموافقة دون تنفيذ — المرحلة 4A تحتجز التغييرات التشغيلية لمنفّذ لاحق.`;
      case "completed": return `اكتمل تسجيل ${l} داخليًا (${r.operation}). لم تُرسل أي رسالة، ولم يُتحقق من أي دليل، ولم تتغير أي فجوة.`;
      case "blocked": return `لم يُنفَّذ: ${l} مرفوض (${r.reason}).`;
      case "failed": return `لم يُنفَّذ: تعذّر ${l} (${r.reason}).`;
    }
  }
  switch (r.outcome) {
    case "proposed": return r.reused
      ? `An open proposal for this ${l} already exists; no new proposal was created. It has not been carried out.`
      : `Proposed an ${l}; it awaits confirmation by an authorized person and has not been carried out.`;
    case "awaiting_approval": return r.reused
      ? `An open approval request for this ${l} already exists; no new request was created. Nothing has been carried out or sent.`
      : `Approval request for an ${l} is awaiting a human decision. Nothing has been carried out or sent.`;
    case "approved_not_executed": return `The ${l} is approved but not executed — Phase 4A holds business changes for a later executor.`;
    case "completed": return `Completed: the ${l} was recorded as internal bookkeeping (${r.operation}). No message was sent, no evidence was verified and no gap was changed.`;
    case "blocked": return `Not done: the ${l} was blocked (${r.reason}).`;
    case "failed": return `Not done: the ${l} failed (${r.reason}).`;
  }
}

export function renderReceipts(locale: string, receipts: ActionReceipt[], actionRequested: boolean): string {
  const ar = locale.startsWith("ar");
  if (!receipts.length) {
    if (!actionRequested) return "";
    return ar
      ? "حالة الإجراء (من سجلات VAZORA): لم يُتخذ أي إجراء في VAZORA لهذا الطلب."
      : "Action status (from VAZORA records): no action was taken in VAZORA for this request.";
  }
  const head = ar ? "حالة الإجراء (من سجلات VAZORA):" : "Action status (from VAZORA records):";
  return [head, ...receipts.map((r) => `- ${line(r, ar)}`)].join("\n");
}

/** Did the user ask the Officer to DO something (vs. ask about something)? */
const ACTION_REQUEST = new RegExp([
  "\\b(send|email|forward|notify|mark|resolve|close|dismiss|assign|create|chase|remind|follow[ -]up|escalate|approve|propose)\\b",
  "أرسل|ابعث|راسل|أغلق|اغلق|أسند|اسند|أنشئ|انشئ|تابع|ذكّر|صعّد|اعتمد|وافق|اقترح|حلّ|اعتبر",
].join("|"), "i");
export function isActionRequest(question: string): boolean {
  return ACTION_REQUEST.test(question);
}

// ---------- completion-claim enforcement -----------------------------------------

/**
 * "approve" = a human approval described in the passive ("has been approved"),
 * backed only by an approved/completed record; "self_approve" = the Officer
 * claiming it approved something, which it never can.
 */
type ClaimKind = "send" | "create" | "assign" | "resolve" | "verify" | "escalate" | "approve" | "self_approve" | "complete";

/** verb → kind; English past forms and Arabic first-person / "تم + masdar" forms */
const KIND_PATTERNS: [ClaimKind, RegExp][] = [
  ["send", /\b(sent|emailed|e-mailed|forwarded|notified|delivered|messaged)\b|أرسلت|أرسلنا|بعثت|راسلت|تم\s+(إرسال|ارسال|إبلاغ)/i],
  ["resolve", /\b(resolved|closed|dismissed|marked\b.*\b(resolved|closed|complete|done))\b|أغلقت|اغلقت|حللت|تم\s+(إغلاق|اغلاق|حل|حلّ)/i],
  ["assign", /\b(assigned|reassigned)\b|أسندت|اسندت|عيّنت|عينت|تم\s+(إسناد|اسناد|تعيين)/i],
  ["verify", /\bverified\b|تحققت|تحقّقت/i],
  ["approve", /\bapproved\b|وافقت|اعتمدت|تمت\s+الموافقة|تم\s+اعتماد/i],
  ["escalate", /\b(escalated|submitted|requested|raised|flagged)\b|صعّدت|صعدت|طلبت|تم\s+تصعيد/i],
  ["create", /\b(created|opened|logged|added|recorded|set up|scheduled)\b|أنشأت|انشأت|أضفت|تم\s+(إنشاء|انشاء)/i],
  ["complete", /\b(done|completed|executed|carried out|taken care of|handled)\b|أنجزت|أكملت|نفّذت|نفذت|تم\s+(تنفيذ|إنجاز)/i],
];

/** Which operation a sentence talks about — a claim must match THAT record type. */
const OBJECT_TYPES: [RegExp, string][] = [
  [/\b(follow[- ]?up|task|reminder)\b|متابعة|مهمة/i, "officer.internal_task"],
  [/\bnote\b|ملاحظة/i, "officer.note"],
  [/\bescalat\w*|\breview request\b|تصعيد/i, "officer.escalate"],
  [/\bevidence request\b|\brequest(?:ed)? (?:for |the )?evidence\b|طلب دليل/i, "officer.request_evidence_internal"],
  [/\bassign\w*|\bowner\b|إسناد|مالك/i, "obligation.assign_owner"],
];
function objectTypes(s: string): string[] | null {
  const t = OBJECT_TYPES.filter(([re]) => re.test(s)).map(([, type]) => type);
  return t.length ? t : null;
}

const NEGATED = /\b(not|no|never|nothing|cannot|unable|without|neither|nor)\b|n['’]t\b|(^|\s)(لا|لم|لن|ليس|لست|لسنا|غير|يتعذر|تعذر|دون|بدون)(\s|$)/i;
const CONDITIONAL = /\b(until|unless|once|if|when|whether|after|before|will|would|could|can|should|may|might|only|to be)\b|(^|\s)(حتى|عندما|إذا|اذا|إن|لو|بعد|قبل|سوف|يمكن|يمكنني|أستطيع|فقط|ينبغي)(\s|$)/i;
/** the Officer speaking about ITS OWN action: first person, or a subject-less leading verb */
const FIRST_PERSON = /\b(i|we|i['’]ve|we['’]ve|i['’]ll)\b|^[-*•\d.)\s]*(created|sent|emailed|forwarded|notified|assigned|resolved|closed|marked|verified|escalated|submitted|requested|approved|opened|logged|added|recorded|raised|flagged|scheduled|done|completed)\b|(^|\s)(لقد|قمت|قمنا)(\s|$)|(أرسلت|أنشأت|انشأت|أسندت|عيّنت|أغلقت|حللت|تحققت|صعّدت|طلبت|وافقت|أضفت|أنجزت|أكملت)(\s|$)/i;
/**
 * Agentless completion forms ("has been sent", Arabic "تم إرسال") are ALSO
 * how recorded history is described ("تم إسناد الالتزام"), so they count as
 * the Officer's own claim only in a turn where the user asked it to act.
 */
const AGENTLESS = /\b(has|have)\s+been\s+(sent|emailed|forwarded|delivered|resolved|closed|assigned|escalated|submitted|completed|done|approved|executed|carried out)\b|(^|\s)(تم|تمت)\s/i;
const QUOTED = /“[^”]*”|"[^"]*"|«[^»]*»|‘[^’]*’/g;
/** clause boundaries — negation/conditionals scope to their own clause */
const CLAUSE = /,|;|:|،|\s(?:and|but|while|whereas)\s|\s(?:لكن|لكنّ|بينما)\s/i;

const NEVER = new Set<ClaimKind>(["send", "resolve", "verify", "self_approve"]);

/**
 * A claim is backed only by a record of the SAME operation (when the sentence
 * names one) in a state that makes the claim true. A completed internal task
 * backs "completed the follow-up task" — never "sent", "assigned", "verified",
 * "approved" or "resolved".
 */
function supported(kind: ClaimKind, receipts: ActionReceipt[], types: string[] | null): boolean {
  const pool = types ? receipts.filter((r) => r.actionType && types.includes(r.actionType)) : receipts;
  const fresh = pool.filter((r) => !r.reused);
  switch (kind) {
    // No Phase 4A Officer operation sends, resolves or verifies, and the
    // Officer never approves — approval is a human decision.
    case "send": case "resolve": case "verify": case "self_approve": return false;
    case "approve": return pool.some((r) => r.outcome === "approved_not_executed" || r.outcome === "completed");
    case "assign": return receipts.some((r) => r.actionType === "obligation.assign_owner" && r.outcome === "completed");
    case "complete": return pool.some((r) => r.outcome === "completed");
    case "create": return fresh.some((r) => ["proposed", "awaiting_approval", "approved_not_executed", "completed"].includes(r.outcome));
    case "escalate": return fresh.some((r) => ["awaiting_approval", "approved_not_executed", "completed"].includes(r.outcome));
  }
}

/**
 * Classify one sentence: the completion claims the Officer makes about its
 * OWN actions. Quotations, questions, negated and conditional clauses make no
 * claim; a third-person historical description ("the report was uploaded")
 * is not the Officer's action.
 */
export function completionClaimKinds(sentence: string, actionTurn = true): ClaimKind[] {
  const s = sentence.replace(QUOTED, " ").trim();
  if (!s || /[?؟]\s*$/.test(s)) return [];
  const self = FIRST_PERSON.test(s);
  const speaker = self || (actionTurn && AGENTLESS.test(s));
  if (!speaker) return [];
  const kinds = new Set<ClaimKind>();
  // Negation scopes to its clause; modality/condition carries forward
  // ("I can create a request to have it reviewed and sent").
  let modal = false;
  for (const clause of s.split(CLAUSE)) {
    modal ||= CONDITIONAL.test(clause);
    if (modal || NEGATED.test(clause)) continue;
    for (const [k, re] of KIND_PATTERNS) {
      if (re.test(clause)) kinds.add(k === "approve" && self ? "self_approve" : k);
    }
  }
  return [...kinds];
}

export function enforceActionClaims(
  text: string, receipts: ActionReceipt[], actionTurn = true,
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const lines = text.split("\n").map((ln) => {
    const parts = ln.split(/(?<=[.!。])\s+/);
    const kept = parts.filter((p) => {
      const kinds = completionClaimKinds(p, actionTurn);
      const types = objectTypes(p.replace(QUOTED, " "));
      // Every claim in the sentence must be backed — one true claim does not
      // carry an unrelated one ("created the task and sent it").
      const bad = kinds.some((k) => NEVER.has(k) || !supported(k, receipts, types));
      if (bad) removed.push(p.trim());
      return !bad;
    });
    return kept.join(" ");
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removed };
}

/** Receipt first (authoritative), then the model's explanation with unsupported claims removed. */
export function composeActionAnswer(opts: {
  locale: string; text: string; receipts: ActionReceipt[]; actionRequested: boolean;
}): { text: string; removed: string[] } {
  const guarded = enforceActionClaims(opts.text, opts.receipts, opts.actionRequested || opts.receipts.length > 0);
  const block = renderReceipts(opts.locale, opts.receipts, opts.actionRequested);
  return { text: [block, guarded.text].filter(Boolean).join("\n\n"), removed: guarded.removed };
}
