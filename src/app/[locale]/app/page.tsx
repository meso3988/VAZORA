import { redirect } from "@/i18n/navigation";
import { asLocale } from "@/i18n/params";

export default async function AppIndex(props: PageProps<"/[locale]/app">) {
  const locale = asLocale((await props.params).locale);
  redirect({ href: "/app/dashboard", locale });
}
