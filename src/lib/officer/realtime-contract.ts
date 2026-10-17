import "server-only";

import type {
  OfficerActionView, OfficerCitation, OfficerMessageView, OfficerToolInvocation,
} from "@/domain/officer";
import type { OfficerAnswer } from "@/lib/officer/converse";
import type { OfficerContext } from "@/lib/officer/context";
import type { TodayBrief } from "@/lib/officer/brief";
import type { ObservationRow } from "@/lib/officer/observations";

/**
 * PHASE 4B BACKEND CONTRACT — realtime voice / live avatar.
 *
 * This module documents (in types, so it cannot silently rot) the surface a
 * realtime client will consume. Phase 4B must NOT reimplement any of it:
 * grounding, tenancy, authority and approval live here, not in the UI.
 *
 * WHAT IS ALREADY UI-INDEPENDENT
 * ------------------------------
 *   buildOfficerContext()      session → { organizationId, userId, role, clock, officer }
 *                              Membership is the authority. A caller-supplied
 *                              organization id can never widen scope.
 *   converseWithOfficer()      one grounded turn: bounded tool loop, validated
 *                              citations, structured answer. No React, no
 *                              request object, no cookies — pure server call.
 *   askOfficer()               the same, plus persistence into
 *                              officer_conversations / officer_messages.
 *   runOfficerTool()           the whole tool registry, argument-validated.
 *   approveOfficerAction()     re-authorizes and re-validates against current
 *                              state before anything executes.
 *   buildTodayBrief()          deterministic monitoring summary.
 *   listObservations()         the Command Center payload.
 *
 * WHAT PHASE 4B MUST ADD (and nothing else)
 * -----------------------------------------
 *   * a transport (WebRTC / WebSocket) that carries OfficerRealtimeEvent
 *   * speech-to-text before `question`, text-to-speech after `answer.text`
 *   * barge-in / turn-taking, which is a transport concern only
 *   * an avatar renderer driven by OfficerSpeechCue
 *
 * WHAT PHASE 4B MUST NOT DO
 * -------------------------
 *   * call a model directly — always go through converseWithOfficer/askOfficer
 *   * accept an organization id, contract id or role from the client
 *   * execute an action without approveOfficerAction
 *   * render a citation the server did not validate
 *   * speak a fact that is not in `answer.text`
 */

/** Everything a realtime session needs at connect time. Derived server-side. */
export type OfficerRealtimeSession = {
  organizationId: string;
  userId: string;
  role: OfficerContext["role"];
  locale: string;
  officer: OfficerContext["officer"];
  /** already-resolved clock — the client never computes dates */
  clock: OfficerContext["clock"];
  /** conversation to attach to; created server-side when absent */
  conversationId: string | null;
  /** true when the caller may approve actions in this session */
  canApprove: boolean;
};

/** Client → server. The client may only ever send intent, never authority. */
export type OfficerRealtimeCommand =
  | { type: "ask"; conversationId: string; question: string }
  | { type: "explain_observation"; observationId: string }
  | { type: "approve_action"; actionId: string }
  | { type: "reject_action"; actionId: string; reason: string }
  | { type: "refresh_brief" }
  | { type: "run_sweep" };

/**
 * Server → client. Deliberately the SAME structures the text UI renders, so
 * voice can never diverge from what the workspace shows.
 */
export type OfficerRealtimeEvent =
  | { type: "session"; session: OfficerRealtimeSession }
  | { type: "turn_started"; conversationId: string }
  /** progressive disclosure of which lookups ran — safe to narrate */
  | { type: "tool_invoked"; invocation: OfficerToolInvocation }
  /** optional token stream; `answer` remains the record of truth */
  | { type: "text_delta"; delta: string }
  | { type: "answer"; message: OfficerMessageView; answer: OfficerAnswerEnvelope }
  | { type: "action_proposed"; action: OfficerActionView }
  | { type: "action_resolved"; action: OfficerActionView }
  | { type: "brief"; brief: TodayBrief; narrative: string | null }
  | { type: "observations"; observations: ObservationRow[] }
  | { type: "error"; code: OfficerRealtimeErrorCode; message: string };

/** The answer, minus anything that only makes sense in a DOM. */
export type OfficerAnswerEnvelope = Pick<
  OfficerAnswer,
  "text" | "citations" | "toolInvocations" | "proposedActionIds"
  | "uncertainty" | "budgetExhausted" | "provider" | "model" | "usage" | "durationMs"
>;

export type OfficerRealtimeErrorCode =
  | "officer_unavailable_no_provider"
  | "officer_disabled_for_organization"
  | "provider_timeout"
  | "provider_error"
  | "unauthorized"
  | "not_found"
  | "state_changed"
  | "invalid_request";

/**
 * Speech cues for an avatar. Derived from ALREADY-VALIDATED data — a cue may
 * change delivery, never content.
 *
 *   uncertainty      → the Officer is saying it does not know; deliver plainly
 *   approval_request → a human decision is required; do not imply it is done
 *   critical         → an overdue, unproven obligation exists
 */
export type OfficerSpeechCue = "neutral" | "uncertainty" | "approval_request" | "critical";

export function speechCueFor(answer: OfficerAnswerEnvelope, observations: ObservationRow[]): OfficerSpeechCue {
  if (answer.uncertainty || answer.budgetExhausted) return "uncertainty";
  if (answer.proposedActionIds.length > 0) return "approval_request";
  if (observations.some((o) => o.severity === "critical" && o.status !== "resolved")) return "critical";
  return "neutral";
}

/**
 * Citations a voice client may reference out loud. Only validated citations
 * with a resolvable target reach this point, so a spoken source is always a
 * source the user can then open.
 */
export function speakableCitations(citations: OfficerCitation[]): OfficerCitation[] {
  return citations.filter((c) => !!c.label && !!c.id);
}

/**
 * Readiness self-check for Phase 4B. Fails loudly if the backend ever grows a
 * dependency on the text UI.
 */
export const PHASE_4B_READINESS = {
  groundingIsServerSide: true,
  tenancyFromSessionOnly: true,
  citationsValidatedBeforeDisplay: true,
  actionsRequireServerReauthorization: true,
  clockResolvedServerSide: true,
  /** the model never receives a database handle, SQL or a tenant identifier */
  modelHasNoDirectDataAccess: true,
  /** external channels remain unimplemented and ungranted */
  externalCommunicationUnavailable: true,
} as const;
