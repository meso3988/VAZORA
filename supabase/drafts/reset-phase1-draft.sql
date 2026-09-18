-- ============================================================================
-- VAZORA — one-off reset: drop the Phase 1 draft schema
--
-- Use ONLY on a fresh dev project that accidentally got
-- supabase/drafts/phase1-full-schema-draft.sql applied. There is no real
-- tenant data at this stage.
--
-- Run this FIRST in the SQL editor, then run
-- supabase/migrations/0001_phase2a_foundation.sql right after.
-- ============================================================================

drop table if exists claim_requirements cascade;
drop table if exists agent_events cascade;
drop table if exists claims cascade;
drop table if exists actions cascade;
drop table if exists risks cascade;
drop table if exists evidence cascade;
drop table if exists obligations cascade;
drop table if exists clauses cascade;
drop table if exists contracts cascade;
drop table if exists projects cascade;
drop table if exists organization_members cascade;
drop table if exists organizations cascade;

drop function if exists is_org_member cascade;

drop type if exists member_role cascade;
drop type if exists contract_status cascade;
drop type if exists obligation_status cascade;
drop type if exists evidence_status cascade;
drop type if exists risk_severity cascade;
drop type if exists claim_status cascade;
