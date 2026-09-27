import { getTranslations } from "next-intl/server";

/**
 * Single-contract read failure state. Rendered when the checked read
 * reports "unavailable" — a failed read is never shown as "not found".
 */
export async function ContractLoadFailed() {
  const t = await getTranslations("common");
  return (
    <p role="status" className="rounded-sm border border-line bg-bg px-4 py-3 text-sm text-muted">
      {t("contractLoadFailed")}
    </p>
  );
}
