import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/data/auth/session";
import { routing } from "@/i18n/routing";

const handleI18n = createIntlMiddleware(routing);

const APP_PATH = /^\/(en|ar)\/app(\/|$)/;

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (APP_PATH.test(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    const locale = pathname.split("/")[1];
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return handleI18n(request);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
