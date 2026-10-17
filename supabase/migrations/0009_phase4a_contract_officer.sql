-- ============================================================================
-- Phase 4A Checkpoint 1 — AI Contract Officer foundation
-- ============================================================================
-- The Officer is a persistent, organization-scoped digital contract manager,
-- not a chatbot bolted onto the workspace. This migration adds only the
-- storage it needs to KNOW, REMEMBER, PROPOSE and ESCALATE:
--
--   organizations.timezone            real local time for deadline arithmetic
--   officer_profiles                  one Officer per organization
--   officer_conversations/_messages   persistent, structured dialogue
--   officer_memory                    controlled memory (never raw chat history)
--   officer_actions                   proposal → approval → execution audit
--   officer_observations              proactive detections (populated in CP3)
--
-- Authority invariants enforced here:
--   * every table is organization-scoped and RLS-protected
--   * cross-tenant FKs are validated with the existing valid_*_for_org guards
--   * the model never gets service_role/SQL — tools run server-side, and a
--     model-proposed organization_id can never widen access because RLS is
--     evaluated against the caller's JWT, not against tool arguments
--   * model inference can never be stored as confirmed memory (DB check)
--   * a meaningful mutation cannot be marked approved without an approver
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organization timezone — deadline arithmetic is deterministic and
-- server-side; the model is never asked to do date math. IANA zone, no
-- region hardcoded (UTC default; chosen during organization setup).
-- ---------------------------------------------------------------------------

alter table organizations
  add column timezone text not null default 'UTC';

alter table organizations
  add constraint organizations_timezone_not_blank
  check (char_length (trim(timezone)) > 0);

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type officer_conversation_scope as enum ('organization', 'contract');

create type officer_message_role as enum ('user', 'assistant', 'tool', 'system');

create type officer_memory_scope as enum ('organization', 'contract', 'user');

create type officer_memory_kind as enum ('fact', 'preference', 'promise', 'note');

-- Where a memory came from. Model inference is explicitly representable so it
-- can be stored WITHOUT being treated as truth.
create type officer_memory_origin as enum (
  'user_confirmed',   -- the user stated/confirmed it
  'human_note',       -- an authorized human wrote it
  'system_derived',   -- derived from authoritative system state
  'model_inference'   -- the model guessed — never authoritative
);

create type officer_memory_state as enum ('confirmed', 'unconfirmed', 'invalidated');

create type officer_action_status as enum (
  'suggested',            -- officer proposed it; nobody asked for approval yet
  'waiting_for_approval',
  'approved',
  'executing',
  'completed',
  'rejected',
  'failed',
  'cancelled'
);

create type officer_risk_level as enum ('low', 'medium', 'high');

create type officer_observation_status as enum ('active', 'acknowledged', 'resolved', 'superseded');

-- ---------------------------------------------------------------------------
-- Table: officer_profiles — one default Contract Officer per organization.
-- Voice/avatar identity is deliberately absent; Phase 4B attaches it.
-- ---------------------------------------------------------------------------

create table officer_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references organizations (id) on delete cascade,
  display_name text not null default 'VAZORA Contract Officer',
  preferred_language text not null default 'auto'
    check (preferred_language in ('auto', 'en', 'ar')),
  -- null = inherit organizations.timezone (the authoritative organizational
  -- clock). Present so an Officer can be pinned to a project timezone later.
  timezone text,
  tone text not null default 'professional',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger officer_profiles_updated_at
  before update on officer_profiles
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Table: officer_conversations — organization-wide or contract-scoped.
-- ---------------------------------------------------------------------------

create table officer_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  scope officer_conversation_scope not null default 'organization',
  contract_id uuid references contracts (id) on delete cascade,
  title text,
  created_by uuid references auth.users (id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a contract conversation must name its contract; an org one must not
  constraint officer_conversation_scope_shape check (
    (scope = 'contract' and contract_id is not null)
    or (scope = 'organization' and contract_id is null)
  )
);

create index officer_conversations_org_recent
  on officer_conversations (organization_id, last_message_at desc nulls last);

create trigger officer_conversations_updated_at
  before update on officer_conversations
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Table: officer_messages — structured, not plain strings. The same response
-- model must serve a future realtime voice interface, so citations, tool
-- results and proposed actions are first-class columns rather than prose.
-- ---------------------------------------------------------------------------

create table officer_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  conversation_id uuid not null references officer_conversations (id) on delete cascade,
  role officer_message_role not null,
  content text not null default '',
  -- [{ type, id, label, ... }] — resolvable pointers into contracts, clauses,
  -- obligations, evidence, verification runs/checks, gaps, discrepancies,
  -- activity events. Validated in application code.
  citations jsonb not null default '[]'::jsonb,
  -- [{ tool, args, ok, summary, duration_ms }] — what the officer actually ran
  tool_invocations jsonb not null default '[]'::jsonb,
  -- officer_actions proposed by this message (approval requests)
  proposed_action_ids uuid[] not null default '{}',
  author_user_id uuid references auth.users (id),
  provider text,
  model text,
  usage_tokens_input int,
  usage_tokens_output int,
  created_at timestamptz not null default now(),
  -- structural honesty: a user message is authored by a user; an assistant
  -- message never claims a human author
  constraint officer_message_author_shape check (
    (role = 'user' and author_user_id is not null)
    or (role <> 'user' and author_user_id is null)
  )
);

create index officer_messages_conversation
  on officer_messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Table: officer_memory — controlled memory. Raw chat history is NOT memory.
-- ---------------------------------------------------------------------------

create table officer_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  scope officer_memory_scope not null default 'organization',
  contract_id uuid references contracts (id) on delete cascade,
  subject_user_id uuid references auth.users (id) on delete cascade,
  kind officer_memory_kind not null default 'fact',
  content text not null check (char_length (trim(content)) > 0),
  origin officer_memory_origin not null,
  state officer_memory_state not null default 'unconfirmed',
  confidence numeric(3, 2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_conversation_id uuid references officer_conversations (id) on delete set null,
  source_message_id uuid references officer_messages (id) on delete set null,
  author_user_id uuid references auth.users (id),
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz,
  invalidated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint officer_memory_scope_shape check (
    (scope = 'contract' and contract_id is not null)
    or (scope = 'user' and subject_user_id is not null)
    or (scope = 'organization')
  ),
  -- MODEL SPECULATION IS NEVER FACT: inference can be recorded, but only a
  -- human confirmation can promote it to 'confirmed'.
  constraint officer_memory_no_unconfirmed_inference check (
    origin <> 'model_inference' or state <> 'confirmed' or confirmed_by is not null
  ),
  constraint officer_memory_confirmed_has_actor check (
    state <> 'confirmed' or confirmed_by is not null or origin in ('user_confirmed', 'human_note', 'system_derived')
  )
);

create index officer_memory_lookup
  on officer_memory (organization_id, scope, state);

create trigger officer_memory_updated_at
  before update on officer_memory
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Table: officer_actions — the officer PROPOSES, a human APPROVES.
-- Phase 4A performs no silent business mutation and no external comms.
-- ---------------------------------------------------------------------------

create table officer_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid references contracts (id) on delete cascade,
  obligation_id uuid references contract_obligations (id) on delete set null,
  conversation_id uuid references officer_conversations (id) on delete set null,
  action_type text not null,
  -- validated per action type in application code before execution
  arguments jsonb not null default '{}'::jsonb,
  -- why the officer is proposing this, in operational terms
  reason text not null,
  -- resolvable sources backing the reason — a proposal without grounds is
  -- an opinion, not an operational recommendation
  citations jsonb not null default '[]'::jsonb,
  risk_level officer_risk_level not null default 'low',
  requires_approval boolean not null default true,
  status officer_action_status not null default 'suggested',
  -- null proposer = the Officer itself; a human-initiated action names them
  proposed_by uuid references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  rejected_by uuid references auth.users (id),
  rejected_at timestamptz,
  rejection_reason text,
  executed_at timestamptz,
  execution_result jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- AI RECOMMENDATION ≠ AUTHORIZATION: an approval-required action can never
  -- reach an executed state without a named human approver.
  constraint officer_action_approval_shape check (
    requires_approval = false
    or status not in ('approved', 'executing', 'completed')
    or approved_by is not null
  ),
  constraint officer_action_rejection_shape check (
    status <> 'rejected' or rejected_by is not null
  )
);

create index officer_actions_org_status
  on officer_actions (organization_id, status, created_at desc);

create trigger officer_actions_updated_at
  before update on officer_actions
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Table: officer_observations — what the proactive sweep detected. Created
-- here so tenant isolation is proven before CP3 populates it.
-- dedupe_key keeps an unchanged issue from re-notifying every sweep.
-- ---------------------------------------------------------------------------

create table officer_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid references contracts (id) on delete cascade,
  obligation_id uuid references contract_obligations (id) on delete set null,
  evidence_requirement_id uuid references obligation_evidence_requirements (id) on delete set null,
  kind text not null,
  -- 1 = critical … 4 = monitoring; explained by `priority_reason`
  priority int not null default 3 check (priority between 1 and 4),
  priority_reason jsonb not null default '[]'::jsonb,
  title text not null,
  detail text,
  citations jsonb not null default '[]'::jsonb,
  status officer_observation_status not null default 'active',
  dedupe_key text not null,
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_by uuid references auth.users (id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One ACTIVE observation per detected issue per organization.
create unique index officer_observations_active_dedupe
  on officer_observations (organization_id, dedupe_key)
  where status = 'active';

create index officer_observations_org_priority
  on officer_observations (organization_id, status, priority, last_seen_at desc);

create trigger officer_observations_updated_at
  before update on officer_observations
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- Tenant guard for officer conversations (used by message/memory writes).
-- ---------------------------------------------------------------------------

create or replace function valid_officer_conversation_for_org (conv uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from officer_conversations c
    where c.id = conv and c.organization_id = org
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS — member-scoped reads/writes with cross-tenant FK guards. No delete
-- policies: officer dialogue, memory and actions are an audit trail.
-- ---------------------------------------------------------------------------

alter table officer_profiles enable row level security;
alter table officer_conversations enable row level security;
alter table officer_messages enable row level security;
alter table officer_memory enable row level security;
alter table officer_actions enable row level security;
alter table officer_observations enable row level security;

create policy officer_profiles_select on officer_profiles
  for select using (is_org_member (organization_id));
create policy officer_profiles_insert on officer_profiles
  for insert with check (is_org_member (organization_id));
create policy officer_profiles_update on officer_profiles
  for update using (is_org_member (organization_id))
  with check (is_org_member (organization_id));

create policy officer_conversations_select on officer_conversations
  for select using (is_org_member (organization_id));
create policy officer_conversations_insert on officer_conversations
  for insert with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
  );
create policy officer_conversations_update on officer_conversations
  for update using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
  );

create policy officer_messages_select on officer_messages
  for select using (is_org_member (organization_id));
create policy officer_messages_insert on officer_messages
  for insert with check (
    is_org_member (organization_id)
    and valid_officer_conversation_for_org (conversation_id, organization_id)
  );
-- No update policy: messages are an immutable transcript.

create policy officer_memory_select on officer_memory
  for select using (is_org_member (organization_id));
create policy officer_memory_insert on officer_memory
  for insert with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
    and (source_conversation_id is null
         or valid_officer_conversation_for_org (source_conversation_id, organization_id))
  );
create policy officer_memory_update on officer_memory
  for update using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
  );

create policy officer_actions_select on officer_actions
  for select using (is_org_member (organization_id));
create policy officer_actions_insert on officer_actions
  for insert with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and (conversation_id is null
         or valid_officer_conversation_for_org (conversation_id, organization_id))
  );
create policy officer_actions_update on officer_actions
  for update using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
  );

create policy officer_observations_select on officer_observations
  for select using (is_org_member (organization_id));
create policy officer_observations_insert on officer_observations
  for insert with check (
    is_org_member (organization_id)
    and (contract_id is null or valid_contract_for_org (contract_id, organization_id))
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and (evidence_requirement_id is null
         or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
  );
create policy officer_observations_update on officer_observations
  for update using (is_org_member (organization_id))
  with check (is_org_member (organization_id));
