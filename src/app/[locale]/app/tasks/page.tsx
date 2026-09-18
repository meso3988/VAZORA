import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Mono, PageHeader, Panel } from "@/components/app/primitives";
import { StatusPill } from "@/components/ui/status";
import { requireTenant } from "@/data/context";
import { daysBetween, lt } from "@/lib/utils";
import { asLocale } from "@/i18n/params";
import { DEMO_TODAY } from "@/data/mock/organization";

export async function generateMetadata(props: PageProps<"/[locale]/app/tasks">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.tasks" });
  return { title: t("title") };
}

export default async function TasksPage(props: PageProps<"/[locale]/app/tasks">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.tasks");
  const f = await getFormatter();
  const { orgId, db } = await requireTenant();
  const [actions, contracts] = await Promise.all([db.actions.list(orgId), db.contracts.list(orgId)]);
  const titles = Object.fromEntries(contracts.map((c) => [c.id, lt(c.title, locale)]));

  const mine = actions.filter((a) => a.ownerName && a.status !== "done");
  const overdue = mine.filter((a) => daysBetween(DEMO_TODAY, a.dueDate) < 0 || daysBetween(DEMO_TODAY, a.dueDate) <= 3);
  const waitingOnClient = mine.filter((a) => a.title.en.toLowerCase().includes("client") || a.title.en.toLowerCase().includes("employer"));

  const groups: { key: "mine" | "overdue" | "waitingOnClient" | "done"; items: typeof actions }[] = [
    { key: "mine", items: mine },
    { key: "overdue", items: overdue },
    { key: "waitingOnClient", items: waitingOnClient },
    { key: "done", items: actions.filter((a) => a.status === "done") },
  ];

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {groups.map(({ key, items }) => (
          <Panel key={key} title={t(`groups.${key}`)} tone={key === "mine" ? "amber" : key === "overdue" ? "rose" : key === "waitingOnClient" ? "sky" : "emerald"}
            action={<Mono className="text-[11px] text-faint">{items.length}</Mono>}
          >
            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{t("empty")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 px-5 py-3">
                    <div className="flex items-center gap-2">
                      <StatusPill status={a.status === "done" ? "verified" : a.status === "in_progress" ? "partial" : "pending"} subtle />
                      <span className="flex-1 truncate text-sm">{lt(a.title, locale)}</span>
                      <Mono className="text-[11px] text-muted">{f.dateTime(new Date(a.dueDate), "short")}</Mono>
                    </div>
                    <span className="ps-7 text-xs text-muted">
                      {a.ownerName}{contracts.length ? <> · {titles[a.contractId ?? ""]}</> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
    </>
  );
}
