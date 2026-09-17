import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Eyebrow } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { auth } from "@/data/auth/provider";
import { redirect } from "@/i18n/navigation";
import { asLocale } from "@/i18n/params";

import { createOrganization } from "./actions";

export async function generateMetadata(props: PageProps<"/[locale]/onboarding">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "onboarding" });
  return { title: t("title") };
}

export default async function OnboardingPage(props: PageProps<"/[locale]/onboarding">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("onboarding");

  const session = await auth.getSession();
  if (!session || session.mode !== "live") {
    return redirect({ href: "/login", locale });
  }
  if (session.organizationId) {
    return redirect({ href: "/app/dashboard", locale });
  }

  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : "";

  return (
    <section className="relative overflow-hidden">
      <div className="container-x relative flex justify-center pt-16 pb-24 lg:pt-24">
        <div className="flex w-full max-w-md flex-col gap-8">
          <div className="flex flex-col gap-3">
            <Eyebrow>{t("eyebrow")}</Eyebrow>
            <h1 className="display text-[1.75rem] sm:text-[2.125rem]">{t("title")}</h1>
            <p className="text-sm text-muted">{t("body")}</p>
          </div>

          <form action={createOrganization} className="surface-float flex flex-col gap-5 p-6 sm:p-8">
            <input type="hidden" name="locale" value={locale} />
            {error === "create" && (
              <p className="rounded-sm border border-missing/40 bg-missing/10 px-3 py-2 text-xs text-missing">{t("errorCreate")}</p>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-muted">{t("orgName")}</span>
              <input
                className="h-11 w-full rounded-sm border border-line bg-bg px-3 text-sm text-fg placeholder:text-faint"
                type="text"
                name="name"
                required
                minLength={2}
                maxLength={120}
                placeholder={t("orgNamePlaceholder")}
              />
            </label>
            <Button type="submit" size="lg" className="w-full">{t("submit")}</Button>
            <p className="text-center text-xs text-faint">{t("ownerNote")}</p>
          </form>
        </div>
      </div>
    </section>
  );
}
