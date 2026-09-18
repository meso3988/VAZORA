import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { getTranslations } from "next-intl/server";

import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-mineral-arabic",
  display: "swap",
});

export default async function SiteLayout({
  children,
}: LayoutProps<"/[locale]">) {
  const t = await getTranslations("common");
  return (
    <div
      data-theme="light"
      className={`mineral-site ${arabic.variable} flex min-h-dvh flex-col bg-bg text-fg`}
    >
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:text-accent-fg"
      >
        {t("skipToContent")}
      </a>
      <SiteHeader />
      <main id="content" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
