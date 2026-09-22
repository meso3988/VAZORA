-- ============================================================================
-- Phase 4A Checkpoint 3 — proactive sweep support
-- ============================================================================
-- 0009 created officer_observations with a priority integer and a dedupe key.
-- Proactive monitoring needs three more things it cannot fake:
--
--   1. an explainable SEVERITY plus the deterministic time bucket the
--      Command Center groups by, and the action the Officer recommends
--   2. a resumable SWEEP RUN record so a partial failure is visible and
--      restartable, and a scheduler can call it later without a browser
--   3. per-user LAST REVIEW state so "what changed since my last visit?"
--      is answered from real events instead of model memory
-- ============================================================================

create type officer_severity as enum ('critical', 'high', 'medium', 'low', 'informational');

create type officer_time_bucket as enum (
  'critical', 'today', 'next_3_days', 'this_week', 'monitoring', 'resolved'
);

create type officer_sweep_status as enum ('running', 'completed', 'partial', 'failed');

-- ---------------------------------------------------------------------------
-- Observations — severity, bucket, recommendation, supporting facts.
-- ---------------------------------------------------------------------------

alter table officer_observations
  add column severity officer_severity not null default 'medium',
  add column time_bucket officer_time_bucket not null default 'monitoring',
  -- action_type the Officer would propose; NULL when only review is needed
  add column recommended_action_type text,
  -- deterministic facts the detector used (days_until_due, evidence counts,
  -- owner state...). Machine-readable so the UI and the brief never re-derive
  -- them, and never invent them.
  add column supporting_facts jsonb not null default '{}'::jsonb,
  add column sweep_run_id uuid,
  -- set when a previously-resolved condition genuinely reappears
  add column reopened_at timestamptz,
  add column reopen_count int not null default 0;

comment on column officer_observations.supporting_facts is
  'Deterministic detector output only. No model prose, no estimated financial exposure.';

create index officer_observations_bucket
  on officer_observations (organization_id, status, time_bucket, severity);

-- ---------------------------------------------------------------------------
-- Table: officer_sweep_runs — one row per sweep attempt. Idempotent and
-- resumable: contracts_done advances, and a failure on one contract is
-- recorded without aborting the rest.
-- ---------------------------------------------------------------------------

create table officer_sweep_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  status officer_sweep_status not null default 'running',
  -- 'manual' | 'scheduled' — who asked for it
  trigger text not null default 'manual',
  triggered_by uuid references auth.users (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms int,
  /** organization-local day the sweep reasoned about */
  as_of_date date,
  timezone text,
  contracts_total int not null default 0,
  contracts_done int not null default 0,
  observations_created int not null default 0,
  observations_updated int not null default 0,
  observations_resolved int not null default 0,
  -- [{ contract_id, error }] — codes only, never contract or evidence text
  failures jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index officer_sweep_runs_org_recent
  on officer_sweep_runs (organization_id, started_at desc);

alter table officer_observations
  add constraint officer_observations_sweep_fk
  foreign key (sweep_run_id) references officer_sweep_runs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Table: officer_user_state — per-user review watermark. "Since your last
-- review" must mean a real timestamp, not a guess.
-- ---------------------------------------------------------------------------

create table officer_user_state (
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_reviewed_at timestamptz,
  last_brief_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create trigger officer_user_state_updated_at
  before update on officer_user_state
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- RLS — organization-scoped, same pattern as the rest of the Officer tables.
-- officer_user_state is additionally restricted to the caller's OWN row: one
-- member must not read another member's review watermark.
-- ---------------------------------------------------------------------------

alter table officer_sweep_runs enable row level security;
alter table officer_user_state enable row level security;

create policy officer_sweep_runs_select on officer_sweep_runs
  for select using (is_org_member (organization_id));
create policy officer_sweep_runs_insert on officer_sweep_runs
  for insert with check (is_org_member (organization_id));
create policy officer_sweep_runs_update on officer_sweep_runs
  for update using (is_org_member (organization_id))
  with check (is_org_member (organization_id));

create policy officer_user_state_select on officer_user_state
  for select using (is_org_member (organization_id) and user_id = auth.uid ());
create policy officer_user_state_insert on officer_user_state
  for insert with check (is_org_member (organization_id) and user_id = auth.uid ());
create policy officer_user_state_update on officer_user_state
  for update using (is_org_member (organization_id) and user_id = auth.uid ())
  with check (is_org_member (organization_id) and user_id = auth.uid ());
