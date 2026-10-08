-- ============================================================================
-- 0015 — obligation cycle settlements + single running sweep per organization
-- Additive only. Apply to the intended environment after review.
--
-- A settlement records that an AUTHORIZED member recorded the completion of
-- ONE cycle of an obligation. It does not verify evidence, record client
-- acceptance, submit a claim or make anything payable; it never changes a due
-- date, a verification result or an evidence gap.
-- ============================================================================

create type obligation_cycle_settlement_status as enum ('active', 'voided');

create table obligation_cycle_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  obligation_id uuid not null references contract_obligations (id) on delete cascade,
  -- the scheduled cycle this settlement is for (one cycle, never a range)
  cycle_due_date date not null,
  -- actual completion date as entered by the user (optional); separate from
  -- the recording time below
  completed_on date,
  note text not null check (length(btrim(note)) between 1 and 1000),
  evidence_item_id uuid references evidence_items (id) on delete set null,
  evidence_version_id uuid references evidence_versions (id) on delete set null,
  -- actor and time come from the session and the database, never the client
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  status obligation_cycle_settlement_status not null default 'active',
  voided_by uuid references auth.users (id),
  voided_at timestamptz,
  void_reason text,
  constraint settlement_void_shape check (
    (status = 'active' and voided_by is null and voided_at is null and void_reason is null)
    or (status = 'voided' and voided_by is not null and voided_at is not null and length(btrim(void_reason)) between 1 and 1000)
  )
);

-- At most one ACTIVE settlement per obligation cycle (double clicks and
-- concurrent requests collapse to one; the loser gets a unique violation).
create unique index obligation_cycle_settlements_one_active
  on obligation_cycle_settlements (obligation_id, cycle_due_date)
  where status = 'active';
create index obligation_cycle_settlements_org_obligation
  on obligation_cycle_settlements (organization_id, obligation_id);

alter table obligation_cycle_settlements enable row level security;

-- Members read their organization's settlements. There is NO insert/update/
-- delete policy: writes go only through the functions below, which check the
-- role server-side. History is never deleted; a wrong record is voided.
create policy obligation_cycle_settlements_select on obligation_cycle_settlements
  for select using (is_org_member (organization_id));

revoke all on obligation_cycle_settlements from anon;
grant select on obligation_cycle_settlements to authenticated;

-- ---------------------------------------------------------------------------
-- record_obligation_cycle_settlement — owner/admin only (member_role enum).
-- Validates: active operational obligation in the caller's organization,
-- the date is a cycle of its approved schedule inside the contract period,
-- evidence (optional) belongs to this obligation and is not already used for
-- another cycle. Settlement + audit row are written in one transaction.
-- ---------------------------------------------------------------------------
create or replace function record_obligation_cycle_settlement (
  p_obligation_id uuid,
  p_cycle_due_date date,
  p_completed_on date,
  p_note text,
  p_evidence_item_id uuid default null,
  p_evidence_version_id uuid default null
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_ob record;
  v_today date;
  v_rule text;
  v_day int;
  v_expected date;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;

  select o.id, o.organization_id, o.contract_id, o.review_status, o.activation_status,
         o.due_date_normalized, lower(btrim(o.due_rule_normalized)) as rule,
         c.start_date, c.end_date, org.timezone
    into v_ob
    from contract_obligations o
    join contracts c on c.id = o.contract_id and c.organization_id = o.organization_id
    join organizations org on org.id = o.organization_id
   where o.id = p_obligation_id;
  if not found or not is_org_member (v_ob.organization_id) then
    raise exception 'obligation_not_found' using errcode = 'P0002';
  end if;
  if not is_org_owner_or_admin (v_ob.organization_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_ob.review_status <> 'approved' or v_ob.activation_status <> 'active' then
    raise exception 'obligation_not_operational' using errcode = 'P0001';
  end if;
  if p_note is null or length(btrim(p_note)) = 0 then
    raise exception 'note_required' using errcode = 'P0001';
  end if;

  v_today := (now() at time zone coalesce(nullif(v_ob.timezone, ''), 'UTC'))::date;

  -- The cycle must belong to the approved schedule (mirrors the supported
  -- rules of lib/officer/schedule.ts: explicit date, monthly_day_N, monthly_end).
  if v_ob.due_date_normalized is not null then
    if p_cycle_due_date <> v_ob.due_date_normalized then
      raise exception 'not_a_scheduled_cycle' using errcode = 'P0001';
    end if;
  else
    v_rule := v_ob.rule;
    if v_rule = 'monthly_end' then
      v_expected := (date_trunc('month', p_cycle_due_date) + interval '1 month - 1 day')::date;
    elsif v_rule ~ '^monthly_day_([1-9]|[12][0-9]|3[01])$' then
      v_day := substring(v_rule from 'monthly_day_(\d+)')::int;
      v_expected := least(
        (date_trunc('month', p_cycle_due_date) + (v_day - 1) * interval '1 day')::date,
        (date_trunc('month', p_cycle_due_date) + interval '1 month - 1 day')::date);
    else
      raise exception 'schedule_not_defined' using errcode = 'P0001';
    end if;
    if p_cycle_due_date <> v_expected
       or v_ob.start_date is null
       or p_cycle_due_date < v_ob.start_date
       or (v_ob.end_date is not null and p_cycle_due_date > v_ob.end_date) then
      raise exception 'not_a_scheduled_cycle' using errcode = 'P0001';
    end if;
  end if;
  -- Only a cycle that is due (or the next one, up to 31 days ahead) can be settled.
  if p_cycle_due_date > v_today + 31 then
    raise exception 'cycle_not_yet_due' using errcode = 'P0001';
  end if;
  if p_completed_on is not null and p_completed_on > v_today then
    raise exception 'completion_date_in_future' using errcode = 'P0001';
  end if;

  if p_evidence_version_id is not null and p_evidence_item_id is null then
    raise exception 'evidence_item_required' using errcode = 'P0001';
  end if;
  if p_evidence_item_id is not null then
    if not exists (
      select 1 from evidence_items ei
       where ei.id = p_evidence_item_id
         and ei.organization_id = v_ob.organization_id
         and (ei.obligation_id = v_ob.id
              or exists (select 1 from evidence_requirement_links l
                           join obligation_evidence_requirements r on r.id = l.evidence_requirement_id
                          where l.evidence_item_id = ei.id and r.obligation_id = v_ob.id))
    ) then
      raise exception 'evidence_out_of_scope' using errcode = 'P0001';
    end if;
    if p_evidence_version_id is not null and not exists (
      select 1 from evidence_versions v
       where v.id = p_evidence_version_id and v.evidence_item_id = p_evidence_item_id
         and v.organization_id = v_ob.organization_id
    ) then
      raise exception 'evidence_version_out_of_scope' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from obligation_cycle_settlements s
       where s.obligation_id = v_ob.id and s.status = 'active'
         and s.cycle_due_date <> p_cycle_due_date
         and s.evidence_item_id = p_evidence_item_id
         and coalesce(s.evidence_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(p_evidence_version_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) then
      raise exception 'evidence_used_for_other_cycle' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into obligation_cycle_settlements
      (organization_id, obligation_id, cycle_due_date, completed_on, note,
       evidence_item_id, evidence_version_id, recorded_by)
    values
      (v_ob.organization_id, v_ob.id, p_cycle_due_date, p_completed_on, btrim(p_note),
       p_evidence_item_id, p_evidence_version_id, v_uid)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'cycle_already_settled' using errcode = 'P0001';
  end;

  insert into activity_log (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_ob.organization_id, v_uid, 'obligation.cycle_settled', 'obligation', v_ob.id,
          jsonb_build_object('settlement_id', v_id, 'cycle_due_date', p_cycle_due_date,
                             'completed_on', p_completed_on, 'contract_id', v_ob.contract_id,
                             'evidence_item_id', p_evidence_item_id, 'evidence_version_id', p_evidence_version_id));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- void_obligation_cycle_settlement — correct a wrong record. Owner/admin,
-- reason required; the row is kept (status voided) and the audit records it.
-- ---------------------------------------------------------------------------
create or replace function void_obligation_cycle_settlement (
  p_settlement_id uuid,
  p_reason text
) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid ();
  v_s record;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  select s.*, o.contract_id into v_s
    from obligation_cycle_settlements s
    join contract_obligations o on o.id = s.obligation_id
   where s.id = p_settlement_id;
  if not found or not is_org_member (v_s.organization_id) then
    raise exception 'settlement_not_found' using errcode = 'P0002';
  end if;
  if not is_org_owner_or_admin (v_s.organization_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  update obligation_cycle_settlements
     set status = 'voided', voided_by = v_uid, voided_at = now(), void_reason = btrim(p_reason)
   where id = p_settlement_id and status = 'active';
  if not found then
    raise exception 'settlement_not_active' using errcode = 'P0001';
  end if;
  insert into activity_log (organization_id, actor_user_id, event_type, entity_type, entity_id, metadata)
  values (v_s.organization_id, v_uid, 'obligation.cycle_settlement_voided', 'obligation', v_s.obligation_id,
          jsonb_build_object('settlement_id', p_settlement_id, 'cycle_due_date', v_s.cycle_due_date,
                             'reason', btrim(p_reason), 'contract_id', v_s.contract_id));
end;
$$;

revoke all on function record_obligation_cycle_settlement (uuid, date, date, text, uuid, uuid) from public, anon;
revoke all on function void_obligation_cycle_settlement (uuid, text) from public, anon;
grant execute on function record_obligation_cycle_settlement (uuid, date, date, text, uuid, uuid) to authenticated;
grant execute on function void_obligation_cycle_settlement (uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- One RUNNING sweep per organization, enforced by the database (shared by
-- manual and scheduled runs across processes). A run that stops without
-- finishing is reclaimed by the next start after its lease (see sweep.ts).
-- ---------------------------------------------------------------------------
-- Runs left 'running' by a stopped process would block the index; they are
-- closed as failed (abandoned), never published as fresh.
update officer_sweep_runs
   set status = 'failed',
       completed_at = coalesce(completed_at, now()),
       failures = failures || '[{"contract_id":"organization","error":"sweep_run_abandoned"}]'::jsonb
 where status = 'running'
   and started_at < now() - interval '15 minutes';

create unique index officer_sweep_runs_one_running
  on officer_sweep_runs (organization_id)
  where status = 'running';
