/**
 * Session primitives shared by the proxy (edge) and server code.
 * Phase 2A supports two sources:
 *  - demo: the Phase 1 cookie (`vazora_session=demo`), always the demo org
 *  - live: a Supabase Auth user; `organizationId` is null until onboarding
 *    creates/joins an organization for the user
 */
export const SESSION_COOKIE = "vazora_session";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  role: "owner" | "admin" | "contract_manager" | "member" | "viewer";
};

export type Session = {
  user: SessionUser;
  /** Empty string only in live mode before onboarding finishes. */
  organizationId: string;
  mode: "demo" | "live";
};
