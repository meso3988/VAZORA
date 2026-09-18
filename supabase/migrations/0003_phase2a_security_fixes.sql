-- ============================================================================
-- VAZORA — Phase 2A security fixes (found in the final review)
--
-- 1. CRITICAL — member self-promote: the old members_update policy allowed any
--    member to PATCH their own row to role='owner':
--      PATCH /rest/v1/organization_members?user_id=eq.<me>  { role: "owner" }
--    Verified live: HTTP 200, row updated. Reproduced during final review.
--    Fix: only owners may change membership roles; members leave via DELETE on
--    their own row.
--
-- 2. CRITICAL — owner demote/removal by non-owner: same policy let admins (or
--    the escalated member) alter an owner's membership. Fix: role changes are
--    owner-only; owners cannot remove the last owner of their org (self-delete
--    of an owner row is also owner-visible, see members_delete).
--
-- 3. HIGH — cross-tenant project link: contracts_tenant's WITH CHECK checked
--    the row's organization but not that project_id belongs to the same org —
--    an Alpha contract could reference a Beta project (verified live, 201).
--    Fix: valid_project_for_org() pins the project to the contract's tenant.
--
-- 4. HIGH — cross-tenant contract link on documents: identical shape — a
--    document row could reference another org's contract id. Fix identically.
--
-- 5. LOW — demo_requests accepted arbitrary status/source values
--    (with check (true)); e.g. status='converted' could be submitted by anon.
--    Tighten to the values the public form can legitimately create.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function is_org_owner (org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from organization_members m
    where m.organization_id = org
      and m.user_id = auth.uid ()
      and m.role = 'owner'
  );
$$;

create or replace function valid_project_for_org (proj uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from projects p
    where p.id = proj
      and p.organization_id = org
  );
$$;

create or replace function valid_contract_for_org (ctr uuid, org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1
    from contracts c
    where c.id = ctr
      and c.organization_id = org
  );
$$;

-- ---------------------------------------------------------------------------
-- Fix 1+2: membership administration is owner-only.
-- ---------------------------------------------------------------------------

drop policy if exists members_update on organization_members;

create policy members_update on organization_members
  for update to authenticated
  using (is_org_owner (organization_id))
  with check (is_org_owner (organization_id));

-- members_delete: owners may remove non-owner rows; anyone may remove their
-- own row to leave. An owner can only remove themselves by first handing the
-- role to someone else (or deleting the whole org).
drop policy if exists members_delete on organization_members;

create policy members_delete on organization_members
  for delete to authenticated
  using (
    (
      user_id = auth.uid ()
      and role <> 'owner'
    )
    or (
      is_org_owner (organization_id)
      and role <> 'owner'
    )
  );

-- members_insert: startup bootstrap for creators; afterwards owner/admin may
-- add members, but only owners may mint owner/admin roles.
drop policy if exists members_insert on organization_members;

create policy members_insert on organization_members
  for insert to authenticated
  with check (
    (
      is_org_owner_or_admin (organization_id)
      and (role = 'member' or is_org_owner (organization_id))
    )
    or exists (
      select 1 from organizations o
      where o.id = organization_id
        and o.created_by = auth.uid ()
    )
  );

-- ---------------------------------------------------------------------------
-- Fix 3: contracts may only reference same-organization projects.
-- ---------------------------------------------------------------------------

drop policy if exists contracts_tenant on contracts;

create policy contracts_tenant on contracts
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and (
      project_id is null
      or valid_project_for_org (project_id, organization_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Fix 4: document rows may only reference same-organization contracts.
-- ---------------------------------------------------------------------------

drop policy if exists contract_documents_tenant on contract_documents;

create policy contract_documents_tenant on contract_documents
  for all
  using (is_org_member (organization_id))
  with check (
    is_org_member (organization_id)
    and valid_contract_for_org (contract_id, organization_id)
  );

-- ---------------------------------------------------------------------------
-- Fix 5: public demo inserts create only untouched lead rows.
-- ---------------------------------------------------------------------------

drop policy if exists demo_requests_public_insert on demo_requests;

create policy demo_requests_public_insert on demo_requests
  for insert to anon, authenticated
  with check (
    status = 'new'
    and source = 'demo-form'
  );
