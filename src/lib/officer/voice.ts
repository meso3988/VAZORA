import "server-only";

import type { OfficerCitation, OfficerToolInvocation } from "@/domain/officer";
import { buildTodayBrief } from "@/lib/officer/brief";
import { validateCitations } from "@/lib/officer/citations";
import type { OfficerContext } from "@/lib/officer/context";
import { readObservations } from "@/lib/officer/observations";
import {
  speakableCitations,
  speechCueFor,
  type OfficerAnswerEnvelope,
  type OfficerSpeechCue,
} from "@/lib/officer/realtime-contract";
import { runOfficerTool } from "@/lib/officer/tools";

export type AdvisorVoiceLocale = "en-US" | "en-GB" | "ar-SA";

export type VisemeKind = "sil" | "AA" | "EE" | "OH" | "OO" | "FV" | "MBP";

/**
 * Convert a grounded Officer Markdown answer into a clean spoken script for TTS
 * without inventing or altering any fact. Markdown tables are summarized by row
 * count and pointed to the transcript on screen so the advisor never reads pipe
 * characters out loud.
 */
export function toSpokenScript(markdown: string, voiceLocale: AdvisorVoiceLocale): string {
  const isAr = voiceLocale === "ar-SA";
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let tableRows = 0;

  const flushTable = () => {
    if (tableRows > 0) {
      const dataRows = Math.max(1, tableRows - 2);
      out.push(
        isAr
          ? `يظهر في المحادثة أدناه جدول مفصّل يتضمن ${dataRows} صفوف موثقة.`
          : `A detailed table with ${dataRows} documented ${dataRows === 1 ? "entry" : "entries"} is shown in the transcript below.`,
      );
      tableRows = 0;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      tableRows++;
      continue;
    }
    flushTable();
    if (!line) continue;
    const cleaned = line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) out.push(cleaned);
  }
  flushTable();

  return out.join(" ");
}

/**
 * Deterministic viseme sequence for a spoken string (supports English and
 * Arabic graphemes) so the advisor avatar's mouth articulates syllables
 * smoothly even when a browser speech engine does not emit phoneme boundaries.
 */
export function visemeSequenceForText(text: string): VisemeKind[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ["sil"];
  const seq: VisemeKind[] = [];
  for (const w of words.slice(0, 80)) {
    for (let i = 0; i < w.length; i += 2) {
      const ch = w[i].toLowerCase();
      if ("mbpمب".includes(ch)) seq.push("MBP");
      else if ("fvفو".includes(ch)) seq.push("FV");
      else if ("ouؤو".includes(ch)) seq.push("OO");
      else if ("oعحخ".includes(ch)) seq.push("OH");
      else if ("eiyيإئ".includes(ch)) seq.push("EE");
      else if ("aأإآع".includes(ch)) seq.push("AA");
      else seq.push("EE");
    }
    seq.push("sil");
  }
  return seq;
}

export type GroundedVoiceTurn = {
  answer: OfficerAnswerEnvelope;
  spokenText: string;
  speechCue: OfficerSpeechCue;
  citations: OfficerCitation[];
  voiceLocale: AdvisorVoiceLocale;
  mode: "rehearsal_tools_zero_cost" | "live_officer_model";
};

/**
 * Zero-cost ($0.00) grounded turn that executes the REAL Officer tool registry
 * (`listContracts`, `getOverdueObligations`, `getEvidenceGaps`, `getContractHealth`)
 * and `buildTodayBrief` on the caller's authorized tenant context, validates
 * every citation via `validateCitations`, and formats a concise grounded reply
 * in EN-US, EN-GB, or AR-SA without calling a paid LLM.
 */
export async function runDeterministicAdvisorTurn(
  ctx: OfficerContext,
  question: string,
  voiceLocale: AdvisorVoiceLocale,
): Promise<GroundedVoiceTurn> {
  const started = Date.now();
  const isAr = voiceLocale === "ar-SA";
  const q = question.toLowerCase();

  const invocations: OfficerToolInvocation[] = [];
  const rawCitations: { target: string; id: string; label?: string }[] = [];

  const [brief, obsRead, contractsRes, overdueRes, gapsRes, healthRes] = await Promise.all([
    buildTodayBrief(ctx),
    readObservations(ctx),
    runOfficerTool(ctx, "listContracts", {}),
    runOfficerTool(ctx, "getOverdueObligations", {}),
    runOfficerTool(ctx, "getEvidenceGaps", {}),
    runOfficerTool(ctx, "getContractHealth", {}),
  ]);

  for (const [name, res] of [
    ["listContracts", contractsRes],
    ["getOverdueObligations", overdueRes],
    ["getEvidenceGaps", gapsRes],
    ["getContractHealth", healthRes],
  ] as const) {
    invocations.push({
      tool: name,
      ok: res.ok,
      summary: res.ok ? `${name} ok` : (res.error ?? "error"),
    });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const contracts: any[] = contractsRes.ok && Array.isArray(contractsRes.data) ? contractsRes.data : [];
  const overdue: any[] = overdueRes.ok && Array.isArray((overdueRes.data as any)?.obligations)
    ? (overdueRes.data as any).obligations
    : [];
  const gaps: any[] = gapsRes.ok && Array.isArray(gapsRes.data) ? gapsRes.data : [];
  const healthContracts: any[] = healthRes.ok && Array.isArray((healthRes.data as any)?.contracts)
    ? (healthRes.data as any).contracts
    : [];
  /* eslint-enable @typescript-eslint/no-explicit-any */

  for (const o of overdue.slice(0, 4)) {
    if (o.id) rawCitations.push({ target: "obligation", id: String(o.id), label: o.title });
    if (o.contract_id) rawCitations.push({ target: "contract", id: String(o.contract_id), label: o.contract_number });
  }
  for (const g of gaps.slice(0, 4)) {
    if (g.obligation_id) rawCitations.push({ target: "obligation", id: String(g.obligation_id), label: g.obligation_title });
    if (g.contract_id) rawCitations.push({ target: "contract", id: String(g.contract_id), label: g.contract_number });
  }
  if (!rawCitations.length) {
    for (const c of contracts.slice(0, 3)) {
      if (c.id) rawCitations.push({ target: "contract", id: String(c.id), label: c.contract_number ?? c.title });
    }
  }

  const { valid: validatedCitations } = await validateCitations(ctx, rawCitations);
  const askHealth = /health|سليم|صحة|حالة العقود|healthy|track/i.test(q);
  const askGaps = /gap|evidence|أدلة|دليل|فجوات|فجوة|missing/i.test(q);
  const askOverdue = /overdue|متأخر|استحقاق|due|موعد|التزام/i.test(q);

  let text = "";
  let uncertainty = false;

  if (!brief.assessment.complete || !obsRead.ok) {
    uncertainty = true;
    text = isAr
      ? `اعتبارًا من ${ctx.clock.today} (${ctx.clock.timeZone})، لم أتمكن من إكمال التقييم الحالي بالكامل (${brief.assessment.reasons.join("، ") || "فحص غير مكتمل"}). يوجد في السجل ${contracts.length} عقود نشطة، و${overdue.length} التزامات متأخرة، و${gaps.length} فجوات أدلة مفتوحة.`
      : `As of ${ctx.clock.today} (${ctx.clock.timeZone}), I could not complete the current assessment (${brief.assessment.reasons.join(", ") || "incomplete coverage"}). Current VAZORA records show ${contracts.length} active contract(s), ${overdue.length} overdue obligation(s), and ${gaps.length} open evidence gap(s).`;
  } else if (contracts.length === 0) {
    uncertainty = true;
    text = isAr
      ? `اعتبارًا من ${ctx.clock.today} (${ctx.clock.timeZone})، لا توجد عقود مسجلة في منشأتك حاليًا. عند إضافة عقد وتفعيله سأعرض لك الاستحقاقات وفجوات الأدلة الموثقة.`
      : `As of ${ctx.clock.today} (${ctx.clock.timeZone}), no contracts are recorded in your organization yet. Once a contract is uploaded and activated, I will report its grounded obligations and evidence gaps.`;
  } else if (askHealth) {
    const clean = healthContracts.filter((c) => c.verdict === "no_actionable_issues_recorded");
    const withIssues = healthContracts.filter((c) => c.verdict === "actionable_issues");
    text = isAr
      ? `وفق فحص حالة العقود في ${ctx.clock.today} (${ctx.clock.timeZone}): ${clean.length} عقود لا توجد عليها مشكلات قابلة للإجراء ضمن الفحوص المتاحة، بينما ${withIssues.length} عقود تسجّل مشكلات مفتوحة (${overdue.length} التزامات متأخرة و${gaps.length} فجوات أدلة مفتوحة).`
      : `According to the VAZORA contract health check on ${ctx.clock.today} (${ctx.clock.timeZone}), ${clean.length} contract(s) have no actionable issues recorded within the checks and data available, while ${withIssues.length} contract(s) have open issues (${overdue.length} overdue obligation(s) and ${gaps.length} open evidence gap(s)).`;
  } else if (askGaps) {
    if (gaps.length === 0) {
      text = isAr
        ? `في سجل فازورا بتاريخ ${ctx.clock.today}، لا توجد فجوات أدلة مفتوحة مسجلة حاليًا عبر ${contracts.length} عقود.`
        : `According to the current VAZORA record on ${ctx.clock.today}, there are 0 open evidence gaps across ${contracts.length} contract(s).`;
    } else {
      const top = gaps.slice(0, 3).map((g) => `${g.contract_number ?? ""} — ${g.requirement_name ?? g.obligation_title ?? g.description}`).join("؛ ");
      text = isAr
        ? `يوجد حاليًا ${gaps.length} فجوات أدلة مفتوحة في سجل فازورا. أبرزها: ${top}.`
        : `There are currently ${gaps.length} open evidence gap(s) recorded in VAZORA. Key items: ${top}.`;
    }
  } else if (askOverdue) {
    if (overdue.length === 0) {
      text = isAr
        ? `اعتبارًا من ${ctx.clock.today} (${ctx.clock.timeZone})، لا توجد التزامات متأخرة مسجلة عبر ${contracts.length} عقود.`
        : `As of ${ctx.clock.today} (${ctx.clock.timeZone}), there are 0 overdue obligations recorded across ${contracts.length} contract(s).`;
    } else {
      const top = overdue.slice(0, 3).map((o) => `${o.contract_number ?? ""}: ${o.title} (${o.daysOverdue}d)`).join("؛ ");
      text = isAr
        ? `يوجد ${overdue.length} التزامات متأخرة حتى ${ctx.clock.today} (${ctx.clock.timeZone}): ${top}.`
        : `There are ${overdue.length} overdue obligation(s) as of ${ctx.clock.today} (${ctx.clock.timeZone}): ${top}.`;
    }
  } else {
    const topOverdue = overdue[0] ? `${overdue[0].contract_number ?? ""}: ${overdue[0].title}` : null;
    text = isAr
      ? `ملخص سجل فازورا حتى ${ctx.clock.today} (${ctx.clock.timeZone}): لديك ${contracts.length} عقود، و${overdue.length} التزامات متأخرة، و${gaps.length} فجوات أدلة مفتوحة، و${brief.approvalsWaiting} إجراءات بانتظار الموافقة.${topOverdue ? ` أول بند متأخر: ${topOverdue}.` : ""}`
      : `VAZORA summary as of ${ctx.clock.today} (${ctx.clock.timeZone}): ${contracts.length} contract(s), ${overdue.length} overdue obligation(s), ${gaps.length} open evidence gap(s), and ${brief.approvalsWaiting} action(s) awaiting approval.${topOverdue ? ` Top overdue item: ${topOverdue}.` : ""}`;
  }

  const answer: OfficerAnswerEnvelope = {
    text,
    citations: validatedCitations,
    toolInvocations: invocations,
    proposedActionIds: [],
    uncertainty,
    budgetExhausted: false,
    provider: "deterministic-tools",
    model: "vazora-officer-tools-zero-cost",
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: Date.now() - started,
  };
  const observations = obsRead.ok ? obsRead.rows : [];
  return {
    answer,
    spokenText: toSpokenScript(answer.text, voiceLocale),
    speechCue: speechCueFor(answer, observations),
    citations: speakableCitations(validatedCitations),
    voiceLocale,
    mode: "rehearsal_tools_zero_cost",
  };
}
