import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/data/auth/session";
import { routing } from "@/i18n/routing";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

const handleI18n = createIntlMiddleware(routing);

const APP_PATH = /^\/(en|ar)\/app(\/|$)/;
const ONBOARDING_PATH = /^\/(en|ar)\/onboarding(\/|$)/;

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Refresh the live Supabase session on every request when configured.
  const live = await refreshSupabaseSession(request);

  if (APP_PATH.test(pathname)) {
    const hasDemo = request.cookies.get(SESSION_COOKIE)?.value === "demo";
    if (!hasDemo && !live?.hasSession) {
      const locale = pathname.split("/")[1];
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/login`;
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (ONBOARDING_PATH.test(pathname) && live && !live.hasSession) {
    const locale = pathname.split("/")[1];
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    return NextResponse.redirect(url);
  }

  // next-intl produces the final response; keep refreshed auth cookies on it.
  const response = handleI18n(request);
  if (live) {
    live.response.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value, cookie);
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
