-- ============================================================================
-- Phase 3 stability patch — VERIFICATION_DISCREPANCY
-- ============================================================================
-- Model nondeterminism: the SAME immutable evidence_version can be VERIFIED on
-- one run and NEEDS_HUMAN_REVIEW on a later run. A weaker repeat result on
-- unchanged evidence is a discrepancy requiring human review — it must NOT
-- automatically reopen an operational gap that a prior run resolved.
--
--   prior effective VERIFIED + weaker rerun on SAME version
--     → evidence_verification_discrepancies row (status 'pending')
--     → previously resolved gap stays resolved
--     → authorized human then keeps prior state or confirms regression
--     → confirmed regression opens a NEW gap with
--       opened_via = 'human_confirmed_verification_regression'
--
-- A NEW evidence_version re-verifies normally — the underlying bytes changed,
-- so weaker results are real regressions and gaps open as before.
-- ============================================================================

create type evidence_discrepancy_status as enum (
  'pending',               -- awaiting authorized human review
  'kept_prior',            -- human retained the prior verified state
  'regression_confirmed'   -- human confirmed the regression (new gap opened)
);

-- ---------------------------------------------------------------------------
-- Table: evidence_verification_discrepancies — one row per detected
-- same-version weakening. Append-only detection + additive human resolution;
-- prior runs/checks are never rewritten.
-- ---------------------------------------------------------------------------

create table evidence_verification_discrepancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  evidence_item_id uuid not null references evidence_items (id) on delete cascade,
  evidence_version_id uuid not null references evidence_versions (id) on delete cascade,
  evidence_requirement_id uuid not null references obligation_evidence_requirements (id) on delete cascade,
  prior_check_id uuid not null references evidence_verification_checks (id) on delete cascade,
  current_check_id uuid not null references evidence_verification_checks (id) on delete cascade,
  prior_run_id uuid not null references evidence_verification_runs (id) on delete cascade,
  current_run_id uuid not null references evidence_verification_runs (id) on delete cascade,
  prior_result verification_check_result not null,
  current_result verification_check_result not null,
  provider text,
  model text,
  status evidence_discrepancy_status not null default 'pending',
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

-- At most one PENDING discrepancy per (item, requirement) — reruns of the
-- same open question must not spam the review queue. Resolved discrepancies
-- stay unlimited so history is complete.
create unique index evidence_discrepancy_one_pending
  on evidence_verification_discrepancies (evidence_item_id, evidence_requirement_id)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- Gap provenance — a gap opened after a human confirms regression is
-- explicitly attributed; verification runs keep the default.
-- ---------------------------------------------------------------------------

alter table evidence_gaps
  add column opened_via text not null default 'verification_run';

alter table evidence_gaps
  add constraint evidence_gaps_opened_via_check
  check (opened_via in ('verification_run', 'human_confirmed_verification_regression'));

-- ---------------------------------------------------------------------------
-- RLS — same member-scoped pattern as checks/gaps. No delete policy:
-- discrepancies are audit history.
-- ---------------------------------------------------------------------------

alter table evidence_verification_discrepancies enable row level security;

create policy evidence_discrepancies_select on evidence_verification_discrepancies
  for select using (is_org_member (organization_id));
create policy evidence_discrepancies_insert on evidence_verification_discrepancies
  for insert with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and valid_evidence_version_for_org (evidence_version_id, organization_id)
    and valid_evidence_requirement_for_org (evidence_requirement_id, organization_id)
    and valid_verification_run_for_org (prior_run_id, organization_id)
    and valid_verification_run_for_org (current_run_id, organization_id)
  );
create policy evidence_discrepancies_update on evidence_verification_discrepancies
  for update
  using (is_org_member (organization_id))
  with check (is_org_member (organization_id));
