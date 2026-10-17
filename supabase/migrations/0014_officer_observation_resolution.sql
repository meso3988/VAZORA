-- ---------------------------------------------------------------------------
-- 0014 — Atomic, verified resolution of Officer observations (per contract)
--
-- Problem (sweep publication): observations were resolved one UPDATE at a
-- time and success was inferred from "no error". A failure after an earlier
-- resolution left the contract PARTIALLY resolved while its publication was
-- reported as failed, and an UPDATE matching zero rows counted as success.
--
-- Fix: the sweep resolves one contract's set of observations in a single
-- call. Either every expected row changes, or none does: if the number of
-- rows actually updated differs from the number requested (missing, already
-- decided, or inaccessible rows), the function raises and the whole
-- statement rolls back.
--
-- SECURITY INVOKER: runs with the caller's rights, so row-level security and
-- tenant isolation apply exactly as for a direct UPDATE. No bypass.
-- Additive only: no table or existing row is modified by this migration.
-- ---------------------------------------------------------------------------

create or replace function officer_resolve_observations(
  p_organization_id uuid,
  p_ids uuid[],
  p_resolved_at timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  expected integer := coalesce(cardinality(p_ids), 0);
  updated integer;
begin
  if expected = 0 then
    return 0;
  end if;
  if (select count(distinct x) from unnest(p_ids) as x) <> expected then
    raise exception 'officer_resolve_observations: duplicate ids' using errcode = '22023';
  end if;

  update officer_observations
     set status = 'resolved',
         resolved_at = p_resolved_at,
         time_bucket = 'resolved',
         last_seen_at = p_resolved_at
   where organization_id = p_organization_id
     and id = any (p_ids)
     and status in ('active', 'acknowledged');
  get diagnostics updated = row_count;

  if updated <> expected then
    raise exception 'officer_resolve_observations: expected % rows, updated %', expected, updated
      using errcode = 'P0001';
  end if;
  return updated;
end;
$$;

revoke all on function officer_resolve_observations (uuid, uuid[], timestamptz) from public;
grant execute on function officer_resolve_observations (uuid, uuid[], timestamptz) to authenticated;

comment on function officer_resolve_observations (uuid, uuid[], timestamptz) is
  'resolve a set of observations all-or-nothing; raises (rolls back) unless every requested row changed; RLS applies';
