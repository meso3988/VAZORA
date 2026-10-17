-- ============================================================================
-- VAZORA — Phase 3 evidence policy hardening
--
-- Applies the hardened RLS state to a database that ran the ORIGINAL version
-- of 0005_phase3_evidence.sql (which shipped `for all` table policies —
-- including DELETE — and unrestricted storage update/delete policies).
--
-- Safe to run whether the database has the old or the new 0005: every policy
-- is dropped-if-exists then recreated with the hardened definition, so this
-- converges either starting point to the same state. Run once in SQL Editor.
--
-- Resulting rules (identical to current 0005):
--   * Evidence tables: select/insert/update only — NO member delete anywhere.
--     Hard deletion is a service-role/DB-admin operation (server-side only).
--   * Storage: members may update/delete ONLY orphan objects — paths with no
--     matching evidence_versions.storage_path row (failed-upload rollback).
--     Persisted evidence files are immutable audit records.
-- ============================================================================

-- --- Table policies: drop the old `for all` forms, install split set --------

drop policy if exists evidence_items_tenant on evidence_items;
drop policy if exists evidence_items_select on evidence_items;
drop policy if exists evidence_items_insert on evidence_items;
drop policy if exists evidence_items_update on evidence_items;
drop policy if exists evidence_items_delete on evidence_items;

create policy evidence_items_select on evidence_items
  for select using (is_org_member (organization_id));
create policy evidence_items_insert on evidence_items
  for insert with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
  );
create policy evidence_items_update on evidence_items
  for update
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
  );

drop policy if exists evidence_versions_tenant on evidence_versions;
drop policy if exists evidence_versions_select on evidence_versions;
drop policy if exists evidence_versions_insert on evidence_versions;
drop policy if exists evidence_versions_update on evidence_versions;
drop policy if exists evidence_versions_delete on evidence_versions;

create policy evidence_versions_select on evidence_versions
  for select using (is_org_member (organization_id));
create policy evidence_versions_insert on evidence_versions
  for insert with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
  );
create policy evidence_versions_update on evidence_versions
  for update
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
  );

drop policy if exists evidence_req_links_tenant on evidence_requirement_links;
drop policy if exists evidence_req_links_select on evidence_requirement_links;
drop policy if exists evidence_req_links_insert on evidence_requirement_links;
drop policy if exists evidence_req_links_update on evidence_requirement_links;
drop policy if exists evidence_req_links_delete on evidence_requirement_links;

create policy evidence_req_links_select on evidence_requirement_links
  for select using (is_org_member (organization_id));
create policy evidence_req_links_insert on evidence_requirement_links
  for insert with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and (evidence_version_id is null or valid_evidence_version_for_org (evidence_version_id, organization_id))
    and valid_evidence_requirement_for_org (evidence_requirement_id, organization_id)
  );
create policy evidence_req_links_update on evidence_requirement_links
  for update
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and (evidence_version_id is null or valid_evidence_version_for_org (evidence_version_id, organization_id))
    and valid_evidence_requirement_for_org (evidence_requirement_id, organization_id)
  );

drop policy if exists verification_runs_tenant on evidence_verification_runs;
drop policy if exists verification_runs_select on evidence_verification_runs;
drop policy if exists verification_runs_insert on evidence_verification_runs;
drop policy if exists verification_runs_update on evidence_verification_runs;
drop policy if exists verification_runs_delete on evidence_verification_runs;

create policy verification_runs_select on evidence_verification_runs
  for select using (is_org_member (organization_id));
create policy verification_runs_insert on evidence_verification_runs
  for insert with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and valid_evidence_version_for_org (evidence_version_id, organization_id)
  );
create policy verification_runs_update on evidence_verification_runs
  for update
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and valid_evidence_item_for_org (evidence_item_id, organization_id)
    and valid_evidence_version_for_org (evidence_version_id, organization_id)
  );

drop policy if exists verification_checks_tenant on evidence_verification_checks;
drop policy if exists verification_checks_select on evidence_verification_checks;
drop policy if exists verification_checks_insert on evidence_verification_checks;
drop policy if exists verification_checks_update on evidence_verification_checks;
drop policy if exists verification_checks_delete on evidence_verification_checks;

create policy verification_checks_select on evidence_verification_checks
  for select using (is_org_member (organization_id));
create policy verification_checks_insert on evidence_verification_checks
  for insert with check (
    is_org_member (organization_id)
    and valid_verification_run_for_org (verification_run_id, organization_id)
    and (evidence_requirement_id is null or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
  );
create policy verification_checks_update on evidence_verification_checks
  for update
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_verification_run_for_org (verification_run_id, organization_id)
    and (evidence_requirement_id is null or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
  );

drop policy if exists evidence_gaps_tenant on evidence_gaps;
drop policy if exists evidence_gaps_select on evidence_gaps;
drop policy if exists evidence_gaps_insert on evidence_gaps;
drop policy if exists evidence_gaps_update on evidence_gaps;
drop policy if exists evidence_gaps_delete on evidence_gaps;

create policy evidence_gaps_select on evidence_gaps
  for select using (is_org_member (organization_id));
create policy evidence_gaps_insert on evidence_gaps
  for insert with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and (evidence_requirement_id is null or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
    and (verification_run_id is null or valid_verification_run_for_org (verification_run_id, organization_id))
    and (closed_by_verification_run_id is null or valid_verification_run_for_org (closed_by_verification_run_id, organization_id))
  );
create policy evidence_gaps_update on evidence_gaps
  for update
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
    and (obligation_id is null or valid_obligation_for_org (obligation_id, organization_id))
    and (evidence_requirement_id is null or valid_evidence_requirement_for_org (evidence_requirement_id, organization_id))
    and (verification_run_id is null or valid_verification_run_for_org (verification_run_id, organization_id))
    and (closed_by_verification_run_id is null or valid_verification_run_for_org (closed_by_verification_run_id, organization_id))
  );

-- --- Storage policies on contract-evidence: recreate the hardened set -------

drop policy if exists contract_evidence_storage_select on storage.objects;
drop policy if exists contract_evidence_storage_insert on storage.objects;
drop policy if exists contract_evidence_storage_update on storage.objects;
drop policy if exists contract_evidence_storage_delete on storage.objects;

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

-- Update restricted: overwriting an object that backs a persisted version
-- would mutate audit evidence in place. Orphans only.
create policy contract_evidence_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
    and not exists (
      select 1 from evidence_versions v where v.storage_path = name
    )
  )
  with check (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
    and not exists (
      select 1 from evidence_versions v where v.storage_path = name
    )
  );

-- Members may delete ONLY orphan objects (uploaded but never persisted).
-- Persisted evidence files are immutable; hard deletion is service-role /
-- DB-admin only, server-side. No user-facing hard-delete path exists.
create policy contract_evidence_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contract-evidence'
    and storage_org_member (name)
    and not exists (
      select 1 from evidence_versions v where v.storage_path = name
    )
  );
