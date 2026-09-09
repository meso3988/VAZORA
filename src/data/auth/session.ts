/**
 * Session primitives shared by the proxy (edge) and server code.
 * Phase 1 uses a signed-less demo cookie; the shape mirrors what a
 * Supabase Auth session will provide so the swap stays local to src/data/auth.
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
  organizationId: string;
  mode: "demo" | "live";
};
