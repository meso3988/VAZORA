import "server-only";

import { cookies } from "next/headers";

import { DEMO_ORGANIZATION_ID, DEMO_USER } from "@/data/mock/organization";

import { SESSION_COOKIE, type Session } from "./session";

/**
 * Auth boundary. Phase 1 ships the demo implementation; a Supabase
 * implementation will read the Supabase auth cookie and map the
 * `organization_members` row to the same `Session` shape.
 */
export interface AuthProvider {
  getSession(): Promise<Session | null>;
  signInDemo(): Promise<Session>;
  signOut(): Promise<void>;
}

const ONE_WEEK = 60 * 60 * 24 * 7;

export const demoAuthProvider: AuthProvider = {
  async getSession() {
    const store = await cookies();
    const value = store.get(SESSION_COOKIE)?.value;
    if (!value) return null;
    return {
      user: DEMO_USER,
      organizationId: DEMO_ORGANIZATION_ID,
      mode: "demo",
    };
  },
  async signInDemo() {
    const store = await cookies();
    store.set(SESSION_COOKIE, "demo", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: ONE_WEEK,
      secure: process.env.NODE_ENV === "production",
    });
    return {
      user: DEMO_USER,
      organizationId: DEMO_ORGANIZATION_ID,
      mode: "demo",
    };
  },
  async signOut() {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
  },
};

export const auth: AuthProvider = demoAuthProvider;
