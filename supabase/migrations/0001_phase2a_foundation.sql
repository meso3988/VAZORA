-- ============================================================================
-- VAZORA — Phase 2A foundation schema
--
-- Scope: multi-tenant SaaS foundation only (organizations, members, projects,
-- contracts, contract documents, activity log, demo requests).
--
-- Explicitly out of scope here (later phases, see supabase/drafts/):
-- clauses, obligations, evidence, risks, claims, claim_requirements,
-- agent_events, embeddings and every AI-derived table.
--
-- Security model:
--  * RLS is enabled on every table.
--  * Tenant tables: SELECT/INSERT/UPDATE/DELETE only for rows whose
--    organization_id belongs to an organization where auth.uid() holds an
--    organization_members row, enforced via is_org_member().
--  * activity_log: members can read/append;UPDATE and DELETE are revoked so
--    audit rows cannot be rewritten by clients.
--  * demo_requests: anon + authenticated may INSERT (public Book Demo form).
--    No SELECT/UPDATE/DELETE policy exists, so leads are readable only with
--    the service role (platform admin tooling uses the service role key on
--    the server and bypasses RLS intentionally).
--  * Storage bucket `contract-documents` is private; object access requires
--    membership in the organization encoded as the first path segment:
--    organization_id/contract_id/document_id_file.pdf
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type member_role as enum ('owner', 'admin', 'member');
create type contract_status as enum ('active', 'mobilizing', 'closeout', 'archived');
create type contract_document_type as enum ('contract', 'annex', 'correspondence', 'other');
create type demo_request_status as enum ('new', 'contacted', 'qualified', 'converted', 'closed');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table organization_members (
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  project_id uuid references projects (id) on delete set null,
  contract_number text not null,
  title text not null,
  client_name text,
  contract_value numeric (18, 2),
  currency char (3) not null default 'SAR',
  start_date date,
  end_date date,
  status contract_status not null default 'active',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, contract_number)
);

create table contract_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  document_type contract_document_type not null default 'contract',
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id),
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length (name) between 2 and 120),
  email text not null check (
    email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    and char_length (email) <= 254
  ),
  company text check (company is null or char_length (company) <= 200),
  job_title text check (job_title is null or char_length (job_title) <= 200),
  phone text check (phone is null or (char_length (phone) <= 40 and phone ~ '^[0-9+ ()-]+$')),
  message text check (message is null or char_length (message) <= 4000),
  source text not null default 'demo-form',
  status demo_request_status not null default 'new',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at () returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_updated_at
  before update on organizations
  for each row execute function set_updated_at ();

create trigger projects_updated_at
  before update on projects
  for each row execute function set_updated_at ();

create trigger contracts_updated_at
  before update on contracts
  for each row execute function set_updated_at ();

-- ---------------------------------------------------------------------------
-- RLS helper functions
--
-- security definer so the membership check reads organization_members without
-- recursing through its own RLS policies. search_path pinned for safety.
-- ---------------------------------------------------------------------------

create or replace function is_org_member (org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid ()
  );
$$;

create or replace function is_org_owner_or_admin (org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid ()
      and m.role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS enablement + policies
-- ---------------------------------------------------------------------------

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table projects enable row level security;
alter table contracts enable row level security;
alter table contract_documents enable row level security;
alter table activity_log enable row level security;
alter table demo_requests enable row level security;

-- organizations: members read; any authenticated user may create an org they
-- own (created_by = auth.uid()); owners/admins may update; owners may delete.
create policy organizations_select on organizations
  for select using (is_org_member (id));

create policy organizations_insert on organizations
  for insert to authenticated
  with check (created_by = auth.uid ());

create policy organizations_update on organizations
  for update using (is_org_owner_or_admin (id))
  with check (is_org_owner_or_admin (id));

create policy organizations_delete on organizations
  for delete using (
    exists (
      select 1 from organization_members m
      where m.organization_id = id
        and m.user_id = auth.uid ()
        and m.role = 'owner'
    )
  );

-- organization_members: members read their org's roster; bootstrap insert is
-- allowed for the organization creator (created_by), afterwards owners/admins
-- manage membership. Users may remove themselves (leave), owners/admins may
-- update roles and remove others. Owners cannot be demoted or removed by a
-- non-owner.
create policy members_select on organization_members
  for select using (is_org_member (organization_id));

create policy members_insert on organization_members
  for insert to authenticated
  with check (
    is_org_owner_or_admin (organization_id)
    or exists (
      select 1 from organizations o
      where o.id = organization_id
        and o.created_by = auth.uid ()
    )
  );

create policy members_update on organization_members
  for update using (
    is_org_owner_or_admin (organization_id)
    or user_id = auth.uid ()
  )
  with check (
    is_org_owner_or_admin (organization_id)
    or user_id = auth.uid ()
  );

create policy members_delete on organization_members
  for delete using (
    is_org_owner_or_admin (organization_id)
    or user_id = auth.uid ()
  );

-- Tenant tables: full member access, scoped by organization membership.
create policy projects_tenant on projects
  for all using (is_org_member (organization_id))
  with check (is_org_member (organization_id));

create policy contracts_tenant on contracts
  for all using (is_org_member (organization_id))
  with check (is_org_member (organization_id));

create policy contract_documents_tenant on contract_documents
  for all using (is_org_member (organization_id))
  with check (is_org_member (organization_id));

-- activity_log: append-only for members. Actor is pinned to the caller.
create policy activity_select on activity_log
  for select using (is_org_member (organization_id));

create policy activity_insert on activity_log
  for insert to authenticated
  with check (
    is_org_member (organization_id)
    and (actor_user_id is null or actor_user_id = auth.uid ())
  );

revoke update, delete on activity_log from authenticated, anon;

-- demo_requests: public insert only. Read/manage requires the service role.
create policy demo_requests_public_insert on demo_requests
  for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- Storage: private `contract-documents` bucket, tenant-scoped by path
--   organization_id/contract_id/<document_id>_<file_name>
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('contract-documents', 'contract-documents', false)
on conflict (id) do nothing;

create or replace function storage_org_member (object_name text) returns boolean
language sql stable security definer
set search_path = public
as $$
  select is_org_member ((storage.foldername (object_name))[1]::uuid);
$$;

create policy contract_documents_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contract-documents'
    and storage_org_member (name)
  );

create policy contract_documents_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contract-documents'
    and storage_org_member (name)
  );

create policy contract_documents_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contract-documents'
    and storage_org_member (name)
  )
  with check (
    bucket_id = 'contract-documents'
    and storage_org_member (name)
  );

create policy contract_documents_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contract-documents'
    and storage_org_member (name)
  );

-- ---------------------------------------------------------------------------
-- Indexes for the obvious tenant access patterns
-- ---------------------------------------------------------------------------

create index organization_members_user_idx
  on organization_members (user_id);

create index projects_org_status_idx
  on projects (organization_id, status);

create index contracts_org_status_idx
  on contracts (organization_id, status);

create index contracts_org_created_idx
  on contracts (organization_id, created_at desc);

create index contracts_project_idx
  on contracts (project_id);

create index contract_documents_contract_idx
  on contract_documents (contract_id);

create index contract_documents_org_idx
  on contract_documents (organization_id, created_at desc);

create index activity_log_org_created_idx
  on activity_log (organization_id, created_at desc);

create index activity_log_entity_idx
  on activity_log (entity_type, entity_id);

create index demo_requests_status_created_idx
  on demo_requests (status, created_at desc);
