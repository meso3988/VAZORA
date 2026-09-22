import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { Empty, Mono, Panel } from "@/components/app/primitives";
import { requireTenant } from "@/data/context";
import { lt, validDate } from "@/lib/utils";
import { asLocale } from "@/i18n/params";

export default async function ContractActivity(props: PageProps<"/[locale]/app/contracts/[id]/activity">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.activity");
  const f = await getFormatter();
  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();
  const activity = await db.activity.list(orgId, { contractId: id });

  return (
    <Panel title={t("title")} tone="graphite">
      {activity.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <ol className="relative ms-5 border-s border-line py-2">
          {activity.map((a) => (
            <li key={a.id} className="relative flex flex-col gap-0.5 py-3 ps-6 pe-5">
              <span aria-hidden className="absolute top-[1.15rem] -start-[5px] size-2.5 rounded-full border-2 border-bg bg-line-strong" />
              <span className="text-sm">
                <span className="font-medium">{a.actor}</span> {lt(a.action, locale)}
                {a.target && <> <Mono>{a.target}</Mono></>}
              </span>
              <span className="text-xs text-muted">{validDate(a.at) ? f.dateTime(validDate(a.at)!, "medium") : "—"}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
