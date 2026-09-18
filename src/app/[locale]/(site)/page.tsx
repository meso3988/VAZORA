import { setRequestLocale } from "next-intl/server";

import { Hero } from "@/components/site/home/hero";
import {
  AssessorIntro,
  ClaimReadiness,
  FinalCta,
  Officer,
  OneEngine,
  Shift,
  Trust,
} from "@/components/site/home/sections";
import { asLocale } from "@/i18n/params";

export default async function HomePage(props: PageProps<"/[locale]">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  return (
    <div className="flagship-home">
      <Hero />
      <Shift />
      <Officer />
      <ClaimReadiness />
      <AssessorIntro />
      <OneEngine />
      <Trust />
      <FinalCta />
    </div>
  );
}
