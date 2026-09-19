import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app/primitives";
import { ReviewBoard } from "@/components/app/review-board";
import { auth } from "@/data/auth/provider";
import { requireTenant } from "@/data/context";
import { Link } from "@/i18n/navigation";
import { lt } from "@/lib/utils";
import { createSupabaseServer } from "@/lib/supabase/server";
import { asLocale } from "@/i18n/params";

export const dynamic = "force-dynamic";

export default async function ReviewPage(props: PageProps<"/[locale]/app/contracts/[id]/review">) {
  const { locale: rawLocale, id } = await props.params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const f = await getFormatter();
  const sp = await props.searchParams;

  const session = await auth.getSession();
  if (session?.mode !== "live") notFound();

  const { orgId, db } = await requireTenant();
  const contract = await db.contracts.getById(orgId, id);
  if (!contract) notFound();

  const supabase = await createSupabaseServer();

  const [{ data: obligations }, { data: suggestions }] = await Promise.all([
    supabase
      .from("contract_obligations")
      .select(`
        id, title, requirement_text, obligation_type, frequency, due_rule_raw, due_rule_normalized,
        owner_role_suggested, approver_role_suggested, external_dependency,
        payment_linked, payment_link_note, financial_condition, penalty_condition, risk_note,
        submission_required, submission_destination, submission_channel, submission_deadline_rule,
        requires_external_acknowledgement, ai_confidence, field_provenance, review_status,
        needs_source_review, conflict_group_id, activation_status,
        sources:obligation_source_refs(source_snippet, page_number, document_id, clause_id,
          clause:contract_clauses(clause_number, heading, text),
          document:contract_documents(file_name)),
        evidence:obligation_evidence_requirements(id, name, description, evidence_type, required)
      `)
      .eq("organization_id", orgId)
      .eq("contract_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("obligation_assignment_suggestions")
      .select("id, obligation_id, suggestion_kind, suggested_role, suggested_person_name, confidence, reason, approved")
      .eq("organization_id", orgId)
      .is("approved", null),
  ]);

  const rows = obligations ?? [];
  const approved = rows.filter((o) => o.review_status === "approved").length;
  const rejected = rows.filter((o) => o.review_status === "rejected").length;
  const unresolved = rows.length - approved - rejected;
  const missingSource = rows.filter((o) => o.needs_source_review).length;
  const conflicts = rows.filter((o) => o.review_status === "conflict_requires_review").length;

  return (
    <>
      <PageHeader
        title={t("review.title")}
        subtitle={`${lt(contract.title, locale)} · ${f.number(rows.length)} ${t("review.obligations")}`}
        actions={
          <Link href={`/app/contracts/${id}`} className="text-xs text-muted underline underline-offset-4">
            {t("review.back")}
          </Link>
        }
      />

      {typeof sp.bulk === "string" && (
        <p className="rounded-md border border-verified/40 bg-verified/10 px-4 py-2 text-xs text-verified">
          {t("review.bulkApproved", { count: sp.bulk as string })}
        </p>
      )}
      {typeof sp.err === "string" && (
        <p className="rounded-md border border-missing/40 bg-missing/10 px-4 py-2 text-xs text-missing">
          {sp.err === "unresolved"
            ? t("review.errUnresolved", { count: String(sp.n ?? "0") })
            : t("review.errGate")}
        </p>
      )}

      <ReviewBoard
        locale={locale}
        contractId={id}
        obligations={rows as never}
        suggestions={(suggestions ?? []) as never}
        counts={{ approved, rejected, unresolved, missingSource, conflicts }}
        labels={{
          categories: {
            needsReview: t("review.cats.needsReview"),
            high: t("review.cats.high"),
            recurring: t("review.cats.recurring"),
            payment: t("review.cats.payment"),
            financial: t("review.cats.financial"),
            external: t("review.cats.external"),
            submission: t("review.cats.submission"),
            missingSource: t("review.cats.missingSource"),
            conflict: t("review.cats.conflict"),
            approved: t("review.cats.approved"),
            all: t("review.cats.all"),
          },
          states: {
            explicit: t("review.states.explicit"),
            inferred: t("review.states.inferred"),
            unknown: t("review.states.unknown"),
            conflict: t("review.states.conflict"),
          },
          fields: {
            requirement: t("review.fields.requirement"),
            frequency: t("review.fields.frequency"),
            due: t("review.fields.due"),
            evidence: t("review.fields.evidence"),
            owner: t("review.fields.owner"),
            contributor: t("review.fields.contributor"),
            approver: t("review.fields.approver"),
            external: t("review.fields.external"),
            payment: t("review.fields.payment"),
            financial: t("review.fields.financial"),
            penalty: t("review.fields.penalty"),
            submission: t("review.fields.submission"),
            destination: t("review.fields.destination"),
            deadline: t("review.fields.deadline"),
            acknowledge: t("review.fields.acknowledge"),
            source: t("review.fields.source"),
            confidence: t("review.fields.confidence"),
            aiSuggested: t("review.fields.aiSuggested"),
            humanApproved: t("review.fields.humanApproved"),
          },
          actions: {
            approve: t("review.actions.approve"),
            edit: t("review.actions.edit"),
            reject: t("review.actions.reject"),
            bulkApprove: t("review.actions.bulkApprove"),
            activate: t("review.actions.activate"),
            save: t("review.actions.save"),
            cancel: t("review.actions.cancel"),
          },
          summaries: {
            approved: t("review.summary.approved"),
            rejected: t("review.summary.rejected"),
            unresolved: t("review.summary.unresolved"),
            sourceMissing: t("review.summary.sourceMissing"),
            conflicts: t("review.summary.conflicts"),
            exceptionsAssignments: t("review.summary.exceptionsAssignments"),
          },
          activation: {
            title: t("review.activation.title"),
            body: t("review.activation.body"),
            unresolvedWarn: t("review.activation.unresolvedWarn"),
          },
          assignments: {
            title: t("review.assignments.title"),
            bulk: t("review.assignments.bulk"),
            pending: t("review.assignments.pending"),
            owner: t("review.assignments.owner"),
            contributor: t("review.assignments.contributor"),
            approver: t("review.assignments.approver"),
            external: t("review.assignments.external"),
            approveAll: t("review.assignments.approveAll"),
            approved: t("review.assignments.approved"),
            reason: t("review.assignments.reason"),
          },
          inspector: {
            title: t("review.inspector.title"),
            aiVersion: t("review.inspector.aiVersion"),
            editNote: t("review.inspector.editNote"),
            rejectNote: t("review.inspector.rejectNote"),
            noSource: t("review.inspector.noSource"),
          },
          eligibilityNote: "",
        }}
      />
    </>
  );
}
