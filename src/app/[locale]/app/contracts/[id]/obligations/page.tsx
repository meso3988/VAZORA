import { notFound } from "next/navigation";

import { ContractLoadFailed, DataLoadFailed } from "@/components/app/contract-unavailable";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { CycleRecords } from "@/components/app/cycle-records";
import { Panel } from "@/components/app/primitives";
import { ObligationsTable } from "@/components/app/tables";
import { readContract, readEvidenceList, readObligationList, requireTenant } from "@/data/context";
import { readObligationStates, withStates } from "@/data/obligation-states";
import { roleHasCapability, type AnyRole } from "@/lib/officer/authority";
import { createSupabaseServer } from "@/lib/supabase/server";
import { asLocale } from "@/i18n/params";

export default async function ContractObligations(props: PageProps<"/[locale]/app/contracts/[id]/obligations">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app.obligations");
  const tc = await getTranslations("app.cycles");
  const f = await getFormatter();
  const sp = await props.searchParams;
  const { session, orgId, db } = await requireTenant();
  const read = await readContract(db, orgId, id, session.mode === "demo");
  if (read.status === "unavailable") return <ContractLoadFailed />;
  if (read.status === "not_found") notFound();
  const contract = read.contract;
  const isDemo = session.mode === "demo";
  const obligations = await readObligationList(db, orgId, isDemo, { contractId: id });
  if (!obligations.ok) return <DataLoadFailed message="dataLoadFailed" />;
  const states = await readObligationStates({ isDemo, obligations: obligations.obligations, orgId, contractId: id, contract: { startDate: contract.startDate, endDate: contract.endDate }, userId: session.user.id, locale });

  // Recording a cycle completion is an owner/admin capability, read from the
  // membership row server-side (the forms are also re-authorized on submit).
  let canRecord = false;
  let evidence: Awaited<ReturnType<typeof readEvidenceList>> = { ok: true, evidence: [] } as never;
  if (!isDemo && states) {
    const supabase = await createSupabaseServer();
    const [{ data: m }, ev] = await Promise.all([
      supabase.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", session.user.id).maybeSingle(),
      readEvidenceList(db, orgId, false, { contractId: id }),
    ]);
    canRecord = roleHasCapability((m?.role ?? null) as AnyRole | null, "obligation.settle_cycle");
    evidence = ev;
  }
  const recorded = typeof sp.cycleRecorded === "string" ? sp.cycleRecorded : null;
  const voided = typeof sp.cycleVoided === "string";
  const error = typeof sp.cycleError === "string" ? sp.cycleError : null;
  const errorKey = error && tc.has(`errors.${error}` as "errors.write_failed") ? `errors.${error}` : error ? "errors.write_failed" : null;

  // Demo fixtures list a sample of an illustrative total; a live list is the
  // complete read, so its own length is the only honest count.
  const shown = obligations.obligations.length;
  return (
    <>
      {recorded && (
        <p role="status" data-cycle-notice="recorded" className="rounded-md border border-line bg-elevated px-4 py-2.5 text-xs text-muted">
          {tc("recordedNotice", { date: f.dateTime(new Date(`${recorded}T00:00:00Z`), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) })}
        </p>
      )}
      {voided && <p role="status" data-cycle-notice="voided" className="rounded-md border border-line bg-elevated px-4 py-2.5 text-xs text-muted">{tc("voidedNotice")}</p>}
      {errorKey && <p role="alert" data-cycle-error={error} className="rounded-md border border-missing/40 bg-missing/5 px-4 py-2.5 text-xs text-missing">{tc(errorKey as "errors.write_failed")}</p>}
      <Panel title={t("title")} tone="sky" hint={contract.health ? `${shown} / ${contract.health.obligationsTotal}` : String(shown)}>
        <ObligationsTable obligations={withStates(obligations.obligations, states)} currency={contract.currency} />
      </Panel>
      {states && (
        <CycleRecords
          locale={locale}
          contractId={id}
          contract={{ startDate: contract.startDate, endDate: contract.endDate }}
          obligations={obligations.obligations}
          settlements={states.settlements}
          today={states.today}
          evidence={evidence.ok ? evidence.evidence : []}
          canRecord={canRecord}
          currentUserId={session.user.id}
        />
      )}
    </>
  );
}
