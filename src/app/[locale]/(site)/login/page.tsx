import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/surface";
import { Link } from "@/i18n/navigation";

import { enterDemo, signIn, signUp } from "./actions";
import { asLocale } from "@/i18n/params";

export async function generateMetadata(props: PageProps<"/[locale]/login">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "login" });
  return { title: t("title") };
}

const field =
  "h-11 w-full rounded-sm border border-line bg-bg px-3 text-sm text-fg placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-60";

export default async function LoginPage(props: PageProps<"/[locale]/login">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("login");
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "";
  const error = typeof sp.error === "string" ? sp.error : "";
  const notice = typeof sp.notice === "string" ? sp.notice : "";
  const mode = sp.mode === "signup" ? "signup" : "signin";

  const errorKey =
    error === "credentials" ? "errorCredentials"
    : error === "signup" ? "errorSignup"
    : error === "weakPassword" ? "errorWeakPassword"
    : error === "config" ? "errorConfig"
    : null;

  return (
    <section className="relative overflow-hidden">
      <div className="container-x relative flex justify-center pt-16 pb-24 lg:pt-24">
        <div className="flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="display text-[1.75rem] sm:text-[2.125rem]">
              {mode === "signup" ? t("titleSignup") : t("title")}
            </h1>
          </div>

          <div className="surface-float flex flex-col gap-5 p-6 sm:p-8">
            {errorKey && (
              <p className="rounded-sm border border-missing/40 bg-missing/10 px-3 py-2 text-xs text-missing">{t(errorKey)}</p>
            )}
            {notice === "confirmEmail" && (
              <p className="rounded-sm border border-partial/40 bg-partial/10 px-3 py-2 text-xs text-partial">{t("noticeConfirmEmail")}</p>
            )}

            <form action={mode === "signup" ? signUp : signIn} className="flex flex-col gap-4">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={next} />
              {mode === "signup" && (
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted">{t("fullName")}</span>
                  <input className={field} type="text" name="fullName" required minLength={2} autoComplete="name" />
                </label>
              )}
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted">{t("email")}</span>
                <input className={field} type="email" name="email" required placeholder="name@company.com" dir="ltr" autoComplete="email" />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted">{t("password")}</span>
                <input
                  className={field}
                  type="password"
                  name="password"
                  required
                  minLength={mode === "signup" ? 8 : 6}
                  placeholder="••••••••"
                  dir="ltr"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
              </label>
              <Button type="submit" size="lg" className="w-full">
                {mode === "signup" ? t("submitSignup") : t("submit")}
                <ArrowRight size={16} className="rtl:-scale-x-100" />
              </Button>
            </form>

            <p className="text-center text-xs text-muted">
              {mode === "signup" ? t("haveAccount") : t("noAccountYet")}
              {" "}
              <a
                href={`/${locale}/login?mode=${mode === "signup" ? "signin" : "signup"}${next ? `&next=${encodeURIComponent(next)}` : ""}`}
                className="text-fg underline underline-offset-4"
              >
                {mode === "signup" ? t("switchToSignIn") : t("switchToSignUp")}
              </a>
            </p>

            <div className="flex items-center gap-3 text-[11px] text-faint">
              <span className="h-px flex-1 bg-line" />
              {t("demoDivider")}
              <span className="h-px flex-1 bg-line" />
            </div>
            <form action={enterDemo}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="next" value={next} />
              <Button type="submit" variant="secondary" size="lg" className="w-full">
                {t("demo")}
                <ArrowRight size={16} className="rtl:-scale-x-100" />
              </Button>
            </form>
            <p className="text-center text-xs text-muted">{t("demoHint")}</p>
          </div>

          <p className="text-center text-sm text-muted">
            {t("noAccount")}{" "}
            <Link href="/demo" className="text-fg underline underline-offset-4">{t("requestAccess")}</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
