import { getTranslations } from "next-intl/server";

import { Panel } from "@/components/app/primitives";
import { ButtonLink } from "@/components/ui/button";

export default async function ContractNotFound() {
  const t = await getTranslations("app");
  return (
    <Panel>
      <div className="flex flex-col items-start gap-4 p-8">
        <p className="text-sm text-muted">{t("notFound")}</p>
        <ButtonLink href="/app/contracts" variant="secondary" size="sm">{t("nav.contracts")}</ButtonLink>
      </div>
    </Panel>
  );
}
