-- ============================================================================
-- VAZORA — activity_log recording time is database-controlled
--
-- Problem (reproduced by supabase/tests/activity-audit-time.test.ts):
-- activity_log.created_at had only `default now()`, and the INSERT policy
-- (activity_insert, 0001) checks membership and actor — not the timestamp.
-- Any authenticated member could therefore supply created_at through the API:
--   * back-dating hides an event from "what changed since …" windows
--   * future-dating keeps an event looking "new" indefinitely
--
-- Fix: a BEFORE INSERT trigger stamps created_at with the database clock on
-- every insert, whatever the client sent.
--   * Applies to every role. There is no bypass: a legitimate backfill is not
--     a product feature, and an audit clock that can be set is not a clock.
--   * INSERT only. Existing (historical) rows are not touched; UPDATE and
--     DELETE stay revoked from authenticated/anon (0001).
--   * created_at means audit RECORDING time. No separate occurrence time is
--     stored: no writer records an event that happened earlier than it is
--     logged, and "what changed" readers (getRecentActivity, Today Brief)
--     are defined on recording time. If a future feature must record a past
--     occurrence, it gets its own column; it must never reuse created_at.
--   * now() is the transaction timestamp — identical to the column default,
--     so ordinary inserts are unaffected.
-- ============================================================================

create or replace function activity_log_stamp_recorded_at () returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at = now();
  return new;
end;
$$;

drop trigger if exists activity_log_recorded_at on activity_log;

create trigger activity_log_recorded_at
  before insert on activity_log
  for each row execute function activity_log_stamp_recorded_at ();

comment on column activity_log.created_at is
  'Audit recording time, stamped by the database on insert (trigger activity_log_recorded_at). Not client-settable.';
