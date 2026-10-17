-- ---------------------------------------------------------------------------
-- 0013 — Officer proposal identity (idempotency at the data boundary)
--
-- Problem (Phase 4A full gate, A05 run 3): duplicate protection compared the
-- model's free-text arguments exactly, so a paraphrased repeat of the same
-- unresolved follow-up created a second open proposal.
--
-- Fix: the application derives a canonical identity SERVER-SIDE from the
-- authorized structured target (contract → obligation → evidence gap), the
-- action type and its operational parameters (e.g. assignee). Free text never
-- participates. The database enforces at most ONE OPEN proposal per identity
-- per organization, atomically, so concurrent requests cannot both insert.
--
-- Additive only: historical rows keep idempotency_key = NULL and are neither
-- modified nor deleted; the partial index ignores them. Decided proposals
-- (approved, completed, rejected, failed, cancelled) are outside the index,
-- so a legitimate later follow-up on the same target is allowed.
-- ---------------------------------------------------------------------------

alter table officer_actions
  add column idempotency_key text,
  add column evidence_gap_id uuid references evidence_gaps (id) on delete set null;

create unique index officer_actions_open_identity
  on officer_actions (organization_id, idempotency_key)
  where idempotency_key is not null
    and status in ('suggested', 'waiting_for_approval');

comment on column officer_actions.idempotency_key is
  'server-derived canonical identity: action type + structured target + operational parameters; never free text';
comment on column officer_actions.evidence_gap_id is
  'structured target when a proposal concerns one specific evidence gap';
