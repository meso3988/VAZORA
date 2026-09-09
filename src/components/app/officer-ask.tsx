import { Bot, SendHorizontal } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Panel } from "@/components/app/primitives";

/** Conversational entry point. Intentionally inert in Phase 1; the AIProvider boundary wires it later. */
export async function OfficerAsk() {
  const t = await getTranslations("app.officer");
  return (
    <Panel title={t("ask")} className="self-start">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3 rounded-md border border-line bg-bg p-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-fg text-bg"><Bot size={14} /></span>
          <p className="text-sm leading-relaxed text-muted">{t("subtitle")}</p>
        </div>
        <div className="flex h-11 items-center gap-2 rounded-sm border border-line bg-bg px-3 opacity-70">
          <input
            disabled
            aria-disabled
            placeholder={t("askPlaceholder")}
            className="w-full bg-transparent text-sm placeholder:text-faint"
          />
          <SendHorizontal size={16} className="text-faint rtl:-scale-x-100" />
        </div>
        <p className="text-xs leading-relaxed text-faint">{t("askHint")}</p>
      </div>
    </Panel>
  );
}
