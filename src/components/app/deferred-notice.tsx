import { CircleSlash } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Panel } from "@/components/app/primitives";

export type DeferredFeature = "risks" | "claims";

/**
 * A capability that is not part of this release, stated as such — never an
 * empty list that reads as "there are none".
 */
export async function DeferredNotice({ feature, framed = true }: { feature: DeferredFeature; framed?: boolean }) {
  const t = await getTranslations("app.deferred");
  const body = (
    <div data-deferred-notice={feature} role="status" className="flex items-start gap-3 px-5 py-4">
      <CircleSlash size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">{t(`${feature}.title`)}</p>
        <p className="text-xs leading-relaxed text-muted">{t(`${feature}.body`)}</p>
      </div>
    </div>
  );
  return framed ? <Panel>{body}</Panel> : body;
}
