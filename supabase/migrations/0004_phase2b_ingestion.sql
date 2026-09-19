-- ============================================================================
-- VAZORA — Phase 2B: contract ingestion + obligation intelligence
--
-- New entities (all tenant-owned, RLS on):
--   contract_ingestion_runs        — every analysis attempt, never overwritten
--   contract_clauses               — parsed contractual structure, traceable
--   contract_obligations           — extracted draft obligations (reviewable)
--   obligation_source_refs         — obligation → clause/document/page proof
--   obligation_evidence_requirements — what evidence the contract asks for
--   obligation_assignment_suggestions — role/person suggestions (human-decided)
--
-- Principles enforced at the DB layer:
--   * No obligation becomes active without approved extraction review.
--   * Cross-tenant FK references are blocked by SECURITY DEFINER guards from
--     Phase 2A (valid_contract_for_org) plus new per-entity validators.
--   * AI-proposed values are never silently merged over human-approved data.
--   * Document content is data; we store it as-is and never re-interpret it.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type ingestion_status as enum (
  'queued',
  'parsing',
  'parsed',
  'extracting',
  'consolidating',
  'ready_for_review',
  'failed',
  'approved',
  'superseded'
);

create type contract_document_relationship as enum (
  'main', 'appendix', 'addendum', 'variation', 'sla', 'sow', 'boq',
  'technical_spec', 'commercial_schedule', 'other'
);

create type obligation_type as enum (
  'deliverable', 'reporting', 'service_level', 'maintenance', 'inspection',
  'payment', 'claim', 'invoice', 'documentation', 'approval', 'training',
  'staffing', 'insurance', 'license', 'safety', 'quality', 'compliance',
  'notification', 'meeting', 'handover', 'other'
);

create type evidence_requirement_type as enum (
  'document', 'report', 'record', 'signature', 'approval', 'acknowledgement',
  'photo', 'log', 'certificate', 'invoice', 'kpi', 'meeting_minutes',
  'system_record', 'other'
);

create type submission_channel as enum (
  'email', 'portal', 'erp', 'vendor_portal', 'physical', 'official_letter',
  'api', 'other', 'unspecified'
);

create type extraction_review_status as enum (
  'extracted', 'needs_review', 'conflict_requires_review', 'approved', 'rejected'
);

create type obligation_activation_status as enum ('draft', 'active', 'inactive', 'superseded');

create type provenance_kind as enum ('explicit', 'inferred', 'unknown');

create type assignment_confidence as enum ('high', 'medium', 'low');

-- ---------------------------------------------------------------------------
-- Table: extend contract_documents with versioning / relationship metadata
-- ---------------------------------------------------------------------------

alter table contract_documents
  add column if not exists document_relationship contract_document_relationship not null default 'main',
  add column if not exists document_version int not null default 1,
  add column if not exists effective_date date,
  add column if not exists supersedes_document_id uuid references contract_documents (id) on delete set null;

create index if not exists contract_documents_supersedes_idx
  on contract_documents (supersedes_document_id);

-- ---------------------------------------------------------------------------
-- Table: contract_ingestion_runs — one row per analysis attempt
-- ---------------------------------------------------------------------------

create table contract_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  status ingestion_status not null default 'queued',
  error_code text,
  error_message text,
  parser_version text not null,
  extractor_version text not null,
  model_identifier text,
  document_count int not null default 0,
  page_count int,
  segment_count int,
  retry_count int not null default 0,
  duration_ms int,
  usage_tokens_input int,
  usage_tokens_output int,
  idempotency_key text,               -- dedupe double-clicks / retries
  document_fingerprint text,          -- hash of participating documents snapshot
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (organization_id, contract_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- Table: contract_clauses — parsed structure, text preserved as-is
-- ---------------------------------------------------------------------------

create table contract_clauses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  ingestion_run_id uuid not null references contract_ingestion_runs (id) on delete cascade,
  document_id uuid not null references contract_documents (id) on delete cascade,
  clause_number text,                 -- "12.1", "البند 8/4", null allowed
  heading text,
  text text not null,                 -- original source text, never rewritten
  page_number int,
  sequence_number int not null default 0,
  parent_clause_id uuid references contract_clauses (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Table: contract_obligations — structured draft obligations
-- ---------------------------------------------------------------------------

create table contract_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  ingestion_run_id uuid not null references contract_ingestion_runs (id) on delete cascade,

  title text not null,
  requirement_text text not null,
  obligation_type obligation_type not null default 'other',

  frequency text,                     -- "monthly", raw token
  due_rule_raw text,                  -- original wording ("في اليوم الخامس من كل شهر")
  due_date_normalized date,           -- only if confidently parseable
  due_rule_normalized text,           -- conceptual rule e.g. monthly_day_5

  owner_role_suggested text,
  approver_role_suggested text,

  external_dependency text,

  payment_linked boolean,
  payment_link_note text,

  financial_condition text,
  penalty_condition text,
  risk_note text,

  submission_required boolean,
  submission_destination text,
  submission_channel submission_channel,
  submission_deadline_rule text,
  requires_external_acknowledgement boolean,

  ai_confidence numeric(3, 2) check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1)),

  -- Field-level provenance: which fields are explicit/inferred/unknown + their
  -- confidence + source snippet. Shape documented in domain code; jsonb so the
  -- model can grow without migration churn.
  field_provenance jsonb not null default '{}'::jsonb,

  -- Human / AI separation:
  ai_payload jsonb,                   -- original extractor output, untouched
  reviewed_values jsonb,              -- human-edited final values when edited
  review_notes text,                  -- why the reviewer changed/rejected
  review_status extraction_review_status not null default 'extracted',
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  activation_status obligation_activation_status not null default 'draft',

  conflict_group_id uuid,             -- groups conflicting obligations together
  conflict_note text,

  needs_source_review boolean not null default false, -- true when no reliable source

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger contract_obligations_updated_at
  before update on contract_obligations
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Table: obligation_source_refs — traceability to source (never optional for
-- approved obligations)
-- ---------------------------------------------------------------------------

create table obligation_source_refs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  obligation_id uuid not null references contract_obligations (id) on delete cascade,
  document_id uuid not null references contract_documents (id) on delete cascade,
  clause_id uuid references contract_clauses (id) on delete set null,
  page_number int,
  source_snippet text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Table: obligation_evidence_requirements — what the contract asks for
-- ---------------------------------------------------------------------------

create table obligation_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  obligation_id uuid not null references contract_obligations (id) on delete cascade,
  name text not null,
  description text,
  evidence_type evidence_requirement_type not null default 'document',
  required boolean not null default true,
  source_ref_id uuid references obligation_source_refs (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Table: obligation_assignment_suggestions — propose owner/contributor/approver
-- AI suggests roles; a human approves. Phase 2B does NOT auto-assign people.
-- ---------------------------------------------------------------------------

create table obligation_assignment_suggestions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  obligation_id uuid not null references contract_obligations (id) on delete cascade,
  suggestion_kind text not null check (suggestion_kind in ('owner','contributor','approver','external_dependency')),
  suggested_role text not null,
  suggested_person_id uuid,
  suggested_person_name text,         -- raw name if person unknown / external
  confidence assignment_confidence not null default 'medium',
  reason text,
  approved boolean,                   -- null = pending, true/false = human decision
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- Composite FK: the suggested person must be a member of THIS organization.
  foreign key (organization_id, suggested_person_id)
    references organization_members (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- RLS enablement
-- ---------------------------------------------------------------------------

alter table contract_ingestion_runs enable row level security;
alter table contract_clauses enable row level security;
alter table contract_obligations enable row level security;
alter table obligation_source_refs enable row level security;
alter table obligation_evidence_requirements enable row level security;
alter table obligation_assignment_suggestions enable row level security;

-- ---------------------------------------------------------------------------
-- Tenant guards for FK references (match Phase 2A style)
-- ---------------------------------------------------------------------------

create or replace function valid_ingestion_for_org (run uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from contract_ingestion_runs r
    where r.id = run and r.organization_id = org
  );
$$;

create or replace function valid_document_for_org (doc uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from contract_documents d
    where d.id = doc and d.organization_id = org
  );
$$;

create or replace function valid_clause_for_org (cls uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from contract_clauses c
    where c.id = cls and c.organization_id = org
  );
$$;

create or replace function valid_obligation_for_org (obl uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from contract_obligations o
    where o.id = obl and o.organization_id = org
  );
$$;

create or replace function valid_source_ref_for_org (ref uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from obligation_source_refs s
    where s.id = ref and s.organization_id = org
  );
$$;

create or replace function valid_member_for_org (person uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from organization_members m
    where m.user_id = person and m.organization_id = org
  );
$$;

-- ---------------------------------------------------------------------------
-- Policies — member read/write inside org; cross-tenant FK guards on write
-- ---------------------------------------------------------------------------

create policy ingestion_runs_tenant on contract_ingestion_runs
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
  );

create policy clauses_tenant on contract_clauses
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and valid_ingestion_for_org (ingestion_run_id, organization_id)
    and valid_document_for_org (document_id, organization_id)
    and (parent_clause_id is null or valid_clause_for_org (parent_clause_id, organization_id))
  );

create policy obligations_tenant on contract_obligations
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and valid_ingestion_for_org (ingestion_run_id, organization_id)
  );

create policy source_refs_tenant on obligation_source_refs
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_obligation_for_org (obligation_id, organization_id)
    and valid_document_for_org (document_id, organization_id)
    and (clause_id is null or valid_clause_for_org (clause_id, organization_id))
  );

create policy evidence_requirements_tenant on obligation_evidence_requirements
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_obligation_for_org (obligation_id, organization_id)
    and (source_ref_id is null or valid_source_ref_for_org (source_ref_id, organization_id))
  );

create policy assignment_suggestions_tenant on obligation_assignment_suggestions
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_obligation_for_org (obligation_id, organization_id)
    and (suggested_person_id is null or valid_member_for_org (suggested_person_id, organization_id))
  );

-- ---------------------------------------------------------------------------
-- Human-decision integrity:
--   - activation (draft -> active) is only allowed when the row is already
--     approved and sourced
--   - rejection discards the AI draft without activating it
-- These rules are enforced here so server code cannot activate unapproved
-- obligations by accident.
-- ---------------------------------------------------------------------------

create or replace function obligation_activation_gate () returns trigger
language plpgsql
as $$
begin
  if new.activation_status = 'active' then
    if new.review_status <> 'approved' then
      raise exception 'cannot activate obligation: extraction review must be approved first (review_status=%)', new.review_status;
    end if;
    if new.needs_source_review then
      raise exception 'cannot activate obligation: source review outstanding';
    end if;
    if not exists (
      select 1 from obligation_source_refs s
      where s.obligation_id = new.id
    ) then
      raise exception 'cannot activate obligation: no source reference registered';
    end if;
  end if;
  return new;
end;
$$;

create trigger obligation_activation_gate_trigger
  before insert or update on contract_obligations
  for each row execute function obligation_activation_gate ();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index ingestion_runs_org_contract_idx
  on contract_ingestion_runs (organization_id, contract_id, created_at desc);
create index ingestion_runs_status_idx
  on contract_ingestion_runs (organization_id, status);
create unique index ingestion_runs_idempotency_idx
  on contract_ingestion_runs (organization_id, contract_id, coalesce (idempotency_key, ''))
  where status not in ('failed', 'superseded');

create index clauses_run_idx
  on contract_clauses (ingestion_run_id, sequence_number);
create index clauses_contract_idx
  on contract_clauses (contract_id, sequence_number);
create index clauses_document_idx
  on contract_clauses (document_id, page_number);

create index obligations_contract_idx
  on contract_obligations (organization_id, contract_id);
create index obligations_run_idx
  on contract_obligations (ingestion_run_id);
create index obligations_review_status_idx
  on contract_obligations (organization_id, review_status);
create index obligations_activation_status_idx
  on contract_obligations (organization_id, activation_status);
create index obligations_conflict_idx
  on contract_obligations (conflict_group_id) where conflict_group_id is not null;

create index source_refs_obligation_idx on obligation_source_refs (obligation_id);
create index evidence_reqs_obligation_idx on obligation_evidence_requirements (obligation_id);
create index assignment_suggestions_obligation_idx on obligation_assignment_suggestions (obligation_id);
create index assignment_suggestions_pending_idx
  on obligation_assignment_suggestions (organization_id) where approved is null;

comment on column contract_obligations.ai_payload is 'original extractor output verbatim — never mutated by human review';
comment on column contract_obligations.reviewed_values is 'human-edited field values when reviewer corrected AI extraction';
comment on column contract_ingestion_runs.idempotency_key is 'client-supplied key to dedupe duplicate Analyze clicks';
