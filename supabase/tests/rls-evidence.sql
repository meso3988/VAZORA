-- ============================================================================
-- VAZORA — Phase 3 evidence tenant-isolation test (editor-safe)
--
-- Same mechanics as rls-isolation.sql: run inside the Supabase SQL editor,
-- assertions execute as `authenticated` via request.jwt.claims. Everything
-- rolls back at the end — safe to run repeatedly.
--
-- Coverage:
--   * Alpha cannot read Beta evidence items/versions/links/runs/checks/gaps
--   * Alpha cannot write evidence rows that reference Beta objects
--   * Gap lifecycle gate: resolve requires a verification run; resolved is
--     terminal
--   * Storage objects in `contract-evidence` isolated by org path segment
-- ============================================================================

begin;

-- --- Fixtures (postgres role — bypasses RLS intentionally) ------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-0000000000a1', 'user-a@test.local', crypt('testpass', gen_salt('bf')), now(), '{}'),
  ('00000000-0000-4000-8000-0000000000b1', 'user-b@test.local', crypt('testpass', gen_salt('bf')), now(), '{}')
on conflict (id) do nothing;

insert into organizations (id, name, slug, created_by) values
  ('10000000-0000-4000-8000-000000000001', 'Alpha Contracting', 'alpha', '00000000-0000-4000-8000-0000000000a1'),
  ('20000000-0000-4000-8000-000000000002', 'Beta Facilities', 'beta', '00000000-0000-4000-8000-0000000000b1')
on conflict (id) do nothing;

insert into organization_members (organization_id, user_id, role) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1', 'owner')
on conflict do nothing;

insert into contracts (id, organization_id, contract_number, title) values
  ('11100000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'A-001', 'Alpha Contract'),
  ('22200000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'B-001', 'Beta Contract')
on conflict (id) do nothing;

insert into contract_documents (id, organization_id, contract_id, file_name, storage_path, mime_type, file_size) values
  ('11110000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', 'a.pdf', 'a/a/a.pdf', 'application/pdf', 100),
  ('22220000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000002', 'b.pdf', 'b/b/b.pdf', 'application/pdf', 100)
on conflict (id) do nothing;

insert into contract_ingestion_runs (id, organization_id, contract_id, status, parser_version, extractor_version) values
  ('33300000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', 'approved', '0.2.0', 'test'),
  ('33300000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000002', 'approved', '0.2.0', 'test')
on conflict (id) do nothing;

-- obligations: approved + sourced so they could activate
insert into contract_obligations (id, organization_id, contract_id, ingestion_run_id, title, requirement_text, review_status) values
  ('44400000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '33300000-0000-4000-8000-000000000001', 'Alpha monthly report', 'submit monthly report', 'approved'),
  ('44400000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000002', '33300000-0000-4000-8000-000000000002', 'Beta monthly report', 'submit monthly report', 'approved')
on conflict (id) do nothing;

insert into obligation_source_refs (id, organization_id, obligation_id, document_id, source_snippet) values
  ('55500000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', '11110000-0000-4000-8000-000000000001', 'alpha snippet'),
  ('55500000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '44400000-0000-4000-8000-000000000002', '22220000-0000-4000-8000-000000000002', 'beta snippet')
on conflict (id) do nothing;

insert into obligation_evidence_requirements (id, organization_id, obligation_id, name, evidence_type) values
  ('66600000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', 'Alpha report file', 'report'),
  ('66600000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '44400000-0000-4000-8000-000000000002', 'Beta report file', 'report')
on conflict (id) do nothing;

-- Beta evidence graph (the target Alpha must not reach)
insert into evidence_items (id, organization_id, contract_id, obligation_id, title, evidence_type) values
  ('77700000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000002', '44400000-0000-4000-8000-000000000002', 'Beta report', 'report')
on conflict (id) do nothing;

insert into evidence_versions (id, organization_id, evidence_item_id, version_number, file_name, storage_path, mime_type, file_size, file_hash) values
  ('88800000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '77700000-0000-4000-8000-000000000002', 1, 'beta.pdf', 'b/ev/v1_beta.pdf', 'application/pdf', 100, 'aa')
on conflict (id) do nothing;

insert into evidence_requirement_links (organization_id, evidence_item_id, evidence_version_id, evidence_requirement_id) values
  ('20000000-0000-4000-8000-000000000002', '77700000-0000-4000-8000-000000000002', '88800000-0000-4000-8000-000000000002', '66600000-0000-4000-8000-000000000002');

insert into evidence_verification_runs (id, organization_id, contract_id, obligation_id, evidence_item_id, evidence_version_id, status) values
  ('99900000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000002', '44400000-0000-4000-8000-000000000002', '77700000-0000-4000-8000-000000000002', '88800000-0000-4000-8000-000000000002', 'completed')
on conflict (id) do nothing;

insert into evidence_verification_checks (organization_id, verification_run_id, evidence_requirement_id, check_label, result, source_excerpt) values
  ('20000000-0000-4000-8000-000000000002', '99900000-0000-4000-8000-000000000002', '66600000-0000-4000-8000-000000000002', 'report exists', 'verified', 'page 1 excerpt');

insert into evidence_gaps (id, organization_id, contract_id, obligation_id, evidence_requirement_id, verification_run_id, description) values
  ('aaa00000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '22200000-0000-4000-8000-000000000002', '44400000-0000-4000-8000-000000000002', '66600000-0000-4000-8000-000000000002', '99900000-0000-4000-8000-000000000002', 'beta gap')
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name, owner_id) values
  ('contract-evidence', '20000000-0000-4000-8000-000000000002/22200000-0000-4000-8000-000000000002/77700000-0000-4000-8000-000000000002/v1_beta.pdf', '00000000-0000-4000-8000-0000000000b1');

-- ===========================================================================
-- Perspective: User A (Alpha)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","aud":"authenticated","role":"authenticated"}', true);

-- 1. READ DENIAL — every Phase 3 entity hides Beta rows. expect: all 0
select
  (select count(*) from evidence_items)            as items_seen,
  (select count(*) from evidence_versions)         as versions_seen,
  (select count(*) from evidence_requirement_links) as links_seen,
  (select count(*) from evidence_verification_runs) as runs_seen,
  (select count(*) from evidence_verification_checks) as checks_seen,
  (select count(*) from evidence_gaps)             as gaps_seen;

-- 2. Cannot read Beta storage objects. expect: 0
select count(*) as beta_evidence_storage_deny
from storage.objects
where bucket_id = 'contract-evidence'
  and name like '20000000-0000-4000-8000-000000000002/%';

-- 3. WRITE DENIAL — Alpha item cannot point at Beta contract. expect: ERROR
insert into evidence_items (organization_id, contract_id, title) values
  ('10000000-0000-4000-8000-000000000001', '22200000-0000-4000-8000-000000000002', 'cross-tenant item');

-- 4. WRITE DENIAL — Alpha item cannot point at Beta obligation. expect: ERROR
insert into evidence_items (organization_id, contract_id, obligation_id, title) values
  ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000002', 'cross-tenant obligation');

-- 5. Legit insert — Alpha evidence item for Alpha contract. expect: INSERT 1
insert into evidence_items (id, organization_id, contract_id, obligation_id, title, evidence_type) values
  ('77700000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', 'Alpha September report', 'report');

insert into evidence_versions (id, organization_id, evidence_item_id, version_number, file_name, storage_path, mime_type, file_size, file_hash) values
  ('88800000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', 1, 'a.pdf', 'a/ev/v1_a.pdf', 'application/pdf', 10, 'bb');

-- 6. WRITE DENIAL — Alpha link cannot reference Beta requirement. expect: ERROR
insert into evidence_requirement_links (organization_id, evidence_item_id, evidence_requirement_id) values
  ('10000000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '66600000-0000-4000-8000-000000000002');

-- 7. WRITE DENIAL — Alpha verification run cannot reference Beta item. expect: ERROR
insert into evidence_verification_runs (organization_id, contract_id, evidence_item_id, evidence_version_id, status) values
  ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000002', '88800000-0000-4000-8000-000000000002', 'queued');

-- 8. WRITE DENIAL — Alpha check cannot reference Beta run. expect: ERROR
insert into evidence_verification_checks (organization_id, verification_run_id, check_label, result) values
  ('10000000-0000-4000-8000-000000000001', '99900000-0000-4000-8000-000000000002', 'x', 'missing');

-- 9. WRITE DENIAL — Alpha cannot close/modify Beta gap (update hits 0 rows).
update evidence_gaps set status = 'resolved', closed_by_verification_run_id = '99900000-0000-4000-8000-000000000002'
where id = 'aaa00000-0000-4000-8000-000000000002';  -- expect: UPDATE 0

-- 10. GAP GATE — resolving without a run id is impossible. expect: ERROR
insert into evidence_gaps (organization_id, contract_id, description, status) values
  ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', 'forced close', 'resolved');

-- 11. Legit gap + legal lifecycle. expect: INSERT 1, UPDATE 1, UPDATE 1
insert into evidence_gaps (id, organization_id, contract_id, obligation_id, evidence_requirement_id, description)
values ('aaa00000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', '66600000-0000-4000-8000-000000000001', 'missing KPI 6');

update evidence_gaps set status = 'evidence_received' where id = 'aaa00000-0000-4000-8000-000000000001';  -- upload arrives
update evidence_gaps set status = 'reverification_pending' where id = 'aaa00000-0000-4000-8000-000000000001';

insert into evidence_verification_runs (id, organization_id, contract_id, obligation_id, evidence_item_id, evidence_version_id, status) values
  ('99900000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '88800000-0000-4000-8000-000000000001', 'completed');

update evidence_gaps set status = 'resolved', closed_by_verification_run_id = '99900000-0000-4000-8000-000000000001'
where id = 'aaa00000-0000-4000-8000-000000000001';  -- expect: UPDATE 1, closed_at set

-- 12. Resolved is terminal — reopening is rejected. expect: ERROR
update evidence_gaps set status = 'open' where id = 'aaa00000-0000-4000-8000-000000000001';

rollback;
