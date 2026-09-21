import { Bot, FileSearch, SendHorizontal, User, Wrench } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { OfficerActionCard } from "@/components/app/officer/action-card";
import { Empty, Mono } from "@/components/app/primitives";
import type { OfficerActionView, OfficerMessageView } from "@/domain/officer";
import { Link } from "@/i18n/navigation";

/**
 * Officer conversation thread.
 *
 * Deliberately not a generic chat clone: every assistant turn carries its
 * sources and the tools it actually ran, and proposed actions render as
 * decision cards inline — the operational hierarchy stays visible.
 */
export async function OfficerThread({
  messages,
  actions,
  conversationId,
  locale,
  canApprove,
  askAction,
  approveAction,
  rejectAction,
  providerConfigured,
}: {
  messages: OfficerMessageView[];
  actions: OfficerActionView[];
  conversationId: string;
  locale: string;
  canApprove: boolean;
  askAction: (formData: FormData) => void | Promise<void>;
  approveAction: (formData: FormData) => void | Promise<void>;
  rejectAction: (formData: FormData) => void | Promise<void>;
  providerConfigured: boolean;
}) {
  const t = await getTranslations("app.officer");
  const f = await getFormatter();
  const actionById = new Map(actions.map((a) => [a.id, a]));

  return (
    <div className="flex min-h-0 flex-col">
      <ol className="flex flex-col divide-y divide-line">
        {messages.length === 0 && (
          <li><Empty>{t("threadEmpty")}</Empty></li>
        )}
        {messages.map((m) => (
          <li key={m.id} className="flex gap-3 px-5 py-4">
            <span
              aria-hidden
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm ${
                m.role === "user" ? "bg-fg/10 text-fg" : "bg-fg text-bg"
              }`}
            >
              {m.role === "user" ? <User size={14} strokeWidth={1.75} /> : <Bot size={14} strokeWidth={1.75} />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-faint">
                <span className="font-medium text-muted">
                  {m.role === "user" ? t("you") : t("officerName")}
                </span>
                <span>{f.dateTime(new Date(m.createdAt), "short")}</span>
                {m.model && <Mono className="ms-auto">{m.model}</Mono>}
              </div>

              <p dir="auto" className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>

              {/* sources — validated server-side; invented ones never reach here */}
              {m.citations.length > 0 && (
                <div className="flex flex-col gap-1 rounded-sm border border-line/60 bg-bg/60 p-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted">
                    <FileSearch size={12} strokeWidth={1.75} aria-hidden />
                    {t("sources")}
                  </span>
                  <ul className="flex flex-wrap gap-1.5">
                    {m.citations.map((c) => (
                      <li key={`${c.target}:${c.id}`}>
                        {c.href ? (
                          <Link href={c.href} className="inline-flex items-center rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-fg hover:bg-fg/5">
                            {c.label}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center rounded-sm border border-line bg-bg px-1.5 py-0.5 text-[10px] text-muted">
                            {c.label}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* what the officer actually ran — reasoning is inspectable */}
              {m.toolInvocations.length > 0 && (
                <details className="group">
                  <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-faint hover:text-muted">
                    <Wrench size={11} strokeWidth={1.75} aria-hidden />
                    {t("toolsUsed", { count: m.toolInvocations.length })}
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {m.toolInvocations.map((inv, i) => (
                      <li key={`${inv.tool}-${i}`} className="text-[11px] text-faint">
                        <Mono>{inv.tool}</Mono> · {inv.ok ? inv.summary : `✕ ${inv.summary}`}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {m.proposedActionIds
                .map((id) => actionById.get(id))
                .filter((a): a is OfficerActionView => !!a)
                .map((a) => (
                  <OfficerActionCard
                    key={a.id}
                    action={a}
                    conversationId={conversationId}
                    approveAction={approveAction}
                    rejectAction={rejectAction}
                    locale={locale}
                    canApprove={canApprove}
                  />
                ))}
            </div>
          </li>
        ))}
      </ol>

      <form action={askAction} className="flex items-end gap-2 border-t border-line px-5 py-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="conversationId" value={conversationId} />
        <textarea
          name="question"
          required
          rows={2}
          dir="auto"
          disabled={!providerConfigured}
          placeholder={providerConfigured ? t("askPlaceholder") : t("providerMissing")}
          className="min-h-[44px] w-full resize-y rounded-md border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-faint disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!providerConfigured}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-sm border border-line bg-fg px-3 text-xs font-medium text-bg transition-colors hover:bg-fg/90 disabled:opacity-50"
        >
          <SendHorizontal size={14} strokeWidth={1.75} aria-hidden className="rtl:-scale-x-100" />
          {t("send")}
        </button>
      </form>
    </div>
  );
}
