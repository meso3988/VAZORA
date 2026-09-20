-- ============================================================================
-- VAZORA — Phase 3: Evidence Intelligence foundation
--
-- New entities (all tenant-owned, RLS on):
--   evidence_items                — a logical piece of evidence
--   evidence_versions             — immutable uploaded file versions
--   evidence_requirement_links    — evidence item/version ↔ requirement
--   evidence_verification_runs    — every verification attempt, never overwritten
--   evidence_verification_checks  — per-requirement results with provenance
--   evidence_gaps                 — open/closed deficiency lifecycle
--
-- Principles enforced at the DB layer:
--   * UPLOADED ≠ VERIFIED: a new version never mutates prior verification
--     history, and never closes a gap. Only a verification run closes gaps.
--   * Cross-tenant FK references blocked by the same SECURITY DEFINER guard
--     pattern as Phase 2A/2B.
--   * Evidence storage bucket `contract-evidence` is private; object access
--     requires org membership via the first path segment.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type evidence_item_type as enum (
  'document', 'report', 'record', 'spreadsheet', 'signature',
  'acknowledgement', 'approval', 'photo', 'certificate', 'invoice',
  'kpi', 'log', 'meeting_minutes', 'system_record', 'other'
);

create type evidence_item_status as enum (
  'received',               -- uploaded, not yet verified
  'verification_pending',   -- verification requested/in-flight
  'partially_verified',     -- some required checks passed
  'verified',               -- all mandatory checks passed
  'needs_review',           -- human must decide
  'ocr_required',           -- no machine-readable layer; nothing was verified
  'rejected'
);

create type verification_run_status as enum ('queued', 'running', 'completed', 'failed');

create type verification_check_result as enum (
  'verified', 'partial', 'missing', 'not_found', 'not_applicable',
  'needs_human_review', 'unable_to_verify'
);

create type evidence_gap_status as enum (
  'open', 'evidence_received', 'reverification_pending',
  'resolved', 'dismissed_by_authorized_human'
);

create type evidence_gap_type as enum (
  'missing_evidence', 'partial_evidence', 'contradiction', 'quality', 'other'
);

-- ---------------------------------------------------------------------------
-- Table: evidence_items — logical evidence (one "thing" that proves something)
-- ---------------------------------------------------------------------------

create table evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  obligation_id uuid references contract_obligations (id) on delete set null,
  title text not null,
  evidence_type evidence_item_type not null default 'document',
  status evidence_item_status not null default 'received',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger evidence_items_updated_at
  before update on evidence_items
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Table: evidence_versions — immutable file versions; never overwritten
-- ---------------------------------------------------------------------------

create table evidence_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  evidence_item_id uuid not null references evidence_items (id) on delete cascade,
  version_number int not null check (version_number > 0),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  file_hash text not null,          -- sha-256 hex of the stored bytes
  uploaded_by uuid references auth.users (id),
  uploaded_at timestamptz not null default now(),
  unique (evidence_item_id, version_number)
);

-- ---------------------------------------------------------------------------
-- Table: evidence_requirement_links — item ↔ requirement (optionally pinned
-- to a specific version). Manual by default; AI may suggest later.
-- ---------------------------------------------------------------------------

create table evidence_requirement_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  evidence_item_id uuid not null references evidence_items (id) on delete cascade,
  evidence_version_id uuid references evidence_versions (id) on delete cascade,
  evidence_requirement_id uuid not null references obligation_evidence_requirements (id) on delete cascade,
  link_source text not null default 'manual' check (link_source in ('manual', 'ai_suggested')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (evidence_item_id, evidence_requirement_id, evidence_version_id)
);

create unique index evidence_req_links_item_req_uniq
  on evidence_requirement_links (evidence_item_id, evidence_requirement_id)
  where evidence_version_id is null;

-- ---------------------------------------------------------------------------
-- Table: evidence_verification_runs — one row per verification attempt.
-- Re-verification creates a NEW run; prior results are never overwritten.
-- ---------------------------------------------------------------------------

create table evidence_verification_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  obligation_id uuid references contract_obligations (id) on delete set null,
  evidence_item_id uuid not null references evidence_items (id) on delete cascade,
  evidence_version_id uuid not null references evidence_versions (id) on delete cascade,
  status verification_run_status not null default 'queued',
  verifier_provider text,
  verifier_model text,
  overall_result text,              -- verified | partially_verified | missing | needs_review | unable_to_verify
  check_count int not null default 0,
  verified_count int not null default 0,
  error_code text,
  error_message text,
  duration_ms int,
  usage_tokens_input int,
  usage_tokens_output int,
  triggered_by uuid references auth.users (id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Table: evidence_verification_checks — per-requirement result + provenance.
-- NO EVIDENCE SUPPORT → NO VERIFIED RESULT: a check without a source excerpt
-- cannot be 'verified' (enforced by check constraint for AI checks).
-- ---------------------------------------------------------------------------

create table evidence_verification_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  verification_run_id uuid not null references evidence_verification_runs (id) on delete cascade,
  evidence_requirement_id uuid references obligation_evidence_requirements (id) on delete set null,
  check_label text not null,        -- human-readable criterion evaluated
  check_kind text not null default 'ai_semantic' check (check_kind in ('deterministic', 'ai_semantic')),
  result verification_check_result not null,
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason text,
  source_page int,                  -- PDF page when parser provides it
  source_location text,             -- e.g. sheet "KPI" B4:I4 / docx section
  source_excerpt text,              -- verbatim excerpt from the evidence file
  provider text,
  model text,
  -- Human override is additive only — the AI result is never mutated.
  human_result verification_check_result,
  human_reason text,
  overridden_by uuid references auth.users (id),
  overridden_at timestamptz,
  created_at timestamptz not null default now(),
  constraint verified_needs_support check (
    result <> 'verified' or coalesce(source_excerpt, source_location, '') <> ''
      or check_kind = 'deterministic'
  )
);

-- ---------------------------------------------------------------------------
-- Table: evidence_gaps — deficiency lifecycle. OPEN → EVIDENCE RECEIVED →
-- RE-VERIFICATION PENDING → RESOLVED (only via a verification run) or
-- DISMISSED by an authorized human. A file upload alone never closes a gap.
-- ---------------------------------------------------------------------------

create table evidence_gaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  obligation_id uuid references contract_obligations (id) on delete set null,
  evidence_requirement_id uuid references obligation_evidence_requirements (id) on delete set null,
  verification_run_id uuid references evidence_verification_runs (id) on delete set null,
  gap_type evidence_gap_type not null default 'missing_evidence',
  description text,
  status evidence_gap_status not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_verification_run_id uuid references evidence_verification_runs (id) on delete set null,
  dismissed_by uuid references auth.users (id),
  dismissed_reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS enablement
-- ---------------------------------------------------------------------------

alter table evidence_items enable row level security;
alter table evidence_versions enable row level security;
alter table evidence_requirement_links enable row level security;
alter table evidence_verification_runs enable row level security;
alter table evidence_verification_checks enable row level security;
alter table evidence_gaps enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant guards (Phase 2A/2B pattern; security definer, pinned search_path)
-- ---------------------------------------------------------------------------

create or replace function valid_evidence_item_for_org (item uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from evidence_items i
    where i.id = item and i.organization_id = org
  );
$$;

create or replace function valid_evidence_version_for_org (ver uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from evidence_versions v
    where v.id = ver and v.organization_id = org
  );
$$;

create or replace function valid_evidence_requirement_for_org (req uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from obligation_evidence_requirements r
    where r.id = req and r.organization_id = org
  );
$$;

create or replace function valid_verification_run_for_org (run uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from evidence_verification_runs r
    where r.id = run and r.organization_id = org
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies — member read/write inside org; cross-tenant FK guards on write
-- ---------------------------------------------------------------------------

create policy evidence_items_tenant on evidence_items
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
  );

create policy evidence_versions_tenant on evidence_versions
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
  );

create policy evidence_req_links_tenant on evidence_requirement_links
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and (evidence_version_id is null or valid_evidence_version_for_org (evidence_version_id, organization_id))
    and valid_evidence_requirement_for_org (evidence_requirement_id, organization_id)
  );

create policy verification_runs_tenant on evidence_verification_runs
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and valid_evidence_version_for_org (evidence_version_id, organization_id)
  );

create policy verification_checks_tenant on evidence_verification_checks
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_verification_run_for_org (verification_run_id, organization_id)
    and (evidence_requirement_id is null or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
  );

create policy evidence_gaps_tenant on evidence_gaps
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and (evidence_requirement_id is null or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
    and (verification_run_id is null or valid_verification_run_for_org (verification_run_id, organization_id))
    and (closed_by_verification_run_id is null or valid_verification_run_for_org (closed_by_verification_run_id, organization_id))
  );

-- ---------------------------------------------------------------------------
-- Gap lifecycle gate — only a verification run can resolve a gap.
--   resolved                      → requires closed_by_verification_run_id
--   dismissed_by_authorized_human → requires dismissed_by (+ reason)
--   open/evidence_received/reverification_pending → transitional only
-- closed_at is set automatically on terminal states; reopening a resolved
-- gap is forbidden (a new gap row is created instead).
-- ---------------------------------------------------------------------------

create or replace function evidence_gap_transition_gate () returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'resolved' and new.status <> 'resolved' then
    raise exception 'resolved gap cannot be reopened; open a new gap instead';
  end if;
  if tg_op = 'UPDATE' and old.status = 'dismissed_by_authorized_human' and new.status <> 'dismissed_by_authorized_human' then
    raise exception 'dismissed gap cannot be reopened; open a new gap instead';
  end if;

  if new.status = 'resolved' then
    if new.closed_by_verification_run_id is null then
      raise exception 'gap can only be resolved by a verification run';
    end if;
    new.closed_at = coalesce(new.closed_at, now());
  elsif new.status = 'dismissed_by_authorized_human' then
    if new.dismissed_by is null then
      raise exception 'gap dismissal requires dismissed_by';
    end if;
    new.closed_at = coalesce(new.closed_at, now());
  else
    -- transitional statuses are never closed
    new.closed_at = null;
    new.closed_by_verification_run_id = null;
    if tg_op = 'UPDATE' then
      new.dismissed_by = null;
      new.dismissed_reason = null;
    end if;
  end if;
  return new;
end;
$$;

create trigger evidence_gap_transition_trigger
  before insert or update on evidence_gaps
  for each row execute function evidence_gap_transition_gate ();

-- ---------------------------------------------------------------------------
-- Storage: private `contract-evidence` bucket
--   organization_id/contract_id/evidence_item_id/<version_id>_<file_name>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('contract-evidence', 'contract-evidence', false)
on conflict (id) do nothing;

create policy contract_evidence_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
  );

create policy contract_evidence_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
  );

create policy contract_evidence_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
  )
  with check (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
  );

create policy contract_evidence_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
  );

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index evidence_items_contract_idx
  on evidence_items (organization_id, contract_id);
create index evidence_items_obligation_idx
  on evidence_items (obligation_id) where obligation_id is not null;
create index evidence_items_status_idx
  on evidence_items (organization_id, status);

create index evidence_versions_item_idx
  on evidence_versions (evidence_item_id, version_number desc);
create index evidence_versions_hash_idx
  on evidence_versions (organization_id, file_hash);

create index evidence_req_links_item_idx
  on evidence_requirement_links (evidence_item_id);
create index evidence_req_links_req_idx
  on evidence_requirement_links (evidence_requirement_id);

create index verification_runs_item_idx
  on evidence_verification_runs (evidence_item_id, created_at desc);
create index verification_runs_version_idx
  on evidence_verification_runs (evidence_version_id);
create index verification_runs_contract_idx
  on evidence_verification_runs (organization_id, contract_id);

create index verification_checks_run_idx
  on evidence_verification_checks (verification_run_id);
create index verification_checks_req_idx
  on evidence_verification_checks (evidence_requirement_id);

create index evidence_gaps_open_idx
  on evidence_gaps (organization_id, contract_id) where closed_at is null;
create index evidence_gaps_obligation_idx
  on evidence_gaps (obligation_id) where obligation_id is not null;
create index evidence_gaps_run_idx
  on evidence_gaps (verification_run_id) where verification_run_id is not null;

comment on table evidence_versions is 'immutable uploaded evidence files — a replacement upload is a new version, never an overwrite';
comment on column evidence_verification_checks.source_excerpt is 'verbatim text from the evidence file supporting the result — required for non-deterministic VERIFIED';
comment on column evidence_gaps.closed_by_verification_run_id is 'the ONLY path to status=resolved — uploads never close gaps';
