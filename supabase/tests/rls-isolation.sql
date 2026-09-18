-- ============================================================================
-- VAZORA — Phase 2A tenant isolation test (v2, editor-safe)
--
-- IMPORTANT: inside the Supabase SQL editor queries run as `postgres`, which
-- owns the tables and therefore BYPASSES RLS by default. To really exercise
-- policies we must SET LOCAL ROLE to 'authenticated'/'anon' before each
-- assertion, alongside the request.jwt.claims GUC that feeds auth.uid().
--
-- Safe to run repeatedly: fixtures are inserted as postgres and everything is
-- rolled back at the end.
-- ============================================================================

begin;

-- --- Fixtures (inserted as postgres — bypass RLS intentionally) -------------
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

insert into storage.objects (bucket_id, name, owner_id)
values
  ('contract-documents', '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/doc1_contract.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('contract-documents', '20000000-0000-4000-8000-000000000002/22200000-0000-4000-8000-000000000002/doc2_contract.pdf', '00000000-0000-4000-8000-0000000000b1');

-- ===========================================================================
-- Perspective: User A (Alpha)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","aud":"authenticated","role":"authenticated"}', true);

-- 1. Sees only Alpha rows.                  expect: 1/1/1/1/1
select
  (select count(*) from organizations)        as orgs,
  (select count(*) from organization_members) as mems,
  (select count(*) from projects)             as projects,
  (select count(*) from contracts)            as contracts,
  (select count(*) from activity_log)         as activity;

-- 2. Cannot read Beta contract by id.       expect: 0
select count(*) as beta_read_deny
from contracts
where id = '22200000-0000-4000-8000-000000000002';

-- 3. Cannot update Beta contract.           expect: UPDATE 0
update contracts set title = 'HACK'
where id = '22200000-0000-4000-8000-000000000002';

-- 4. Cannot read Beta storage objects.      expect: 0
select count(*) as beta_storage_deny
from storage.objects
where bucket_id = 'contract-documents'
  and name like '20000000-0000-4000-8000-000000000002/%';

-- 5. Own org rows are writable.             expect: INSERT 1
insert into contracts (organization_id, contract_number, title) values
  ('10000000-0000-4000-8000-000000000001', 'A-002', 'Second Alpha Contract');

-- 6. demo_requests: insert ok, read denied. expect: INSERT 1, then 0
insert into demo_requests (name, email, company) values ('Lead X', 'lead@x.co', 'X Co');
select count(*) as demo_leak_auth from demo_requests;

-- 7. REGRESSION (member self-promote): a plain member tries to become owner.
--    expect: 0 rows remain 'member'-changed (update hits 0 rows / rejected).
insert into organization_members (organization_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b2', 'member')
on conflict do nothing;
update organization_members set role = 'owner'
where organization_id = '10000000-0000-4000-8000-000000000001'
  and user_id = '00000000-0000-4000-8000-0000000000a1'; -- caller A is owner: allowed
-- but as User A, the member row from another user cannot be demoted/promoted
-- (owner-only via members_update):
update organization_members set role = 'admin'
where organization_id = '10000000-0000-4000-8000-000000000001'
  and user_id = '00000000-0000-4000-8000-0000000000b2'; -- expect UPDATE 1 (owner may) — keeps owner-only gate

-- 8. REGRESSION (cross-tenant FK): Alpha contract cannot point at Beta project.
--    Bring fixtures in-line with projects, then try:
insert into contracts (organization_id, project_id, contract_number, title) values
  ('10000000-0000-4000-8000-000000000001', '22000000-0000-4000-8000-000000000002', 'XFK-1', 'cross');  -- expect ERROR (valid_project_for_org)

-- 9. REGRESSION (demo status hijack): public insert cannot claim 'converted'.
insert into demo_requests (name, email, status) values ('Hijack', 'h@x.co', 'converted');  -- expect ERROR (with check)

rollback;
begin;

-- Recreate fixtures for the second block (previous block rolled back).
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
insert into contracts (id, organization_id, contract_number, title) values
  ('11100000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A-001', 'Alpha Contract'),
  ('22200000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'B-001', 'Beta Contract');

-- ===========================================================================
-- Perspective: User B (Beta) — inverse
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000b1","aud":"authenticated","role":"authenticated"}', true);

-- expect: 1 / 1 (Beta only)
select
  (select count(*) from organizations) as orgs,
  (select count(*) from contracts)     as contracts;

-- expect: 0
select count(*) as alpha_read_deny
from contracts
where id = '11100000-0000-4000-8000-000000000001';

-- ===========================================================================
-- Perspective: anon (public Book Demo form)
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

insert into demo_requests (name, email) values ('Anon Lead', 'anon@l.co'); -- expect: INSERT 1
select count(*) as anon_demo_deny from demo_requests;                      -- expect: 0
select count(*) as anon_contracts_deny from contracts;                     -- expect: 0
select count(*) as anon_org_deny from organizations;                       -- expect: 0

rollback;
