-- ============================================================================
-- VAZORA — Phase 3 evidence tenant-isolation test (one-paste runnable)
--
-- Paste the whole file into the Supabase SQL editor and run once. Each
-- assertion executes inside a DO block with an EXCEPTION handler, so an
-- expected denial does NOT abort the transaction — the run completes and
-- prints a RESULTS TABLE as the final query output (visible directly in
-- the SQL editor results panel — Supabase does not show RAISE NOTICE):
--   test | PASS — ...        (denial enforced / legit op allowed)
--   test | FAIL — ...        (something leaked or a legit op broke)
-- Any FAIL row means a real isolation breach — investigate before deploy.
-- Everything rolls back at the end — safe to run repeatedly.
--
-- Coverage:
--   * Alpha cannot read Beta items/versions/links/runs/checks/gaps
--   * Alpha cannot write rows referencing Beta objects
--   * Alpha cannot touch Beta files in the contract-evidence bucket
--   * Gap gate: resolve requires a verification run; resolved is terminal
--   * Hard delete denied on persisted version records and storage files;
--     only orphan (never-persisted) objects may be cleaned up by members
-- ============================================================================

begin;

-- Results sink. This must be a REAL table, not a temp one: since PG 15,
-- pg_temp objects are unreachable under SET ROLE (security hardening), so
-- `authenticated` could never see it. A regular table created inside this
-- transaction works with normal grants, and the final rollback drops it —
-- zero residue.
create table evidence_rls_results (test int, outcome text);
grant insert, select on evidence_rls_results to authenticated;

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
  ('contract-evidence', '20000000-0000-4000-8000-000000000002/22200000-0000-4000-8000-000000000002/77700000-0000-4000-8000-000000000002/v1_beta.pdf', '00000000-0000-4000-8000-0000000000b1'),
  -- Alpha persisted object (backs the version row created in TEST 5) and an
  -- Alpha orphan object (uploaded but never persisted) for delete-policy tests
  ('contract-evidence', '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf', '00000000-0000-4000-8000-0000000000a1'),
  ('contract-evidence', '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/orphan.pdf', '00000000-0000-4000-8000-0000000000a1');

-- ===========================================================================
-- Perspective: User A (Alpha owner)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","aud":"authenticated","role":"authenticated"}', true);





-- TEST 1: read denial — Alpha sees zero Beta evidence rows.
do $$
declare
  n int;
begin
  select (select count(*) from evidence_items)
       + (select count(*) from evidence_versions)
       + (select count(*) from evidence_requirement_links)
       + (select count(*) from evidence_verification_runs)
       + (select count(*) from evidence_verification_checks)
       + (select count(*) from evidence_gaps) into n;
  if n = 0 then insert into evidence_rls_results values (1, 'PASS — zero Beta rows visible'); end if;
  if n > 0 then insert into evidence_rls_results values (1, 'FAIL — ' || n || ' Beta rows visible'); end if;
end $$;

-- TEST 2: cannot read Beta evidence files. expect count 0.
do $$
declare n int;
begin
  select count(*) into n from storage.objects
  where bucket_id = 'contract-evidence'
    and name like '20000000-0000-4000-8000-000000000002/%';
  if n = 0 then insert into evidence_rls_results values (2, 'PASS — Beta evidence storage hidden');
  else insert into evidence_rls_results values (2, 'FAIL — ' || n || ' objects visible'); end if;
end $$;

-- TEST 3: Alpha item pointing at Beta contract must be rejected.
do $$
begin
  insert into evidence_items (organization_id, contract_id, title) values
    ('10000000-0000-4000-8000-000000000001', '22200000-0000-4000-8000-000000000002', 'cross-tenant item');
  insert into evidence_rls_results values (3, 'FAIL — cross-tenant contract insert succeeded');
exception when others then
  insert into evidence_rls_results values (3, 'PASS — ' || sqlerrm);
end $$;

-- TEST 4: Alpha item pointing at Beta obligation must be rejected.
do $$
begin
  insert into evidence_items (organization_id, contract_id, obligation_id, title) values
    ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000002', 'cross-tenant obligation');
  insert into evidence_rls_results values (4, 'FAIL — cross-tenant obligation insert succeeded');
exception when others then
  insert into evidence_rls_results values (4, 'PASS — ' || sqlerrm);
end $$;

-- TEST 5: legit insert — Alpha item/version/link/run for Alpha objects.
do $$
begin
  insert into evidence_items (id, organization_id, contract_id, obligation_id, title, evidence_type) values
    ('77700000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', 'Alpha September report', 'report');
  insert into evidence_versions (id, organization_id, evidence_item_id, version_number, file_name, storage_path, mime_type, file_size, file_hash) values
    ('88800000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', 1, 'a.pdf', '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf', 'application/pdf', 10, 'bb');
  insert into evidence_requirement_links (organization_id, evidence_item_id, evidence_version_id, evidence_requirement_id) values
    ('10000000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '88800000-0000-4000-8000-000000000001', '66600000-0000-4000-8000-000000000001');
  insert into evidence_verification_runs (id, organization_id, contract_id, obligation_id, evidence_item_id, evidence_version_id, status) values
    ('99900000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '88800000-0000-4000-8000-000000000001', 'completed');
  insert into evidence_rls_results values (5, 'PASS — same-tenant writes allowed');
exception when others then
  insert into evidence_rls_results values (5, 'FAIL — ' || sqlerrm);
end $$;

-- TEST 6: Alpha link cannot reference Beta requirement.
do $$
begin
  insert into evidence_requirement_links (organization_id, evidence_item_id, evidence_requirement_id) values
    ('10000000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '66600000-0000-4000-8000-000000000002');
  insert into evidence_rls_results values (6, 'FAIL — cross-tenant requirement link succeeded');
exception when others then
  insert into evidence_rls_results values (6, 'PASS — ' || sqlerrm);
end $$;

-- TEST 7: Alpha run cannot reference Beta item/version.
do $$
begin
  insert into evidence_verification_runs (organization_id, contract_id, evidence_item_id, evidence_version_id, status) values
    ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000002', '88800000-0000-4000-8000-000000000002', 'queued');
  insert into evidence_rls_results values (7, 'FAIL — cross-tenant run insert succeeded');
exception when others then
  insert into evidence_rls_results values (7, 'PASS — ' || sqlerrm);
end $$;

-- TEST 8: Alpha check cannot reference Beta run.
do $$
begin
  insert into evidence_verification_checks (organization_id, verification_run_id, check_label, result) values
    ('10000000-0000-4000-8000-000000000001', '99900000-0000-4000-8000-000000000002', 'x', 'missing');
  insert into evidence_rls_results values (8, 'FAIL — cross-tenant check insert succeeded');
exception when others then
  insert into evidence_rls_results values (8, 'PASS — ' || sqlerrm);
end $$;

-- TEST 9: Alpha cannot close Beta gap (update must hit 0 rows).
do $$
declare n int;
begin
  update evidence_gaps set status = 'resolved',
    closed_by_verification_run_id = '99900000-0000-4000-8000-000000000002'
  where id = 'aaa00000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n = 0 then insert into evidence_rls_results values (9, 'PASS — Beta gap unreachable');
  else insert into evidence_rls_results values (9, 'FAIL — modified ' || n || ' Beta gaps'); end if;
end $$;

-- TEST 10: resolving a gap without a verification run is impossible.
do $$
begin
  insert into evidence_gaps (organization_id, contract_id, description, status) values
    ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', 'forced close', 'resolved');
  insert into evidence_rls_results values (10, 'FAIL — gap resolved without verification run');
exception when others then
  insert into evidence_rls_results values (10, 'PASS — ' || sqlerrm);
end $$;

-- TEST 11: legal lifecycle — open → evidence_received → reverification → resolved.
do $$
declare n int;
begin
  insert into evidence_gaps (id, organization_id, contract_id, obligation_id, evidence_requirement_id, description)
  values ('aaa00000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000001', '66600000-0000-4000-8000-000000000001', 'missing KPI 6');
  update evidence_gaps set status = 'evidence_received' where id = 'aaa00000-0000-4000-8000-000000000001';
  update evidence_gaps set status = 'reverification_pending' where id = 'aaa00000-0000-4000-8000-000000000001';
  update evidence_gaps set status = 'resolved', closed_by_verification_run_id = '99900000-0000-4000-8000-000000000001'
  where id = 'aaa00000-0000-4000-8000-000000000001';
  select count(*) into n from evidence_gaps where id = 'aaa00000-0000-4000-8000-000000000001' and status = 'resolved' and closed_at is not null;
  if n = 1 then insert into evidence_rls_results values (11, 'PASS — full gap lifecycle works');
  else insert into evidence_rls_results values (11, 'FAIL — lifecycle incomplete'); end if;
exception when others then
  insert into evidence_rls_results values (11, 'FAIL — ' || sqlerrm);
end $$;

-- TEST 12: resolved is terminal — reopening must be rejected.
do $$
begin
  update evidence_gaps set status = 'open' where id = 'aaa00000-0000-4000-8000-000000000001';
  insert into evidence_rls_results values (12, 'FAIL — resolved gap reopened');
exception when others then
  insert into evidence_rls_results values (12, 'PASS — ' || sqlerrm);
end $$;

-- TEST 13: 'verified' check without source support is rejected (non-deterministic).
do $$
begin
  insert into evidence_verification_checks (organization_id, verification_run_id, check_label, check_kind, result) values
    ('10000000-0000-4000-8000-000000000001', '99900000-0000-4000-8000-000000000001', 'unsupported', 'ai_semantic', 'verified');
  insert into evidence_rls_results values (13, 'FAIL — verified without source support accepted');
exception when others then
  insert into evidence_rls_results values (13, 'PASS — ' || sqlerrm);
end $$;

-- TEST 14: hard delete of a persisted version RECORD is denied (no delete policy).
do $$
declare n int;
begin
  delete from evidence_versions where id = '88800000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n = 0 then insert into evidence_rls_results values (14, 'PASS — version record undeletable');
  else insert into evidence_rls_results values (14, 'FAIL — deleted ' || n || ' version rows'); end if;
exception when others then
  insert into evidence_rls_results values (14, 'PASS — ' || sqlerrm);
end $$;

-- TEST 15: hard delete of a persisted evidence FILE is denied — the storage
-- path is backed by an evidence_versions row, so members cannot remove it.
do $$
declare n int;
begin
  delete from storage.objects
  where bucket_id = 'contract-evidence'
    and name = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf';
  get diagnostics n = row_count;
  if n = 0 then insert into evidence_rls_results values (15, 'PASS — persisted evidence file undeletable');
  else insert into evidence_rls_results values (15, 'FAIL — deleted referenced file'); end if;
exception when others then
  insert into evidence_rls_results values (15, 'PASS — ' || sqlerrm);
end $$;

-- TEST 16: the narrow rollback path — an orphan object (no version row) may be
-- deleted by the org member (upload-failure cleanup), nothing else.
do $$
declare n int;
begin
  delete from storage.objects
  where bucket_id = 'contract-evidence'
    and name = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/orphan.pdf';
  get diagnostics n = row_count;
  if n = 1 then insert into evidence_rls_results values (16, 'PASS — orphan cleanup allowed');
  else insert into evidence_rls_results values (16, 'FAIL — orphan cleanup blocked'); end if;
exception when others then
  insert into evidence_rls_results values (16, 'FAIL — ' || sqlerrm);
end $$;

-- TEST 17: updating a persisted evidence FILE in place is denied.
do $$
declare n int;
begin
  update storage.objects set name = 'x_mutated.pdf'
  where bucket_id = 'contract-evidence'
    and name = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf';
  get diagnostics n = row_count;
  if n = 0 then insert into evidence_rls_results values (17, 'PASS — persisted file immutable');
  else insert into evidence_rls_results values (17, 'FAIL — mutated referenced file'); end if;
exception when others then
  insert into evidence_rls_results values (17, 'PASS — ' || sqlerrm);
end $$;

-- ===========================================================================
-- Results — this is the final query output: every row should say PASS.
-- ===========================================================================
select test, outcome from evidence_rls_results order by test;

rollback;
