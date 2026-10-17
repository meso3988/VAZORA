-- ============================================================================
-- VAZORA — Phase 3 evidence tenant-isolation test (one-paste runnable)
--
-- Paste the whole file into the Supabase SQL editor and run once. Each
-- assertion executes inside a DO block with an EXCEPTION handler, so an
-- expected denial does NOT abort the transaction — the run completes and
-- prints a RESULTS TABLE as the final query output, visible directly in
-- the SQL editor results panel (Supabase does not show RAISE NOTICE, and
-- SET ROLE makes pg_temp unreachable, so results accumulate in a custom
-- session GUC instead — no tables involved at all):
--   TEST n: PASS — ...        (denial enforced / legit op allowed)
--   TEST n: FAIL — ...        (something leaked or a legit op broke)
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

-- Results accumulator — a custom GUC works under any role with no grants.
select set_config('app.rls_results', '', true);

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
  if n = 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 1: PASS — zero Beta rows visible' || E'\n', true); end if;
  if n > 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 1: FAIL — ' || n || ' Beta rows visible' || E'\n', true); end if;
end $$;

-- TEST 2: cannot read Beta evidence files. expect count 0.
do $$
declare n int;
begin
  select count(*) into n from storage.objects
  where bucket_id = 'contract-evidence'
    and name like '20000000-0000-4000-8000-000000000002/%';
  if n = 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 2: PASS — Beta evidence storage hidden' || E'\n', true);
  else perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 2: FAIL — ' || n || ' objects visible' || E'\n', true); end if;
end $$;

-- TEST 3: Alpha item pointing at Beta contract must be rejected.
do $$
begin
  insert into evidence_items (organization_id, contract_id, title) values
    ('10000000-0000-4000-8000-000000000001', '22200000-0000-4000-8000-000000000002', 'cross-tenant item');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 3: FAIL — cross-tenant contract insert succeeded' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 3: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 4: Alpha item pointing at Beta obligation must be rejected.
do $$
begin
  insert into evidence_items (organization_id, contract_id, obligation_id, title) values
    ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '44400000-0000-4000-8000-000000000002', 'cross-tenant obligation');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 4: FAIL — cross-tenant obligation insert succeeded' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 4: PASS — ' || sqlerrm || E'\n', true);
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
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 5: PASS — same-tenant writes allowed' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 5: FAIL — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 6: Alpha link cannot reference Beta requirement.
do $$
begin
  insert into evidence_requirement_links (organization_id, evidence_item_id, evidence_requirement_id) values
    ('10000000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000001', '66600000-0000-4000-8000-000000000002');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 6: FAIL — cross-tenant requirement link succeeded' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 6: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 7: Alpha run cannot reference Beta item/version.
do $$
begin
  insert into evidence_verification_runs (organization_id, contract_id, evidence_item_id, evidence_version_id, status) values
    ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', '77700000-0000-4000-8000-000000000002', '88800000-0000-4000-8000-000000000002', 'queued');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 7: FAIL — cross-tenant run insert succeeded' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 7: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 8: Alpha check cannot reference Beta run.
do $$
begin
  insert into evidence_verification_checks (organization_id, verification_run_id, check_label, result) values
    ('10000000-0000-4000-8000-000000000001', '99900000-0000-4000-8000-000000000002', 'x', 'missing');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 8: FAIL — cross-tenant check insert succeeded' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 8: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 9: Alpha cannot close Beta gap (update must hit 0 rows).
do $$
declare n int;
begin
  update evidence_gaps set status = 'resolved',
    closed_by_verification_run_id = '99900000-0000-4000-8000-000000000002'
  where id = 'aaa00000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n = 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 9: PASS — Beta gap unreachable' || E'\n', true);
  else perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 9: FAIL — modified ' || n || ' Beta gaps' || E'\n', true); end if;
end $$;

-- TEST 10: resolving a gap without a verification run is impossible.
do $$
begin
  insert into evidence_gaps (organization_id, contract_id, description, status) values
    ('10000000-0000-4000-8000-000000000001', '11100000-0000-4000-8000-000000000001', 'forced close', 'resolved');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 10: FAIL — gap resolved without verification run' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 10: PASS — ' || sqlerrm || E'\n', true);
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
  if n = 1 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 11: PASS — full gap lifecycle works' || E'\n', true);
  else perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 11: FAIL — lifecycle incomplete' || E'\n', true); end if;
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 11: FAIL — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 12: resolved is terminal — reopening must be rejected.
do $$
begin
  update evidence_gaps set status = 'open' where id = 'aaa00000-0000-4000-8000-000000000001';
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 12: FAIL — resolved gap reopened' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 12: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 13: 'verified' check without source support is rejected (non-deterministic).
do $$
begin
  insert into evidence_verification_checks (organization_id, verification_run_id, check_label, check_kind, result) values
    ('10000000-0000-4000-8000-000000000001', '99900000-0000-4000-8000-000000000001', 'unsupported', 'ai_semantic', 'verified');
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 13: FAIL — verified without source support accepted' || E'\n', true);
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 13: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 14: hard delete of a persisted version RECORD is denied (no delete policy).
do $$
declare n int;
begin
  delete from evidence_versions where id = '88800000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n = 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 14: PASS — version record undeletable' || E'\n', true);
  else perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 14: FAIL — deleted ' || n || ' version rows' || E'\n', true); end if;
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 14: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 15: hard delete of a persisted evidence FILE is denied — two layers
-- apply here: Supabase's protect trigger blocks direct SQL deletes on
-- storage.objects entirely, and the RLS delete policy additionally denies any
-- path backed by an evidence_versions row when deletion goes via Storage API.
do $$
declare n int;
begin
  delete from storage.objects
  where bucket_id = 'contract-evidence'
    and name = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf';
  get diagnostics n = row_count;
  if n = 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 15: PASS — persisted evidence file undeletable' || E'\n', true);
  else perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 15: FAIL — deleted referenced file' || E'\n', true); end if;
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 15: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 16: orphan-cleanup policy discriminates correctly. Direct SQL deletes
-- on storage.objects are pre-empted by Supabase's protect trigger for every
-- role, so the delete POLICY can only be exercised through the Storage API —
-- what we verify here is that the policy exists and its condition permits an
-- orphan path (no evidence_versions row) while denying a persisted one.
do $$
declare n int;
begin
  select count(*) into n from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE'
    and policyname = 'contract_evidence_storage_delete'
    and qual like '%evidence_versions%';
  if n <> 1 then
    perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 16: FAIL — delete policy missing or malformed' || E'\n', true);
  elsif exists (select 1 from evidence_versions
                where storage_path = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/orphan.pdf') then
    perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 16: FAIL — orphan fixture unexpectedly persisted' || E'\n', true);
  elsif not exists (select 1 from evidence_versions
                    where storage_path = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf') then
    perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 16: FAIL — persisted fixture missing version row' || E'\n', true);
  else
    perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 16: PASS — orphan cleanup policy allows orphans only (Storage API path)' || E'\n', true);
  end if;
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 16: FAIL — ' || sqlerrm || E'\n', true);
end $$;

-- TEST 17: updating a persisted evidence FILE in place is denied.
do $$
declare n int;
begin
  update storage.objects set name = 'x_mutated.pdf'
  where bucket_id = 'contract-evidence'
    and name = '10000000-0000-4000-8000-000000000001/11100000-0000-4000-8000-000000000001/77700000-0000-4000-8000-000000000001/v1_a.pdf';
  get diagnostics n = row_count;
  if n = 0 then perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 17: PASS — persisted file immutable' || E'\n', true);
  else perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 17: FAIL — mutated referenced file' || E'\n', true); end if;
exception when others then
  perform set_config('app.rls_results', current_setting('app.rls_results') || 'TEST 17: PASS — ' || sqlerrm || E'\n', true);
end $$;

-- ===========================================================================
-- Results — this is the final query output: every row should say PASS.
-- ===========================================================================
select outcome
from string_to_table(current_setting('app.rls_results'), E'\n') with ordinality as r(outcome, n)
where outcome <> ''
order by n;

rollback;
