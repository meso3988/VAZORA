import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader, Panel } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { requireTenant } from "@/data/context";
import { auth } from "@/data/auth/provider";
import { asLocale } from "@/i18n/params";

import { createContract } from "./actions";

export async function generateMetadata(props: PageProps<"/[locale]/app/contracts/new">): Promise<Metadata> {
  const locale = asLocale((await props.params).locale);
  const t = await getTranslations({ locale, namespace: "app.contractNew" });
  return { title: t("title") };
}

const field =
  "h-10 w-full rounded-md border border-line bg-elevated px-3 text-sm text-fg placeholder:text-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg/30";
const label = "flex flex-col gap-1.5";

export default async function NewContractPage(props: PageProps<"/[locale]/app/contracts/new">) {
  const locale = asLocale((await props.params).locale);
  setRequestLocale(locale);
  const t = await getTranslations("app.contractNew");
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error : "";

  const session = await auth.getSession();
  const isDemo = session?.mode === "demo";
  const { orgId, db } = await requireTenant();
  const projects = await db.organizations.listProjects(orgId);

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Panel tone="sky" title={t("panelTitle")}>
        <form action={createContract} className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <input type="hidden" name="locale" value={locale} />

          {isDemo && (
            <p className="md:col-span-2 rounded-md border border-partial/40 bg-partial/10 px-3 py-2 text-xs text-partial">
              {t("demoNotice")}
            </p>
          )}
          {error === "duplicate" && (
            <p className="md:col-span-2 rounded-md border border-missing/40 bg-missing/10 px-3 py-2 text-xs text-missing">{t("errorDuplicate")}</p>
          )}
          {error === "invalid" && (
            <p className="md:col-span-2 rounded-md border border-missing/40 bg-missing/10 px-3 py-2 text-xs text-missing">{t("errorInvalid")}</p>
          )}
          {error === "create" && (
            <p className="md:col-span-2 rounded-md border border-missing/40 bg-missing/10 px-3 py-2 text-xs text-missing">{t("errorCreate")}</p>
          )}

          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.title")}</span>
            <input className={field} name="title" required minLength={2} maxLength={200} disabled={isDemo} />
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.number")}</span>
            <input className={field} name="contractNumber" required maxLength={60} dir="ltr" disabled={isDemo} />
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.client")}</span>
            <input className={field} name="clientName" maxLength={200} disabled={isDemo} />
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.project")}</span>
            <select className={field} name="projectId" disabled={isDemo}>
              <option value="">{t("fields.noProject")}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{locale === "ar" ? p.name.ar : p.name.en}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.value")}</span>
            <input className={field} name="contractValue" type="number" min="0" step="0.01" dir="ltr" disabled={isDemo} />
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.currency")}</span>
            <select className={field} name="currency" disabled={isDemo}>
              <option value="SAR">SAR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="AED">AED</option>
            </select>
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.startDate")}</span>
            <input className={field} name="startDate" type="date" disabled={isDemo} />
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.endDate")}</span>
            <input className={field} name="endDate" type="date" disabled={isDemo} />
          </label>
          <label className={label}>
            <span className="text-xs font-medium text-muted">{t("fields.status")}</span>
            <select className={field} name="status" disabled={isDemo}>
              <option value="active">{t("statuses.active")}</option>
              <option value="mobilizing">{t("statuses.mobilizing")}</option>
              <option value="closeout">{t("statuses.closeout")}</option>
            </select>
          </label>

          <div className="flex items-center justify-end gap-3 md:col-span-2">
            <Button type="submit" disabled={isDemo}>{t("submit")}</Button>
          </div>
        </form>
      </Panel>
    </>
  );
}
