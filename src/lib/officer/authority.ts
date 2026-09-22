/**
 * Contract Officer authority model.
 *
 * AN AI RECOMMENDATION IS NEVER AN AUTHORIZATION. The officer may read, may
 * write its own internal notes, and may PROPOSE anything else — but every
 * meaningful business mutation is gated on a named human with a role that
 * carries the capability, re-checked server-side at execution time.
 *
 * Pure: no I/O. Roles are the Phase 2A enum today (owner/admin/member) but
 * the matrix is keyed by capability so future roles (Contract Manager,
 * Project Manager, Finance, Contributor, Approver) slot in without touching
 * call sites.
 */

/** Roles that exist today. Extend the union, then extend ROLE_CAPABILITIES. */
export type OfficerRole = "owner" | "admin" | "member";

/** Roles planned for Phase 4B+; declared so the matrix shape is future-proof. */
export type PlannedRole =
  | "contract_manager" | "project_manager" | "finance" | "contributor" | "approver";

export type AnyRole = OfficerRole | PlannedRole;

/**
 * Tool/action safety classes.
 *
 *   READ_ONLY            — retrieval; no state change
 *   SAFE_INTERNAL_WRITE  — officer's own bookkeeping (observations, notes,
 *                          proposals). Visible, auditable, reversible, and
 *                          never a contractual or evidence decision.
 *   APPROVAL_REQUIRED    — anything a human would be accountable for.
 */
export type ToolClass = "READ_ONLY" | "SAFE_INTERNAL_WRITE" | "APPROVAL_REQUIRED";

/** Capabilities a human role may hold. */
export type Capability =
  | "officer.read"            // use the officer at all
  | "officer.converse"        // create conversations/messages
  | "officer.memory.write"    // record confirmed organizational memory
  | "officer.action.propose"  // ask the officer to draft a proposal
  | "officer.action.approve"  // approve a proposed action
  | "officer.sweep.run"       // trigger a manual contract sweep
  | "obligation.assign"       // assign an owner
  | "obligation.reschedule"   // change a due date
  | "evidence.override"       // human override on a verification check
  | "gap.dismiss"             // dismiss a gap without a verification run
  | "contract.activate"       // activate contractual change
  | "external.communicate";   // email/WhatsApp/portal — Phase 4C, nobody yet

/**
 * Every member may read, converse, ask for a proposal and refresh
 * monitoring. A sweep is a read-only detection pass that writes only the
 * Officer's own observations — it changes no contract, obligation, evidence
 * or gap — so withholding it would block ordinary work without protecting
 * anything.
 */
const READ_SET: Capability[] = [
  "officer.read", "officer.converse", "officer.action.propose", "officer.sweep.run",
];

/**
 * Role → capabilities. Absence is denial; there is no implicit inheritance,
 * so a new role cannot accidentally acquire approval rights.
 */
export const ROLE_CAPABILITIES: Record<AnyRole, readonly Capability[]> = {
  owner: [
    ...READ_SET, "officer.memory.write", "officer.action.approve",
    "obligation.assign", "obligation.reschedule", "evidence.override",
    "gap.dismiss", "contract.activate",
  ],
  admin: [
    ...READ_SET, "officer.memory.write", "officer.action.approve",
    "obligation.assign", "obligation.reschedule", "evidence.override",
    "gap.dismiss", "contract.activate",
  ],
  member: [...READ_SET, "officer.memory.write"],

  // Planned roles — declared with conservative defaults so an early
  // introduction cannot silently grant more than intended.
  contract_manager: [
    ...READ_SET, "officer.memory.write", "officer.action.approve",
    "obligation.assign", "obligation.reschedule",
  ],
  project_manager: [...READ_SET, "officer.memory.write", "obligation.assign"],
  finance: [...READ_SET, "officer.memory.write"],
  contributor: [...READ_SET],
  approver: [...READ_SET, "officer.action.approve"],
};

/**
 * External communication is deliberately granted to NOBODY in Phase 4A —
 * the capability exists so the gate is already in place when 4C arrives.
 */
export function roleHasCapability(role: AnyRole | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return (ROLE_CAPABILITIES[role] ?? []).includes(cap);
}

/** Action type → the capability its EXECUTION requires (not its proposal). */
export const ACTION_CAPABILITY: Record<string, Capability> = {
  "officer.note": "officer.action.propose",
  "officer.internal_task": "officer.action.propose",
  "officer.request_evidence_internal": "officer.action.approve",
  "officer.escalate": "officer.action.approve",
  "obligation.assign_owner": "obligation.assign",
  "obligation.change_due_date": "obligation.reschedule",
  "evidence.human_override": "evidence.override",
  "evidence.dismiss_gap": "gap.dismiss",
  "contract.activate_change": "contract.activate",
  "external.send_message": "external.communicate",
};

/** Action type → safety class. Unknown types are treated as the strictest. */
export const ACTION_CLASS: Record<string, ToolClass> = {
  "officer.note": "SAFE_INTERNAL_WRITE",
  "officer.internal_task": "SAFE_INTERNAL_WRITE",
  "officer.request_evidence_internal": "APPROVAL_REQUIRED",
  "officer.escalate": "APPROVAL_REQUIRED",
  "obligation.assign_owner": "APPROVAL_REQUIRED",
  "obligation.change_due_date": "APPROVAL_REQUIRED",
  "evidence.human_override": "APPROVAL_REQUIRED",
  "evidence.dismiss_gap": "APPROVAL_REQUIRED",
  "contract.activate_change": "APPROVAL_REQUIRED",
  "external.send_message": "APPROVAL_REQUIRED",
};

export function classifyAction(actionType: string): ToolClass {
  return ACTION_CLASS[actionType] ?? "APPROVAL_REQUIRED";
}

/** Phase 4A: every meaningful business mutation needs a human approval. */
export function actionRequiresApproval(actionType: string): boolean {
  return classifyAction(actionType) === "APPROVAL_REQUIRED";
}

export type AuthorizationResult =
  | { allowed: true }
  | { allowed: false; reason: "unknown_action" | "missing_capability" | "not_available_yet" };

/**
 * Can this role EXECUTE this action once approved? Called before proposing
 * and again — server-side — at execution. Approval alone is never enough.
 */
export function authorizeAction(role: AnyRole | null | undefined, actionType: string): AuthorizationResult {
  const cap = ACTION_CAPABILITY[actionType];
  if (!cap) return { allowed: false, reason: "unknown_action" };
  // Phase 4A ships no external channel; the capability is unassigned.
  if (cap === "external.communicate") return { allowed: false, reason: "not_available_yet" };
  return roleHasCapability(role, cap) ? { allowed: true } : { allowed: false, reason: "missing_capability" };
}
