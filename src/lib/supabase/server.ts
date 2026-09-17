import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { requireSupabaseEnv } from "./env";

/**
 * Supabase client for React Server Components and Server Actions. Cookies are
 * read from the request store; cookie writes inside RSC are silently dropped
 * by Next, which @supabase/ssr tolerates — session refresh happens in the
 * proxy (src/proxy.ts) instead.
 */
export async function createSupabaseServer() {
  const { url, anonKey } = requireSupabaseEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component — proxy refreshes sessions.
        }
      },
    },
  });
}
