import { setRequestLocale } from "next-intl/server";

import { AppShell } from "@/components/app/shell";
import { auth } from "@/data/auth/provider";
import { getDataProvider } from "@/data";
import { redirect } from "@/i18n/navigation";
import { lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export default async function AppLayout(props: LayoutProps<"/[locale]/app">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);

  const session = await auth.getSession();
  if (!session) return redirect({ href: "/login", locale });

  // Live users without an organization go through onboarding first.
  if (session.mode === "live" && !session.organizationId) {
    return redirect({ href: "/onboarding", locale });
  }

  const org = session.organizationId
    ? await getDataProvider().organizations.getById(session.organizationId)
    : null;

  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      organizationName={org ? lt(org.name, locale) : ""}
      demo={session.mode === "demo"}
    >
      {props.children}
    </AppShell>
  );
}
