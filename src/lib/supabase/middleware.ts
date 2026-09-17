import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseEnv } from "./env";

/**
 * Edge-safe session refresh for the proxy: reads Supabase auth cookies from
 * the request, writes refreshed ones onto the response, and reports whether a
 * live session exists. Returns `null` when live mode is off so the demo
 * cookie gate keeps working unchanged.
 */
export async function refreshSupabaseSession(request: NextRequest): Promise<{
  response: NextResponse;
  hasSession: boolean;
} | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, hasSession: Boolean(user) };
}
