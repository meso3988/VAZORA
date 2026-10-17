import { getFormatter, getTranslations } from "next-intl/server";

import { recordCycleCompletion, voidCycleCompletion } from "@/app/[locale]/app/contracts/[id]/cycle-actions";
import { Panel } from "@/components/app/primitives";
import type { CycleSettlement, SettlementsRead } from "@/data/supabase/cycle-settlements";
import type { Evidence, Obligation } from "@/domain/types";
import { scheduleCycles, usesCycleSettlements } from "@/lib/officer/schedule";
import { addDays, daysBetween } from "@/lib/officer/time";
import { lt } from "@/lib/utils";

const SHOWN = 12;

/**
 * Cycles of each recurring obligation with their recorded completions. One
 * record covers one cycle; earlier cycles with no record are stated as "no
 * completion documented in VAZORA", never as "not done". Authorized members
 * (owner/admin) get the record / void forms; others see the records only.
 */
export async function CycleRecords({
  locale, contractId, contract, obligations, settlements, today, evidence, canRecord, currentUserId,
}: {
  locale: string;
  contractId: string;
  contract: { startDate?: string | null; endDate?: string | null };
  obligations: Obligation[];
  settlements: SettlementsRead;
  today: string | null;
  evidence: Evidence[];
  canRecord: boolean;
  currentUserId: string;
}) {
  const recurring = obligations.filter((o) => usesCycleSettlements({ dueDateNormalized: o.dueDate || null, dueRuleNormalized: o.dueRuleNormalized }));
  if (!recurring.length || !today) return null;
  const t = await getTranslations("app.cycles");
  const f = await getFormatter();
  const day = (d: string) => f.dateTime(new Date(`${d}T00:00:00Z`), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const when = (iso: string) => f.dateTime(new Date(iso), "medium");
  const who = (id: string) => (id === currentUserId ? t("byYou") : t("byMember"));
  const input = "h-8 rounded-md border border-line bg-elevated px-2 text-xs";

  return (
    <Panel title={t("title")} hint={t("hint")} tone="sky">
      <div className="flex flex-col divide-y divide-line" data-section="cycle-records">
        {!canRecord && <p className="px-5 py-3 text-xs text-muted">{t("notAuthorized")}</p>}
        {recurring.map((o) => {
          const cycles = scheduleCycles({ dueRuleNormalized: o.dueRuleNormalized, contractStart: contract.startDate, contractEnd: contract.endDate, until: addDays(today, 31) });
          const upcoming = cycles.filter((c) => daysBetween(today, c) > 0).slice(0, 1);
          const due = cycles.filter((c) => daysBetween(c, today) >= 0);
          const shown = [...due.slice(-SHOWN), ...upcoming].reverse();
          const records = settlements.ok ? settlements.byObligation.get(o.id) ?? [] : [];
          const evidenceForOb = evidence.filter((e) => e.obligationId === o.id);
          return (
            <div key={o.id} className="flex flex-col gap-2 px-5 py-4" data-cycle-obligation={o.id}>
              <p className="text-sm font-medium">{lt(o.requirement, locale)}</p>
              {!settlements.ok ? (
                <p data-cycles-unavailable className="text-xs text-partial">{t("unavailable")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {shown.map((c) => {
                    const active = records.find((r) => r.cycleDueDate === c && r.status === "active");
                    const voided = records.filter((r) => r.cycleDueDate === c && r.status === "voided");
                    const isUpcoming = daysBetween(today, c) > 0;
                    return (
                      <li key={c} data-cycle={c} data-cycle-state={active ? "recorded" : "none"} className="flex flex-col gap-1.5 rounded-md border border-line/70 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium">{t("cycleDue", { date: day(c) })}</span>
                          {isUpcoming && <span className="text-faint">{t("upcoming")}</span>}
                          <span className={active ? "text-verified" : "text-muted"}>{active ? t("recorded") : t("noRecord")}</span>
                        </div>
                        {active && <RecordLine r={active} t={t} day={day} when={when} who={who} evidence={evidenceForOb} />}
                        {voided.map((r) => (
                          <p key={r.id} data-cycle-voided className="text-[11px] text-faint line-through decoration-faint/60">
                            {t("voided", { who: who(r.voidedBy ?? ""), when: when(r.voidedAt ?? r.recordedAt), reason: r.voidReason ?? "" })}
                          </p>
                        ))}
                        {canRecord && active && (
                          <form action={voidCycleCompletion} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="contractId" value={contractId} />
                            <input type="hidden" name="settlementId" value={active.id} />
                            <input name="reason" required placeholder={t("voidReason")} aria-label={t("voidReason")} className={`${input} min-w-0 flex-1`} />
                            <button type="submit" className="h-8 rounded-sm border border-missing/40 px-2.5 text-xs text-missing hover:bg-missing/5">{t("void")}</button>
                          </form>
                        )}
                        {canRecord && !active && (
                          <form action={recordCycleCompletion} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="locale" value={locale} />
                            <input type="hidden" name="contractId" value={contractId} />
                            <input type="hidden" name="obligationId" value={o.id} />
                            <input type="hidden" name="cycleDueDate" value={c} />
                            <input type="date" name="completedOn" max={today} aria-label={t("completedOnLabel")} title={t("completedOnLabel")} className={input} />
                            <input name="note" required placeholder={t("note")} aria-label={t("note")} className={`${input} min-w-0 flex-1`} />
                            <select name="evidenceItemId" defaultValue="" aria-label={t("evidence")} className={input}>
                              <option value="">{t("noEvidence")}</option>
                              {evidenceForOb.map((e) => <option key={e.id} value={e.id}>{e.fileName} · v{e.version}</option>)}
                            </select>
                            <button type="submit" className="h-8 rounded-sm border border-line bg-fg px-2.5 text-xs font-medium text-bg hover:bg-fg/90">{t("record")}</button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                  {due.length > SHOWN && <li className="text-[11px] text-faint">{t("olderCycles", { count: due.length - SHOWN })}</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function RecordLine({ r, t, day, when, who, evidence }: {
  r: CycleSettlement;
  t: Awaited<ReturnType<typeof getTranslations<"app.cycles">>>;
  day: (d: string) => string;
  when: (iso: string) => string;
  who: (id: string) => string;
  evidence: Evidence[];
}) {
  const ev = evidence.find((e) => e.id === r.evidenceItemId);
  return (
    <div className="flex flex-col gap-0.5 text-[11px] text-muted" data-cycle-recorded-by={r.recordedBy}>
      {r.completedOn && <span>{t("completedOn", { date: day(r.completedOn) })}</span>}
      <span>{t("recordedBy", { who: who(r.recordedBy), when: when(r.recordedAt) })}</span>
      <span dir="auto">{r.note}</span>
      {r.evidenceItemId && <span>{t("evidence")}: {ev ? `${ev.fileName} · v${ev.version}` : r.evidenceItemId.slice(0, 8)}</span>}
    </div>
  );
}
