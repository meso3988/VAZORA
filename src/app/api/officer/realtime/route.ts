import { NextResponse } from "next/server";

import { auth } from "@/data/auth/provider";
import { roleHasCapability } from "@/lib/officer/authority";
import { buildOfficerContext, ensureOfficerProfile } from "@/lib/officer/context";
import { askOfficer, createConversation } from "@/lib/officer/conversation";
import { readObservations } from "@/lib/officer/observations";
import {
  speakableCitations,
  speechCueFor,
  type OfficerAnswerEnvelope,
  type OfficerRealtimeSession,
} from "@/lib/officer/realtime-contract";
import {
  runDeterministicAdvisorTurn,
  toSpokenScript,
  visemeSequenceForText,
  type AdvisorVoiceLocale,
} from "@/lib/officer/voice";
import { createSupabaseServer } from "@/lib/supabase/server";

const VOICE_LOCALES: readonly AdvisorVoiceLocale[] = ["en-US", "en-GB", "ar-SA"];

function asVoiceLocale(raw: unknown, fallbackLocale: string): AdvisorVoiceLocale {
  if (typeof raw === "string" && (VOICE_LOCALES as readonly string[]).includes(raw)) {
    return raw as AdvisorVoiceLocale;
  }
  return fallbackLocale.startsWith("ar") ? "ar-SA" : "en-US";
}

/**
 * Phase 4B Live Contract Advisor transport endpoint.
 *
 * Authority and tenant scope come ONLY from the authenticated server session
 * (`buildOfficerContext`). The client never supplies organizationId, userId or
 * role. Every turn runs through the real Officer tools or `askOfficer`, never
 * an ungrounded model.
 */
export async function POST(request: Request) {
  const session = await auth.getSession();
  if (!session || session.mode !== "live" || !session.organizationId) {
    return NextResponse.json({ ok: false, code: "unauthorized", message: "Authentication required" }, { status: 401 });
  }

  let body: {
    type?: string;
    question?: string;
    conversationId?: string | null;
    contractId?: string | null;
    voiceLocale?: string;
    mode?: "rehearsal" | "live_officer";
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_request", message: "Invalid JSON body" }, { status: 400 });
  }

  const voiceLocale = asVoiceLocale(body.voiceLocale, "en");
  const appLocale = voiceLocale === "ar-SA" ? "ar" : "en";

  const supabase = await createSupabaseServer();
  await ensureOfficerProfile({ supabase, organizationId: session.organizationId });
  const ctx = await buildOfficerContext({
    supabase,
    organizationId: session.organizationId,
    userId: session.user.id,
    locale: appLocale,
  });
  if (!ctx) {
    return NextResponse.json({ ok: false, code: "unauthorized", message: "Not a member of this organization" }, { status: 403 });
  }
  if (!ctx.officer.enabled) {
    return NextResponse.json({ ok: false, code: "officer_disabled_for_organization", message: "Contract Officer is disabled" }, { status: 403 });
  }
  if (!roleHasCapability(ctx.role, "officer.converse")) {
    return NextResponse.json({ ok: false, code: "unauthorized", message: "Role cannot converse with the Officer" }, { status: 403 });
  }

  const realtimeSession: OfficerRealtimeSession = {
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    role: ctx.role,
    locale: appLocale,
    officer: ctx.officer,
    clock: ctx.clock,
    conversationId: body.conversationId ?? null,
    canApprove: roleHasCapability(ctx.role, "officer.action.approve"),
  };

  if (body.type === "session") {
    return NextResponse.json({ ok: true, type: "session", session: realtimeSession });
  }

  const question = String(body.question ?? "").trim().slice(0, 2000);
  if (!question) {
    return NextResponse.json({ ok: false, code: "invalid_request", message: "Question is required" }, { status: 400 });
  }

  // Default is "rehearsal" ($0.00 deterministic tool mode) so no paid LLM call
  // is ever made unless the caller explicitly chooses "live_officer".
  const mode = body.mode === "live_officer" ? "live_officer" : "rehearsal";

  if (mode === "rehearsal") {
    const turn = await runDeterministicAdvisorTurn(ctx, question, voiceLocale);
    return NextResponse.json({
      ok: true,
      type: "answer",
      session: realtimeSession,
      mode: turn.mode,
      voiceLocale: turn.voiceLocale,
      answer: turn.answer,
      spokenText: turn.spokenText,
      speechCue: turn.speechCue,
      citations: turn.citations,
      visemes: visemeSequenceForText(turn.spokenText),
    });
  }

  let convId = body.conversationId ?? null;
  if (!convId) {
    const created = await createConversation(ctx, {
      contractId: body.contractId ?? null,
      title: question.slice(0, 80),
    });
    if (!created.ok) {
      return NextResponse.json({ ok: false, code: "invalid_request", message: created.error }, { status: 400 });
    }
    convId = created.conversation.id;
  }

  const outcome = await askOfficer(ctx, { conversationId: convId, question });
  if (!outcome.ok) {
    return NextResponse.json({ ok: false, code: "provider_error", message: outcome.error }, { status: 502 });
  }

  const obsRead = await readObservations(ctx);
  const observations = obsRead.ok ? obsRead.rows : [];
  const envelope: OfficerAnswerEnvelope = {
    text: outcome.answer.text,
    citations: outcome.answer.citations,
    toolInvocations: outcome.answer.toolInvocations,
    proposedActionIds: outcome.answer.proposedActionIds,
    uncertainty: outcome.answer.uncertainty,
    budgetExhausted: outcome.answer.budgetExhausted,
    provider: outcome.answer.provider,
    model: outcome.answer.model,
    usage: outcome.answer.usage,
    durationMs: outcome.answer.durationMs,
  };
  const spokenText = toSpokenScript(envelope.text, voiceLocale);

  return NextResponse.json({
    ok: true,
    type: "answer",
    session: { ...realtimeSession, conversationId: convId },
    mode: "live_officer_model",
    voiceLocale,
    answer: envelope,
    spokenText,
    speechCue: speechCueFor(envelope, observations),
    citations: speakableCitations(envelope.citations),
    visemes: visemeSequenceForText(spokenText),
  });
}
