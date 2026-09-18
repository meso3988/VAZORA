-- ============================================================================
-- VAZORA — Phase 2A fix: organizations SELECT for the creator
--
-- Problem: INSERT ... RETURNING (our onboarding does .select("id") to get the
-- new org id) also evaluates SELECT policies for the returned row. The
-- original policy allowed members only, but membership is created AFTER the
-- organization row, so the bootstrap insert was rejected (42501).
--
-- Fix: creators may read organizations they created (before membership is
-- recorded). This only widens visibility to the creator for the bootstrap
-- window — other tenants still cannot see the row.
-- ============================================================================

drop policy if exists organizations_select on organizations;

create policy organizations_select on organizations
  for select using (
    is_org_member (id) or created_by = auth.uid ()
  );
