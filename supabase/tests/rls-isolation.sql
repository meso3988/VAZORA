-- ============================================================================
-- VAZORA — Phase 2A tenant isolation test
--
-- Run this in the Supabase SQL editor (or `supabase db connect`) against a
-- local/dev project AFTER 0001_phase2a_foundation.sql is applied. Do NOT run
-- against production.
--
-- Scenario:
--   User A  -> Organization Alpha
--   User B  -> Organization Beta
--
-- Expectations:
--   1. User A sees Alpha rows and only Alpha rows.
--   2. User A cannot read Beta contracts/projects/documents/membership/activity.
--   3. User A cannot update Beta contracts.
--   4. User A cannot read or insert Beta storage objects in
--      `contract-documents` (the storage policy fails the membership check;
--      on raw SQL the storage.objects query returns 0 rows).
--   5. User B has the inverse restrictions.
--   6. Any signed-in-or-anon principal can INSERT into demo_requests, but
--      nobody (including authenticated users) can SELECT it.
--
-- How identity simulation works: auth.uid() reads `sub` from the
-- `request.jwt.claims` GUC. Setting it inside a transaction makes RLS
-- policies evaluate as that user.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Fixture: two auth users, two organizations, one contract + project each
-- (auth.users inserts are plain SQL here; locally they must not already exist)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-0000000000a1', 'user-a@test.local', crypt('testpass', gen_salt('bf')), now(), '{}'),
  ('00000000-0000-4000-8000-0000000000b1', 'user-b@test.local', crypt('testpass', gen_salt('bf')), now(), '{}')
on conflict (id) do nothing;

insert into organizations (id, name, slug, created_by) values
  ('10000000-0000-4000-8000-000000000001', 'Alpha Contracting', 'alpha', '00000000-0000-4000-8000-0000000000a1'),
  ('20000000-0000-4000-8000-000000000002', 'Beta Facilities', 'beta', '00000000-0000-4000-8000-0000000000b1');

insert into organization_members (organization_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1', 'owner');

insert into projects (id, organization_id, name) values
  ('11000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Alpha Project'),
  ('22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Beta Project');

insert into contracts (id, organization_id, project_id, contract_number, title, client_name) values
  ('11100000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000001', 'A-001', 'Alpha Contract', 'Alpha Client'),
  ('22200000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22000000-0000-4000-8000-000000000002', 'B-001', 'Beta Contract', 'Beta Client');

insert into activity_log (organization_id, actor_user_id, event_type, entity_type, entity_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'contract.created', 'contract', '11100000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1', 'contract.created', 'contract', '22200000-0000-4000-8000-000000000002');

-- Seed one fake storage.objects row per tenant (metadata only; no file upload).
insert into storage.objects (bucket_id, name, owner_id)
values
  ('contract-documents', '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/doc1_contract.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('contract-documents', '20000000-0000-4000-8000-000000000002/22200000-0000-4000-8000-000000000002/doc2_contract.pdf', '00000000-0000-4000-8000-0000000000b1');

-- ---------------------------------------------------------------------------
-- Perspective: User A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","aud":"authenticated","role":"authenticated"}', true);

-- 1. Sees only Alpha.
select
  (select count(*) from organizations) as orgs,        -- expect 1
  (select count(*) from organization_members) as mems, -- expect 1
  (select count(*) from projects) as projects,         -- expect 1
  (select count(*) from contracts) as contracts,       -- expect 1
  (select count(*) from activity_log) as activity;     -- expect 1

-- 2. Cannot read Beta contracts (direct id probe must return 0 rows).
select count(*) as beta_read_deny
from contracts
where id = '22200000-0000-4000-8000-000000000002';      -- expect 0

-- 3. Cannot update Beta contracts (must affect 0 rows).
update contracts set title = 'HACK'
where id = '22200000-0000-4000-8000-000000000002';      -- expect UPDATE 0

-- 4. Cannot read Beta storage objects nor insert into their namespace.
select count(*) as beta_storage_deny
from storage.objects
where bucket_id = 'contract-documents'
  and name like '20000000-0000-4000-8000-000000000002/%';  -- expect 0

insert into storage.objects (bucket_id, name)
values ('contract-documents',
        '20000000-0000-4000-8000-000000000002/x.pdf');   -- expect ERROR (RLS with check)

-- 5. Own organization rows are fully writable.
insert into contracts (organization_id, contract_number, title) values
  ('10000000-0000-4000-8000-000000000001', 'A-002', 'Second Alpha Contract');  -- expect INSERT 1

-- 6. demo_requests: insert works, select is denied.
insert into demo_requests (name, email, company) values ('Lead X', 'lead@x.co', 'X Co');  -- expect INSERT 1
select count(*) as demo_leak from demo_requests;                                          -- expect 0

-- ---------------------------------------------------------------------------
-- Perspective: User B (inverse)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b1","aud":"authenticated","role":"authenticated"}', true);

select
  (select count(*) from organizations) as orgs,        -- expect 1 (Beta)
  (select count(*) from contracts) as contracts;       -- expect 1 (Beta)

select count(*) as alpha_read_deny
from contracts
where id = '11100000-0000-4000-8000-000000000001';      -- expect 0

-- ---------------------------------------------------------------------------
-- Anon perspective (public Book Demo form)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
insert into demo_requests (name, email) values ('Anon Lead', 'anon@l.co');  -- expect INSERT 1
select count(*) as anon_demo_deny from demo_requests;                        -- expect 0
select count(*) as anon_contracts_deny from contracts;                       -- expect 0

rollback;
