"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, XCircle, ChevronRight, Users, Zap } from "lucide-react";

import { Panel, Mono } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  approveAssignment,
  approveObligation,
  bulkApprove,
  bulkApproveAssignments,
  editObligation,
  rejectObligation,
  activateContract,
} from "@/app/[locale]/app/contracts/[id]/review-actions";

type Provenance = "explicit" | "inferred" | "unknown";

type Source = {
  source_snippet: string;
  page_number: number | null;
  document_id: string;
  clause_id: string | null;
  clause?: { clause_number: string | null; heading: string | null; text: string } | null;
  document?: { file_name: string } | null;
};

type EvidenceReq = {
  id: string;
  name: string;
  description: string | null;
  evidence_type: string;
  required: boolean;
};

export type ReviewObligation = {
  id: string;
  title: string;
  requirement_text: string;
  obligation_type: string;
  frequency: string | null;
  due_rule_raw: string | null;
  due_rule_normalized: string | null;
  owner_role_suggested: string | null;
  approver_role_suggested: string | null;
  external_dependency: string | null;
  payment_linked: boolean | null;
  payment_link_note: string | null;
  financial_condition: string | null;
  penalty_condition: string | null;
  risk_note: string | null;
  submission_required: boolean | null;
  submission_destination: string | null;
  submission_channel: string | null;
  submission_deadline_rule: string | null;
  requires_external_acknowledgement: boolean | null;
  ai_confidence: number | null;
  field_provenance: Record<string, Provenance>;
  review_status: "extracted" | "needs_review" | "conflict_requires_review" | "approved" | "rejected";
  needs_source_review: boolean;
  conflict_group_id: string | null;
  activation_status: string;
  sources: Source[];
  evidence: EvidenceReq[];
};

type Suggestion = {
  id: string;
  obligation_id: string;
  suggestion_kind: string;
  suggested_role: string;
  suggested_person_name: string | null;
  confidence: "high" | "medium" | "low";
  reason: string | null;
  approved: boolean | null;
};

type Category = "needsReview" | "high" | "recurring" | "payment" | "financial" | "external" | "submission" | "missingSource" | "conflict" | "approved" | "all";

const CAT_FILTER: Record<Category, (o: ReviewObligation) => boolean> = {
  needsReview: (o) => o.review_status === "needs_review" || o.needs_source_review,
  high: (o) => (o.ai_confidence ?? 0) >= 0.85 && !o.needs_source_review && o.review_status === "extracted",
  recurring: (o) => !!o.frequency,
  payment: (o) => !!o.payment_linked,
  financial: (o) => !!o.financial_condition || !!o.penalty_condition,
  external: (o) => !!o.external_dependency,
  submission: (o) => !!o.submission_required,
  missingSource: (o) => o.needs_source_review,
  conflict: (o) => o.review_status === "conflict_requires_review",
  approved: (o) => o.review_status === "approved",
  all: () => true,
};

/** Bulk approval eligibility — shared server-side in review-actions too. */
function bulkEligible(o: ReviewObligation) {
  return (
    o.review_status === "extracted" &&
    !o.needs_source_review &&
    (o.ai_confidence ?? 0) >= 0.85 &&
    !o.financial_condition &&
    !o.penalty_condition &&
    !o.conflict_group_id &&
    (!!o.due_rule_normalized || !!o.due_rule_raw)
  );
}

const PROV_DOT: Record<Provenance, string> = {
  explicit: "bg-verified",
  inferred: "bg-partial",
  unknown: "bg-faint",
};

export function ReviewBoard({
  locale,
  contractId,
  obligations,
  suggestions,
  counts,
  labels,
}: {
  locale: string;
  contractId: string;
  obligations: ReviewObligation[];
  suggestions: Suggestion[];
  counts: { approved: number; rejected: number; unresolved: number; missingSource: number; conflicts: number };
  labels: {
    categories: Record<Category, string>;
    states: Record<Provenance | "conflict", string>;
    fields: Record<string, string>;
    actions: Record<"approve" | "edit" | "reject" | "bulkApprove" | "activate" | "save" | "cancel", string>;
    summaries: Record<"approved" | "rejected" | "unresolved" | "sourceMissing" | "conflicts" | "exceptionsAssignments", string>;
    activation: { title: string; body: string; unresolvedWarn: string };
    assignments: Record<string, string>;
    inspector: { title: string; aiVersion: string; editNote: string; rejectNote: string; noSource: string };
    eligibilityNote: string;
  };
}) {
  const [cat, setCat] = useState<Category>("needsReview");
  const [openId, setOpenId] = useState<string | null>(obligations[0]?.id ?? null);
  const [editing, setEditing] = useState<string | null>(null);

  const counts_ = useMemo(() => {
    const c: Record<Category, number> = {} as never;
    for (const k of Object.keys(CAT_FILTER) as Category[]) {
      c[k] = obligations.filter(CAT_FILTER[k]).length;
    }
    return c;
  }, [obligations]);

  const filtered = useMemo(() => obligations.filter(CAT_FILTER[cat]), [obligations, cat]);
  const eligibleCount = obligations.filter(bulkEligible).length;
  const open = obligations.find((o) => o.id === openId) ?? filtered[0] ?? null;
  const hasPendingAssignments = suggestions.length > 0;

  return (
    <>
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat k={labels.summaries.approved} v={counts.approved} tone="emerald" />
        <Stat k={labels.summaries.rejected} v={counts.rejected} tone="rose" />
        <Stat k={labels.summaries.unresolved} v={counts.unresolved} tone="amber" />
        <Stat k={labels.summaries.sourceMissing} v={counts.missingSource} tone="rose" />
        <Stat k={labels.summaries.conflicts} v={counts.conflicts} tone="amber" />
      </div>

      {/* Categories + bulk */}
      <Panel tone="sky" title={labels.inspector.title}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          {(Object.keys(CAT_FILTER) as Category[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setCat(k)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                cat === k ? "bg-fg text-bg" : "bg-fg/5 text-muted hover:bg-fg/10",
              )}
            >
              {labels.categories[k]}
              <span className="ms-1.5 font-mono tabular text-[10px] opacity-70">{counts_[k]}</span>
            </button>
          ))}
          <div className="ms-auto flex items-center gap-2">
            <form action={bulkApprove} className="flex items-center gap-2">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="contractId" value={contractId} />
              <Button type="submit" size="sm" variant="secondary" disabled={eligibleCount === 0}>
                <Zap size={13} /> {labels.actions.bulkApprove} ({eligibleCount})
              </Button>
            </form>
          </div>
        </div>

        {/* Obligations list + inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <ul className="divide-y divide-line border-e border-line">
            {filtered.length === 0 && (
              <li className="px-5 py-10 text-center text-xs text-faint">—</li>
            )}
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => { setOpenId(o.id); setEditing(null); }}
                  className={cn(
                    "flex w-full items-start gap-3 px-5 py-3 text-start transition-colors",
                    open?.id === o.id ? "bg-fg/4" : "hover:bg-fg/2",
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", o.review_status === "approved" ? "bg-verified" : o.review_status === "rejected" ? "bg-missing" : o.needs_source_review ? "bg-at-risk" : "bg-partial")} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{o.title}</span>
                    <span className="mt-0.5 line-clamp-2 text-[11px] text-muted">
                      {o.sources[0]?.clause?.clause_number ? `§${o.sources[0].clause.clause_number} · ` : ""}{o.requirement_text}
                    </span>
                    <div className="mt-1 flex items-center gap-3 text-[10px] text-faint">
                      <ProvenanceBadge o={o} labels={labels.states} />
                      {o.ai_confidence != null && (
                        <Mono className="tabular">{Math.round(o.ai_confidence * 100)}%</Mono>
                      )}
                      <Mono className="tabular">{o.obligation_type}</Mono>
                    </div>
                  </div>
                  <ChevronRight size={13} className="mt-1 shrink-0 text-faint rtl:-scale-x-100" />
                </button>
              </li>
            ))}
          </ul>

          <div className="min-h-[400px] bg-bg/40">
            {open ? (
              <Inspector
                key={open.id}
                o={open}
                locale={locale}
                contractId={contractId}
                labels={labels}
                editing={editing === open.id}
                onEdit={() => setEditing(open.id)}
                onCancel={() => setEditing(null)}
                suggestions={suggestions.filter((s) => s.obligation_id === open.id)}
              />
            ) : (
              <p className="px-6 py-12 text-center text-xs text-faint">—</p>
            )}
          </div>
        </div>
      </Panel>

      {/* Assignments */}
      <Panel tone="sky" title={labels.assignments.title}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
          <p className="text-xs text-muted">{labels.assignments.pending}</p>
          <form action={bulkApproveAssignments}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="contractId" value={contractId} />
            <Button type="submit" size="sm" variant="secondary" disabled={!hasPendingAssignments}>
              <Users size={13} /> {labels.assignments.approveAll}
            </Button>
          </form>
        </div>
        {suggestions.length === 0 ? (
          <p className="px-5 py-6 text-xs text-faint">—</p>
        ) : (
          <ul className="divide-y divide-line">
            {suggestions.map((s) => {
              const obl = obligations.find((o) => o.id === s.obligation_id);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    s.confidence === "high" ? "bg-verified/15 text-verified" : s.confidence === "medium" ? "bg-partial/15 text-partial" : "bg-missing/15 text-missing")}>
                    {s.confidence}
                  </span>
                  <span className="text-xs font-medium text-muted">{kindLabel(labels.assignments, s.suggestion_kind)}</span>
                  <span className="flex-1 truncate text-sm">
                    <Mono className="text-sm">{s.suggested_role}</Mono>
                    {s.suggested_person_name && <span className="text-muted"> → {s.suggested_person_name}</span>}
                    {obl && <span className="block text-[10px] text-faint">{obl.title}</span>}
                  </span>
                  {s.reason && <span className="w-full text-[10px] text-faint">{labels.assignments.reason}: {s.reason}</span>}
                  <form action={approveAssignment}>
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="contractId" value={contractId} />
                    <input type="hidden" name="suggestionId" value={s.id} />
                    <Button type="submit" size="sm">{labels.actions.approve}</Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* Activation */}
      <Panel tone="amber" title={labels.activation.title}>
        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-sm text-muted">{labels.activation.body}</p>
          {counts.unresolved > 0 && (
            <p className="rounded-md border border-partial/40 bg-partial/10 px-3 py-2 text-xs text-partial">
              {labels.activation.unresolvedWarn.replace("{count}", String(counts.unresolved))}
            </p>
          )}
          <form action={activateContract} className="flex items-center justify-end">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="contractId" value={contractId} />
            <Button type="submit" disabled={counts.unresolved > 0 || counts.approved === 0}>
              {labels.actions.activate}
            </Button>
          </form>
        </div>
      </Panel>
    </>
  );
}

function Stat({ k, v, tone }: { k: string; v: number; tone: "emerald" | "rose" | "amber" }) {
  const colors = { emerald: "text-verified", rose: "text-missing", amber: "text-partial" };
  return (
    <div className="rounded-xl border border-line bg-elevated px-4 py-3">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted">{k}</span>
      <span className={cn("block font-mono text-2xl font-bold tabular", colors[tone])}>{v}</span>
    </div>
  );
}

function ProvenanceBadge({ o, labels }: { o: ReviewObligation; labels: Record<string, string> }) {
  const prov = o.field_provenance ?? {};
  const values = Object.values(prov);
  const hasInferred = values.includes("inferred");
  const hasUnknown = values.includes("unknown");
  const state: Provenance = hasUnknown ? "unknown" : hasInferred ? "inferred" : "explicit";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-1.5 w-1.5 rounded-full", PROV_DOT[state])} />
      <span className="text-muted">{labels[state]}</span>
    </span>
  );
}

function kindLabel(labels: Record<string, string>, kind: string) {
  const map: Record<string, string> = { owner: labels.owner, contributor: labels.contributor, approver: labels.approver, external_dependency: labels.external };
  return map[kind] ?? kind;
}

function Inspector({
  o,
  locale,
  contractId,
  labels,
  editing,
  onEdit,
  onCancel,
  suggestions,
}: {
  o: ReviewObligation;
  locale: string;
  contractId: string;
  labels: {
    fields: Record<string, string>;
    actions: Record<string, string>;
    inspector: { title: string; aiVersion: string; editNote: string; rejectNote: string; noSource: string };
    states: Record<string, string>;
  };
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  suggestions: Suggestion[];
}) {
  const prov: Record<string, Provenance> = o.field_provenance ?? {};
  const src = o.sources[0];

  return (
    <div className="flex flex-col gap-0">
      {!editing ? (
        <>
          <div className="flex flex-col gap-4 p-5">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{labels.inspector.title}</p>
              <h4 className="mt-1 text-base font-semibold">{o.title}</h4>
            </div>
            <Field label={labels.fields.requirement} value={o.requirement_text} prov={prov.requirement_text} states={labels.states} />
            <div className="grid grid-cols-2 gap-3">
              <Field label={labels.fields.frequency} value={o.frequency} prov={prov.frequency} states={labels.states} />
              <Field label={labels.fields.due} value={o.due_rule_raw} prov={prov.due_rule_raw} states={labels.states} />
              <Field label={labels.fields.owner} value={o.owner_role_suggested} prov={prov.owner_role_suggested} states={labels.states} />
              <Field label={labels.fields.approver} value={o.approver_role_suggested} prov={prov.approver_role_suggested} states={labels.states} />
            </div>
            {o.external_dependency && <Field label={labels.fields.external} value={o.external_dependency} prov={prov.external_dependency} states={labels.states} />}
            {o.payment_linked && <Field label={labels.fields.payment} value={o.payment_link_note ?? "✓"} prov={prov.payment_linked} states={labels.states} />}
            {o.financial_condition && <Field label={labels.fields.financial} value={o.financial_condition} prov={prov.financial_condition} states={labels.states} amber />}
            {o.penalty_condition && <Field label={labels.fields.penalty} value={o.penalty_condition} prov={prov.penalty_condition} states={labels.states} amber />}
            {o.risk_note && <Field label={labels.fields.risk ?? "Risk"} value={o.risk_note} prov={prov.risk_note} states={labels.states} amber />}
            {!!o.submission_required && (
              <Field
                label={labels.fields.submission}
                value={[o.submission_destination, o.submission_channel, o.submission_deadline_rule].filter(Boolean).join(" · ") || "✓"}
                prov={prov.submission_required ?? prov.submission_destination}
                states={labels.states}
              />
            )}

            {o.evidence.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.evidence}</p>
                <ul className="flex flex-col gap-1">
                  {o.evidence.map((e) => (
                    <li key={e.id} className="flex items-start gap-2 text-xs">
                      <span className={cn("mt-1 h-1.5 w-1.5 rounded-full", e.required ? "bg-emerald-500" : "bg-faint")} />
                      <span><span className="font-medium">{e.name}</span>{e.description && <span className="text-muted"> — {e.description}</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {o.ai_confidence != null && (
              <div className="flex items-center gap-2 text-[11px] text-muted">
                <span>{labels.fields.confidence}:</span>
                <Mono className="tabular font-semibold">{Math.round(o.ai_confidence * 100)}%</Mono>
              </div>
            )}
          </div>

          {/* Source panel */}
          <div className="border-t border-line bg-fg/2 p-5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.source}</p>
            {src ? (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs text-muted">
                  {src.document?.file_name}
                  {src.clause?.clause_number && <> · §{src.clause.clause_number}</>}
                  {src.page_number != null && <> · p.{src.page_number}</>}
                </p>
                {src.clause?.heading && <p className="text-sm font-medium">{src.clause.heading}</p>}
                <blockquote className="border-s-2 border-amber-500/60 ps-3 font-serif text-sm italic leading-relaxed text-muted">
                  {src.source_snippet}
                </blockquote>
                {src.clause?.text && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-faint hover:text-muted">{labels.fields.aiSuggested} · {labels.inspector.aiVersion}</summary>
                    <p className="mt-2 whitespace-pre-wrap text-muted">{src.clause.text}</p>
                  </details>
                )}
              </div>
            ) : (
              <p className="mt-2 text-xs text-at-risk">{labels.inspector.noSource}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            <form action={approveObligation}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="contractId" value={contractId} />
              <input type="hidden" name="obligationId" value={o.id} />
              <Button type="submit" size="sm" variant="primary" disabled={o.review_status === "approved"}>
                <Check size={13} /> {labels.actions.approve}
              </Button>
            </form>
            <Button type="button" size="sm" variant="secondary" onClick={onEdit}>
              <Pencil size={13} /> {labels.actions.edit}
            </Button>
            <RejectForm locale={locale} contractId={contractId} obligationId={o.id} label={labels.actions.reject} />
          </div>

          {/* Phase-2B related assignments for this obligation */}
          {suggestions.length > 0 && (
            <div className="border-t border-line px-5 py-3">
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.owner}</p>
              <ul className="flex flex-col gap-1 text-xs text-muted">
                {suggestions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <Mono className="text-muted">{s.confidence}</Mono> {s.suggested_role}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <EditForm o={o} locale={locale} contractId={contractId} labels={labels} onCancel={onCancel} />
      )}
    </div>
  );
}

function Field({ label, value, prov, states, amber }: { label: string; value: string | null | undefined; prov?: Provenance; states: Record<string, string>; amber?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{label}</p>
        {prov && (
          <span className={cn("inline-flex items-center gap-1 rounded px-1 py-px text-[9px] font-semibold",
            prov === "explicit" ? "bg-verified/10 text-verified" : prov === "inferred" ? "bg-partial/10 text-partial" : "bg-fg/5 text-faint")}>
            {states[prov]}
          </span>
        )}
      </div>
      <p className={cn("text-sm", amber && "text-partial", !value && "text-faint italic")}>{value ?? states.unknown}</p>
    </div>
  );
}

function RejectForm({ locale, contractId, obligationId, label }: { locale: string; contractId: string; obligationId: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" className="border-missing/40 text-missing" onClick={() => setOpen(true)}>
        <XCircle size={13} /> {label}
      </Button>
    );
  }
  return (
    <form action={rejectObligation} className="flex items-center gap-1.5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="contractId" value={contractId} />
      <input type="hidden" name="obligationId" value={obligationId} />
      <input
        name="note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="…"
        className="h-8 w-40 rounded-md border border-line bg-elevated px-2 text-xs"
      />
      <Button type="submit" size="sm" variant="secondary" className="border-missing/40 text-missing">{label}</Button>
    </form>
  );
}

function EditForm({
  o,
  locale,
  contractId,
  labels,
  onCancel,
}: {
  o: ReviewObligation;
  locale: string;
  contractId: string;
  labels: { fields: Record<string, string>; actions: Record<string, string> };
  onCancel: () => void;
}) {
  const input = "w-full rounded-md border border-line bg-elevated px-2 py-1.5 text-sm";
  return (
    <form action={editObligation} className="flex flex-col gap-3 p-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="contractId" value={contractId} />
      <input type="hidden" name="obligationId" value={o.id} />
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">العنوان</p>
        <input name="title" defaultValue={o.title} className={input} required />
      </div>
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.requirement}</p>
        <textarea name="requirement_text" defaultValue={o.requirement_text} className={cn(input, "h-24")} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.frequency}</p>
          <input name="frequency" defaultValue={o.frequency ?? ""} className={input} />
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.due}</p>
          <input name="due_rule_raw" defaultValue={o.due_rule_raw ?? ""} className={input} />
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">{labels.fields.owner}</p>
          <input name="owner_role_suggested" defaultValue={o.owner_role_suggested ?? ""} className={input} />
        </div>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">ملاحظة المراجعة</p>
        <input name="note" placeholder="…" className={input} />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm"><Check size={13} /> {labels.actions.save}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>{labels.actions.cancel}</Button>
      </div>
    </form>
  );
}
