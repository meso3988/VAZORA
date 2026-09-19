-- One-off: undo a partial application of 0004_phase2b_ingestion.sql
-- (the failed run created types/tables before hitting the FK error).
-- Safe: drops only Phase 2B objects. Re-run 0004 after this.

drop table if exists obligation_assignment_suggestions cascade;
drop table if exists obligation_evidence_requirements cascade;
drop table if exists obligation_source_refs cascade;
drop table if exists contract_obligations cascade;
drop table if exists contract_clauses cascade;
drop table if exists contract_ingestion_runs cascade;

drop function if exists obligation_activation_gate cascade;
drop function if exists valid_ingestion_for_org cascade;
drop function if exists valid_document_for_org cascade;
drop function if exists valid_clause_for_org cascade;
drop function if exists valid_obligation_for_org cascade;
drop function if exists valid_source_ref_for_org cascade;
drop function if exists valid_member_for_org cascade;

-- document_relationship added to contract_documents (idempotent in re-run).
alter table contract_documents
  drop column if exists document_relationship,
  drop column if exists document_version,
  drop column if exists effective_date,
  drop column if exists supersedes_document_id;

drop type if exists ingestion_status cascade;
drop type if exists contract_document_relationship cascade;
drop type if exists obligation_type cascade;
drop type if exists evidence_requirement_type cascade;
drop type if exists submission_channel cascade;
drop type if exists extraction_review_status cascade;
drop type if exists obligation_activation_status cascade;
drop type if exists provenance_kind cascade;
drop type if exists assignment_confidence cascade;
