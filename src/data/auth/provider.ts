import "server-only";

import { cookies } from "next/headers";

import { DEMO_ORGANIZATION_ID, DEMO_USER } from "@/data/mock/organization";
import { isLiveMode } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

import { SESSION_COOKIE, type Session } from "./session";

/**
 * Auth boundary. Two sources:
 *  - demo: SESSION_COOKIE=demo → synthetic demo session (mock data)
 *  - live: Supabase Auth cookies → real session resolved from
 *    organization_members (empty organizationId until onboarding)
 */
export interface AuthProvider {
  getSession(): Promise<Session | null>;
  signInDemo(): Promise<Session>;
  signOut(): Promise<void>;
}

const ONE_WEEK = 60 * 60 * 24 * 7;

async function getDemoSession(store: Awaited<ReturnType<typeof cookies>>): Promise<Session | null> {
  if (store.get(SESSION_COOKIE)?.value !== "demo") return null;
  return {
    user: DEMO_USER,
    organizationId: DEMO_ORGANIZATION_ID,
    mode: "demo",
  };
}

export const auth: AuthProvider = {
  async getSession() {
    const store = await cookies();
    const demo = await getDemoSession(store);
    if (demo) return demo;

    if (!isLiveMode()) return null;
    const supabase = await createSupabaseServer();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, role, organizations(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const orgId = (membership?.organization_id as string | undefined) ?? "";
    const role = (membership?.role as Session["user"]["role"] | undefined) ?? "member";

    return {
      user: {
        id: user.id,
        name:
          (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
          user.email?.split("@")[0] ||
          "User",
        email: user.email ?? "",
        organizationId: orgId,
        role,
      },
      organizationId: orgId,
      mode: "live",
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
    if (isLiveMode()) {
      const supabase = await createSupabaseServer();
      await supabase.auth.signOut();
    }
  },
};
