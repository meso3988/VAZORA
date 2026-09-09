import { setRequestLocale } from "next-intl/server";

import { Hero } from "@/components/site/home/hero";
import {
  AssessorIntro,
  ClaimReadiness,
  EvidenceQuality,
  FinalCta,
  Lifecycle,
  Officer,
  Problem,
  Shift,
  Trust,
} from "@/components/site/home/sections";
import { asLocale } from "@/i18n/params";

export default async function HomePage(props: PageProps<"/[locale]">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);

  return (
    <>
      <Hero />
      <Problem />
      <Shift />
      <Lifecycle />
      <EvidenceQuality />
      <Officer />
      <ClaimReadiness />
      <AssessorIntro />
      <Trust />
      <FinalCta />
    </>
  );
}
