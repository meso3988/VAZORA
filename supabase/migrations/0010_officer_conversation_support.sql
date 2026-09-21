-- ============================================================================
-- Phase 4A Checkpoint 2 — grounded conversation support
-- ============================================================================
-- Two genuine gaps found while building the conversation layer:
--
--   1. 0009 defaults organizations.timezone to 'UTC'. A real organization
--      silently left at UTC would get wrong "today"/"overdue" answers, so we
--      must be able to tell "never configured" apart from "deliberately UTC"
--      and prompt once.
--
--   2. getOrganizationMembers could only return opaque user ids, so the
--      Officer could not say who owns anything. auth.users is not readable
--      under RLS, so a narrow security-definer function exposes display
--      identity for FELLOW MEMBERS ONLY — no user-profile subsystem.
-- ============================================================================

alter table organizations
  add column timezone_set_at timestamptz;

comment on column organizations.timezone_set_at is
  'When an authorized human deliberately chose the timezone. NULL = never configured; the workspace prompts once before the Officer gives date-sensitive answers.';

-- ---------------------------------------------------------------------------
-- Member display identity — email + metadata name for members of ONE
-- organization the caller already belongs to. Returns nothing otherwise, so
-- it cannot be used to enumerate users of another tenant.
-- ---------------------------------------------------------------------------

create or replace function org_member_identities (org uuid)
returns table (user_id uuid, email text, display_name text)
language sql stable security definer
set search_path = public
as $$
  select
    m.user_id,
    u.email::text,
    coalesce(
      nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
      split_part(u.email::text, '@', 1)
    ) as display_name
  from organization_members m
  join auth.users u on u.id = m.user_id
  where m.organization_id = org
    and is_org_member (org);
$$;

revoke all on function org_member_identities (uuid) from public;
grant execute on function org_member_identities (uuid) to authenticated;
