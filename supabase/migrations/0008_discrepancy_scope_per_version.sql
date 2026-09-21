-- ============================================================================
-- Phase 3 stability patch — review fix: scope pending discrepancies per
-- evidence VERSION, not just per (item, requirement).
-- ============================================================================
-- 0007 allowed only one PENDING discrepancy per (item, requirement). A stale
-- unreviewed discrepancy on version 1 therefore swallowed a legitimate,
-- independently-detected discrepancy on version 2 — and, worse, suppressed
-- the gap that version 2 should have produced.
--
-- Each immutable version is a distinct factual question ("does THIS file
-- prove the criterion?"), so each version carries at most one pending
-- discrepancy. Reruns of the same version still collapse into one row.
-- ============================================================================

drop index if exists evidence_discrepancy_one_pending;

create unique index evidence_discrepancy_one_pending_per_version
  on evidence_verification_discrepancies (
    evidence_item_id, evidence_requirement_id, evidence_version_id
  )
  where status = 'pending';
