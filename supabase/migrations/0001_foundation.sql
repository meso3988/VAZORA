-- VAZORA foundation schema (Phase 1 draft — not applied in Phase 1).
-- Tenancy: organization -> members -> projects -> contracts -> (clauses, obligations,
-- evidence, risks, actions, claims). Every tenant table carries organization_id and is
-- protected by RLS via is_org_member().

create extension if not exists "pgcrypto";
create extension if not exists "vector";

create type member_role as enum ('owner','admin','contract_manager','member','viewer');
create type contract_status as enum ('active','mobilizing','closeout','archived');
create type obligation_status as enum ('verified','partial','missing','at_risk','pending');
create type evidence_status as enum ('verified','partial','rejected','pending');
create type risk_severity as enum ('critical','high','medium','low');
create type claim_status as enum ('draft','ready','submitted','approved','disputed');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null,                 -- {"en": "...", "ar": "..."}
  slug text unique not null,
  sector text,
  country_code char(2) default 'SA',
  default_currency char(3) default 'SAR',
  created_at timestamptz default now()
);

create table organization_members (
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role member_role not null default 'member',
  display_name text,
  primary key (organization_id, user_id)
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name jsonb not null,
  client jsonb,
  sector text,
  created_at timestamptz default now()
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  reference text not null,
  title jsonb not null,
  client jsonb not null,
  status contract_status not null default 'active',
  value numeric(18,2),
  currency char(3) default 'SAR',
  start_date date,
  end_date date,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (organization_id, reference)
);

create table clauses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  ref text not null,
  heading jsonb,
  original_text text not null,
  embedding vector(1536)
);

create table obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  clause_id uuid references clauses(id) on delete set null,
  requirement jsonb not null,
  cadence text,
  status obligation_status not null default 'pending',
  due_date date,
  owner_user_id uuid references auth.users(id),
  required_evidence jsonb not null default '[]'::jsonb,
  penalty_exposure numeric(18,2),
  created_at timestamptz default now()
);

create table evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  obligation_id uuid references obligations(id) on delete set null,
  storage_path text not null,            -- Supabase Storage object path (bucket per org)
  file_name text not null,
  status evidence_status not null default 'pending',
  verification jsonb,                    -- {summary:{en,ar}, checks:[...]}
  uploaded_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table risks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  obligation_id uuid references obligations(id) on delete set null,
  title jsonb not null,
  severity risk_severity not null,
  exposure numeric(18,2),
  impact_date date,
  created_at timestamptz default now()
);

create table actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid references contracts(id) on delete cascade,
  obligation_id uuid references obligations(id) on delete set null,
  title jsonb not null,
  owner_user_id uuid references auth.users(id),
  due_date date,
  done boolean default false,
  created_at timestamptz default now()
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid not null references contracts(id) on delete cascade,
  number int not null,
  period_start date,
  period_end date,
  amount numeric(18,2),
  status claim_status not null default 'draft',
  created_at timestamptz default now()
);

create table claim_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  claim_id uuid not null references claims(id) on delete cascade,
  obligation_id uuid references obligations(id) on delete set null,
  label jsonb not null,
  status obligation_status not null default 'pending'
);

create table agent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  contract_id uuid references contracts(id) on delete cascade,
  kind text not null,
  message jsonb not null,
  severity text,
  created_at timestamptz default now()
);

-- Row Level Security -------------------------------------------------------

create or replace function is_org_member(org uuid) returns boolean
language sql stable security definer as $$
  select exists (
    select 1 from organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations','organization_members','projects','contracts','clauses',
    'obligations','evidence','risks','actions','claims','claim_requirements','agent_events'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

create policy org_read on organizations for select using (is_org_member(id));
create policy members_read on organization_members for select using (is_org_member(organization_id));

do $$
declare t text;
begin
  foreach t in array array[
    'projects','contracts','clauses','obligations','evidence','risks','actions',
    'claims','claim_requirements','agent_events'
  ] loop
    execute format(
      'create policy %I_tenant on %I for all using (is_org_member(organization_id)) with check (is_org_member(organization_id))',
      t, t
    );
  end loop;
end $$;

create index on obligations (organization_id, contract_id, status, due_date);
create index on evidence (organization_id, contract_id, obligation_id);
create index on agent_events (organization_id, created_at desc);
