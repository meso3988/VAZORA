import { Bot, MessageSquarePlus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { startOfficerConversation } from "@/app/[locale]/app/agent/actions";
import { Panel } from "@/components/app/primitives";

/**
 * Contract-scoped conversation entry point. Live sessions get a real working
 * path — the existing conversation engine opens a thread scoped to this
 * contract and lands on /app/agent. Demo sessions show an honest preview:
 * a disabled affordance labelled as preview, not a fake working input.
 */
export async function OfficerAsk({ contractId, demo, locale }: { contractId: string; demo: boolean; locale: string }) {
  const t = await getTranslations("app.officer");
  return (
    <Panel title={t("ask")} className="self-start">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3 rounded-md border border-line bg-bg p-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-fg text-bg"><Bot size={14} /></span>
          <p className="text-sm leading-relaxed text-muted">{t("subtitle")}</p>
        </div>
        {demo ? (
          <p className="text-xs leading-relaxed text-faint">{t("askDemo")}</p>
        ) : (
          <form action={startOfficerConversation}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="contractId" value={contractId} />
            <button
              type="submit"
              className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-line bg-fg px-3 text-sm font-medium text-bg transition-colors hover:bg-fg/90"
            >
              <MessageSquarePlus size={15} strokeWidth={1.75} aria-hidden />
              {t("askOpen")}
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}
