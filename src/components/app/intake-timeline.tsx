import { Check } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { Mono, Panel } from "@/components/app/primitives";
import type { Pipeline } from "@/data/mock/pipeline";
import { cn, lt } from "@/lib/utils";

/**
 * Documented intake run of a contract: upload → parse → clauses → obligations →
 * owners → evidence requests → active. Every stage carries its exact timestamp
 * and duration, mirroring the public evidence loop inside the client workspace.
 */
export async function IntakeTimeline({ pipeline }: { pipeline: Pipeline }) {
  const locale = await getLocale();
  const t = await getTranslations("app.pipeline");
  const f = await getFormatter();
  const totalSeconds = pipeline.stages.reduce((sum, stage) => sum + stage.seconds, 0);
  const time = (iso: string) => f.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const duration = (seconds: number) =>
    seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : `0:${String(seconds).padStart(2, "0")}`;

  return (
    <Panel
      title={t("title", { file: lt(pipeline.file, locale) })}
      hint={t("hint", { by: pipeline.uploadedBy, total: duration(totalSeconds), date: f.dateTime(new Date(pipeline.stages[0].at), "medium") })}
    >
      <ol className="grid grid-cols-1 gap-0 p-3 sm:grid-cols-4 lg:grid-cols-7">
        {pipeline.stages.map((stage, i) => {
          const last = i === pipeline.stages.length - 1;
          return (
            <li key={stage.key} className="relative flex min-w-0 gap-3 py-3 sm:flex-col sm:gap-2.5 sm:px-3 sm:py-4">
              {i > 0 && (
                <span
                  aria-hidden
                  className="absolute bottom-full start-[13px] h-3 w-px bg-line-strong sm:bottom-auto sm:start-0 sm:end-3 sm:top-[17px] sm:h-px sm:w-auto"
                />
              )}
              <span className="z-10 mt-0.5 flex shrink-0 items-center sm:mt-0">
                <span
                  className={cn(
                    "flex size-[22px] rotate-45 items-center justify-center rounded-[3px] border",
                    last
                      ? "border-verified bg-verified/10 text-verified shadow-[0_0_12px_rgba(30,138,99,0.35)]"
                      : "border-line-strong bg-bg text-muted",
                  )}
                >
                  <Check size={11} strokeWidth={3} className="-rotate-45" />
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium">{t(`stages.${stage.key}.label`)}</span>
                  <Mono className="text-[10px] text-faint">{time(stage.at)}</Mono>
                </span>
                <span className="text-[11px] leading-snug text-muted">
                  {t(`stages.${stage.key}.detail`, { count: stage.count ?? 0 })}
                </span>
                {stage.seconds > 0 && (
                  <Mono className="mt-0.5 w-fit rounded-sm border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-muted">
                    +{duration(stage.seconds)}
                  </Mono>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
