import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import type { Indicator, IndicatorName } from "@/domain/indicators";
import { cn, formatMoney } from "@/lib/utils";

export type IndicatorFormat = "number" | "percent" | { money: string };

export const indicatorValue = (i: Indicator | undefined): number | null => (i?.state === "value" ? i.value : null);

/** Full explanation for a non-value state (undefined for a real value). */
export async function indicatorNote(i: Indicator | undefined): Promise<string | undefined> {
  const t = await getTranslations("app.indicator");
  if (!i) return t("unavailable");
  return i.state === "value" ? undefined : t(i.state === "not_calculated" ? "notCalculated" : i.state);
}

/**
 * One indicator: the formatted value when it was counted, otherwise a dash
 * (or a short label) that says why — never a placeholder zero. Tagged with
 * data-indicator / data-state so tests can tell the states apart.
 */
export async function IndicatorValue({
  name,
  indicator,
  format = "number",
  short = false,
  compact = false,
  className,
}: {
  name: IndicatorName;
  indicator: Indicator | undefined;
  format?: IndicatorFormat;
  /** show a short visible label instead of a dash (table cells, lifecycle) */
  short?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const state = indicator?.state ?? "unavailable";
  if (indicator?.state === "value") {
    const f = await getFormatter();
    const v = indicator.value;
    const text = format === "number"
      ? f.number(v, "integer")
      : format === "percent"
        ? f.number(v, "percent")
        : formatMoney(v, await getLocale(), format.money, { compact });
    return <span data-indicator={name} data-state="value" className={className}>{text}</span>;
  }
  const t = await getTranslations("app.indicator");
  const key = state === "not_calculated" ? "notCalculated" : state;
  const full = t(key as "notCalculated" | "deferred" | "unavailable" | "incomplete");
  return (
    // `relative` keeps the sr-only text inside scrolling tables instead of
    // widening the page.
    <span data-indicator={name} data-state={state} title={full} className={cn(className, "relative text-muted")}>
      {short ? <span className="text-[11px] font-sans">{t(`short.${key}` as "short.notCalculated")}</span> : <span aria-hidden>—</span>}
      <span className="sr-only">{full}</span>
    </span>
  );
}
