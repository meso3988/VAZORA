import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/surface";
import { Link } from "@/i18n/navigation";

import { enterDemo } from "./actions";
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

  return (
    <section className="relative overflow-hidden">
      <div className="container-x relative flex justify-center pt-16 pb-24 lg:pt-24">
        <div className="flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="display text-[1.75rem] sm:text-[2.125rem]">{t("title")}</h1>
          </div>

          <form action={enterDemo} className="surface-float flex flex-col gap-5 p-6 sm:p-8">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="next" value={next} />
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">{t("email")}</span>
              <input className={field} type="email" disabled placeholder="name@company.com" dir="ltr" />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">{t("password")}</span>
              <input className={field} type="password" disabled placeholder="••••••••" dir="ltr" />
            </label>
            <p className="text-xs text-faint">{t("credentialsUnavailable")}</p>
            <div className="flex items-center gap-3 text-[11px] text-faint">
              <span className="h-px flex-1 bg-line" />
              {t("demoDivider")}
              <span className="h-px flex-1 bg-line" />
            </div>
            <Button type="submit" size="lg" className="w-full">
              {t("demo")}
              <ArrowRight size={16} className="rtl:-scale-x-100" />
            </Button>
            <p className="text-center text-xs text-muted">{t("demoHint")}</p>
          </form>

          <p className="text-center text-sm text-muted">
            {t("noAccount")}{" "}
            <Link href="/demo" className="text-fg underline underline-offset-4">{t("requestAccess")}</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
