import type { Metadata } from "next";
import { Alexandria, Geist_Mono, Instrument_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { asLocale } from "@/i18n/params";
import { localeMeta, routing } from "@/i18n/routing";

import "../globals.css";

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-alexandria",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: { default: t("title"), template: `%s · VAZORA` },
    description: t("description"),
    applicationName: "VAZORA",
  };
}

export default async function LocaleLayout(props: LayoutProps<"/[locale]">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);

  const meta = localeMeta[locale];

  return (
    <html
      lang={locale}
      dir={meta.dir}
      className={`${instrument.variable} ${alexandria.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider>{props.children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
