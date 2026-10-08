#!/usr/bin/env bash
# Database-level checks for migration 0015 (cycle settlements + one running
# sweep per organization), run against a THROWAWAY local Postgres that has
# migrations 0001–0015 applied on top of supabase/tests/local-supabase-stubs.sql.
# Never point this at a hosted database.
#
#   PGHOST=/tmp PGPORT=54329 PGDATABASE=vz bash supabase/tests/db-cycle-settlements.sh
set -u
set -o pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGDATABASE:?}"
case "$PGHOST" in /tmp|localhost|127.0.0.1) ;; *) echo "refusing non-local PGHOST=$PGHOST"; exit 2;; esac
PSQL="psql -U postgres -X -At -q"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FAIL  $1 — expected [$3] got [$2]"; fi; }
sql() { $PSQL -c "$1" 2>&1 | tail -1; }
# Run as an authenticated end user (RLS applies, role = authenticated).
# Prints the function result, or the error message alone.
as() {
  local out; out=$(printf "begin;\nset local role authenticated;\nselect set_config('request.jwt.claim.sub', '%s', true);\n%s;\ncommit;\n" "$1" "$2" | $PSQL 2>&1)
  if echo "$out" | grep -q 'ERROR:'; then echo "$out" | grep -m1 'ERROR:' | sed -E 's/^.*ERROR: +//'; else echo "$out" | grep -v '^$' | tail -1; fi
}

ORG=11111111-0000-0000-0000-000000000001; FOREIGN_ORG=11111111-0000-0000-0000-000000000002
OWNER=22222222-0000-0000-0000-000000000001; ADMIN=22222222-0000-0000-0000-000000000002
MEMBER=22222222-0000-0000-0000-000000000003; OUTSIDER=22222222-0000-0000-0000-000000000004
K=33333333-0000-0000-0000-000000000001; FK=33333333-0000-0000-0000-000000000002
RUN=44444444-0000-0000-0000-000000000001; FRUN=44444444-0000-0000-0000-000000000002
OB=55555555-0000-0000-0000-000000000001; OB_DATED=55555555-0000-0000-0000-000000000002
OB_EVENT=55555555-0000-0000-0000-000000000003; OB_DRAFT=55555555-0000-0000-0000-000000000004
FOB=55555555-0000-0000-0000-000000000005; OB_OTHER=55555555-0000-0000-0000-000000000006
EV=66666666-0000-0000-0000-000000000001; EV_OTHER=66666666-0000-0000-0000-000000000002
EVV=77777777-0000-0000-0000-000000000001; EVV2=77777777-0000-0000-0000-000000000002
GAP=88888888-0000-0000-0000-000000000001
TODAY=$(sql "select (now() at time zone 'Asia/Riyadh')::date")

$PSQL -v ON_ERROR_STOP=1 >/dev/null <<SQL || { echo "seed failed"; exit 2; }
insert into auth.users (id, email) values ('$OWNER','o@qa'),('$ADMIN','a@qa'),('$MEMBER','m@qa'),('$OUTSIDER','x@qa');
insert into organizations (id, name, slug, created_by, timezone) values
  ('$ORG','QA','qa-db-1','$OWNER','Asia/Riyadh'), ('$FOREIGN_ORG','QA2','qa-db-2','$OUTSIDER','Asia/Riyadh');
insert into organization_members (organization_id, user_id, role) values
  ('$ORG','$OWNER','owner'),('$ORG','$ADMIN','admin'),('$ORG','$MEMBER','member'),('$FOREIGN_ORG','$OUTSIDER','owner');
insert into contracts (id, organization_id, contract_number, title, start_date, end_date, status) values
  ('$K','$ORG','K-1','K','2026-03-01','2027-12-31','active'), ('$FK','$FOREIGN_ORG','F-1','F','2026-03-01','2027-12-31','active');
insert into contract_ingestion_runs (id, organization_id, contract_id, status, parser_version, extractor_version) values
  ('$RUN','$ORG','$K','approved','t','t'), ('$FRUN','$FOREIGN_ORG','$FK','approved','t','t');
insert into contract_documents (id, organization_id, contract_id, file_name, storage_path, mime_type, file_size) values
  ('$K','$ORG','$K','k.pdf','k','application/pdf',1), ('$FK','$FOREIGN_ORG','$FK','f.pdf','f','application/pdf',1);
create temp table seed_ob (id uuid, organization_id uuid, contract_id uuid, ingestion_run_id uuid, title text, requirement_text text, due_rule_normalized text, due_date_normalized date, review_status text, activation_status text);
insert into seed_ob values
  ('$OB','$ORG','$K','$RUN','Monthly report','r','monthly_day_5',null,'approved','active'),
  ('$OB_DATED','$ORG','$K','$RUN','Dated','r',null,'2026-09-30','approved','active'),
  ('$OB_EVENT','$ORG','$K','$RUN','Event','r','Submit with each invoice.',null,'approved','active'),
  ('$OB_DRAFT','$ORG','$K','$RUN','Draft','r','monthly_day_5',null,'extracted','inactive'),
  ('$OB_OTHER','$ORG','$K','$RUN','Other','r','monthly_day_5',null,'approved','active'),
  ('$FOB','$FOREIGN_ORG','$FK','$FRUN','Foreign','r','monthly_day_5',null,'approved','active');
insert into contract_obligations (id, organization_id, contract_id, ingestion_run_id, title, requirement_text, due_rule_normalized, due_date_normalized)
  select id, organization_id, contract_id, ingestion_run_id, title, requirement_text, due_rule_normalized, due_date_normalized from seed_ob;
insert into obligation_source_refs (organization_id, obligation_id, document_id, source_snippet)
  select organization_id, id, contract_id, 'clause' from seed_ob;
update contract_obligations o set review_status = s.review_status::extraction_review_status, activation_status = s.activation_status::obligation_activation_status
  from seed_ob s where s.id = o.id;
insert into evidence_items (id, organization_id, contract_id, obligation_id, title, status) values
  ('$EV','$ORG','$K','$OB','Report Sep','partially_verified'), ('$EV_OTHER','$ORG','$K','$OB_OTHER','Other ev','verified');
insert into evidence_versions (id, organization_id, evidence_item_id, version_number, file_name, storage_path, mime_type, file_size, file_hash) values
  ('$EVV','$ORG','$EV',1,'a.pdf','p/a','application/pdf',1,'h1'), ('$EVV2','$ORG','$EV_OTHER',1,'b.pdf','p/b','application/pdf',1,'h2');
insert into evidence_gaps (id, organization_id, contract_id, obligation_id, gap_type, description, status) values
  ('$GAP','$ORG','$K','$OB','missing_evidence','No verified report','open');
SQL
REC="select record_obligation_cycle_settlement"

echo "-- record: authorization and scope (today $TODAY, Asia/Riyadh)"
check "member (not owner/admin) is refused" "$(as $MEMBER "$REC('$OB','2026-09-05',null,'done')")" "not_authorized"
check "user of another organization: obligation not found" "$(as $OUTSIDER "$REC('$OB','2026-09-05',null,'done')")" "obligation_not_found"
check "owner cannot record on a foreign organization's obligation" "$(as $OWNER "$REC('$FOB','2026-09-05',null,'done')")" "obligation_not_found"
check "unauthenticated call refused" "$($PSQL -c "begin; set local role authenticated; $REC('$OB','2026-09-05',null,'done'); commit;" 2>&1 | grep -o not_authenticated | head -1)" "not_authenticated"
check "anon cannot execute the function" "$($PSQL -c "begin; set local role anon; $REC('$OB','2026-09-05',null,'done'); commit;" 2>&1 | grep -o 'permission denied' | head -1)" "permission denied"
check "direct insert by an owner refused (no insert grant/policy)" "$(as $OWNER "insert into obligation_cycle_settlements (organization_id, obligation_id, cycle_due_date, note, recorded_by) values ('$ORG','$OB','2026-09-05','x','$OWNER')" | grep -o 'permission denied' | head -1)" "permission denied"
check "unapproved/inactive obligation refused" "$(as $OWNER "$REC('$OB_DRAFT','2026-09-05',null,'done')")" "obligation_not_operational"
check "note required" "$(as $OWNER "$REC('$OB','2026-09-05',null,'   ')")" "note_required"

echo "-- record: the cycle must belong to the schedule"
check "a date that is not a cycle (6th) refused" "$(as $OWNER "$REC('$OB','2026-09-06',null,'done')")" "not_a_scheduled_cycle"
check "a cycle before the contract start refused" "$(as $OWNER "$REC('$OB','2026-02-05',null,'done')")" "not_a_scheduled_cycle"
check "a cycle more than 31 days ahead refused" "$(as $OWNER "$REC('$OB','2027-02-05',null,'done')")" "cycle_not_yet_due"
check "completion date in the future refused" "$(as $OWNER "$REC('$OB','2026-09-05','2099-01-01','done')")" "completion_date_in_future"
check "event-based rule has no cycles to record" "$(as $OWNER "$REC('$OB_EVENT','2026-09-05',null,'done')")" "schedule_not_defined"
check "explicit-date obligation: only its date" "$(as $OWNER "$REC('$OB_DATED','2026-09-05',null,'done')")" "not_a_scheduled_cycle"

echo "-- record: evidence scope"
check "evidence of another obligation refused" "$(as $OWNER "$REC('$OB','2026-09-05',null,'done','$EV_OTHER')")" "evidence_out_of_scope"
check "version of another item refused" "$(as $OWNER "$REC('$OB','2026-09-05',null,'done','$EV','$EVV2')")" "evidence_version_out_of_scope"
check "version without item refused" "$(as $OWNER "$REC('$OB','2026-09-05',null,'done',null,'$EVV')")" "evidence_item_required"

echo "-- record: one cycle, actor and time from session/database"
S1=$(as $ADMIN "$REC('$OB','2026-09-05','2026-09-04','Sep report delivered','$EV','$EVV')")
check "admin records the Sep 5 cycle with evidence + version" "$(echo "$S1" | grep -cE '^[0-9a-f-]{36}$')" "1"
check "recorded_by = session user, recorded_at = database time, completed_on kept separately" \
  "$(sql "select recorded_by = '$ADMIN' and recorded_at > now() - interval '1 minute' and completed_on = '2026-09-04' and evidence_version_id = '$EVV' from obligation_cycle_settlements where id = '$S1'")" "t"
check "audit row written in the same transaction" "$(sql "select count(*) from activity_log where event_type = 'obligation.cycle_settled' and actor_user_id = '$ADMIN' and metadata->>'settlement_id' = '$S1' and metadata->>'cycle_due_date' = '2026-09-05'")" "1"
check "only that cycle is settled (no other cycle rows)" "$(sql "select string_agg(cycle_due_date::text, ',') from obligation_cycle_settlements where obligation_id = '$OB' and status = 'active'")" "2026-09-05"
check "same evidence version cannot settle another cycle" "$(as $OWNER "$REC('$OB','2026-08-05',null,'again','$EV','$EVV')")" "evidence_used_for_other_cycle"
check "repeat on the same cycle refused" "$(as $OWNER "$REC('$OB','2026-09-05',null,'double click')")" "cycle_already_settled"
check "member can read the organization's records (RLS select)" "$(as $MEMBER "select count(*) from obligation_cycle_settlements")" "1"
check "foreign-organization user reads nothing (RLS)" "$(as $OUTSIDER "select count(*) from obligation_cycle_settlements")" "0"
check "due date, evidence status and gap untouched" \
  "$(sql "select (select due_rule_normalized from contract_obligations where id = '$OB') || '|' || (select status from evidence_items where id = '$EV') || '|' || (select status from evidence_gaps where id = '$GAP')")" "monthly_day_5|partially_verified|open"

echo "-- concurrency: 8 simultaneous requests for one cycle"
for i in 1 2 3 4 5 6 7 8; do (as $OWNER "$REC('$OB','2026-07-05',null,'concurrent $i')" > "/tmp/vz-conc-$i.out") & done; wait
OKS=$(cat /tmp/vz-conc-*.out | grep -cE '^[0-9a-f-]{36}$'); DUPS=$(cat /tmp/vz-conc-*.out | grep -c cycle_already_settled); rm -f /tmp/vz-conc-*.out
check "exactly one succeeded, the other 7 got cycle_already_settled" "$OKS/$DUPS" "1/7"
check "exactly one active row and one audit row for the cycle" "$(sql "select (select count(*) from obligation_cycle_settlements where obligation_id = '$OB' and cycle_due_date = '2026-07-05' and status = 'active') || '/' || (select count(*) from activity_log where event_type = 'obligation.cycle_settled' and metadata->>'cycle_due_date' = '2026-07-05')")" "1/1"

echo "-- correction (void with reason; nothing deleted)"
VOID="select void_obligation_cycle_settlement"
check "member cannot void" "$(as $MEMBER "$VOID('$S1','wrong')")" "not_authorized"
check "outsider cannot see the record" "$(as $OUTSIDER "$VOID('$S1','wrong')")" "settlement_not_found"
check "reason required" "$(as $OWNER "$VOID('$S1','  ')")" "reason_required"
check "direct update / delete refused" "$(as $OWNER "update obligation_cycle_settlements set status = 'voided' where id = '$S1'" | grep -o 'permission denied' | head -1)|$(as $OWNER "delete from obligation_cycle_settlements where id = '$S1'" | grep -o 'permission denied' | head -1)" "permission denied|permission denied"
as $OWNER "$VOID('$S1','Recorded against the wrong month')" >/dev/null
check "owner voids: row kept with voided_by/at/reason" "$(sql "select status || '|' || (voided_by = '$OWNER') || '|' || void_reason from obligation_cycle_settlements where id = '$S1'")" "voided|true|Recorded against the wrong month"
check "void audited" "$(sql "select count(*) from activity_log where event_type = 'obligation.cycle_settlement_voided' and metadata->>'settlement_id' = '$S1' and metadata->>'reason' = 'Recorded against the wrong month'")" "1"
check "voiding twice refused" "$(as $OWNER "$VOID('$S1','again')")" "settlement_not_active"
S2=$(as $OWNER "$REC('$OB','2026-09-05',null,'Re-recorded correctly')")
check "cycle can be recorded again after the void; history has 2 rows (1 voided, 1 active)" "$(echo "$S2" | grep -cE '^[0-9a-f-]{36}$')|$(sql "select string_agg(status::text, ',' order by recorded_at) from obligation_cycle_settlements where obligation_id = '$OB' and cycle_due_date = '2026-09-05'")" "1|voided,active"
check "freed evidence version can be used for another cycle after the void" "$(as $OWNER "$REC('$OB','2026-08-05',null,'Aug','$EV','$EVV')" | grep -cE '^[0-9a-f-]{36}$')" "1"

echo "-- one running sweep per organization"
RUN_INS="insert into officer_sweep_runs (organization_id, status, trigger) values ('$ORG','running',"
sql "${RUN_INS}'manual')" >/dev/null
check "a second running run for the same organization is refused (23505)" "$($PSQL -c "${RUN_INS}'scheduled')" 2>&1 | grep -o 'officer_sweep_runs_one_running' | head -1)" "officer_sweep_runs_one_running"
check "another organization can run at the same time" "$($PSQL -c "insert into officer_sweep_runs (organization_id, status, trigger) values ('$FOREIGN_ORG','running','manual')" 2>&1 | grep -c ERROR)" "0"
for i in 1 2 3 4 5 6; do ($PSQL -c "update officer_sweep_runs set status = 'completed', completed_at = now() where organization_id = '$ORG' and status = 'running'" >/dev/null 2>&1; $PSQL -c "${RUN_INS}'manual')" > "/tmp/vz-run-$i.out" 2>&1) & done; wait
rm -f /tmp/vz-run-*.out
check "after concurrent finish/start races there is still at most one running run" "$(sql "select count(*) <= 1 from officer_sweep_runs where organization_id = '$ORG' and status = 'running'")" "t"
sql "update officer_sweep_runs set started_at = now() - interval '20 minutes' where organization_id = '$ORG' and status = 'running'" >/dev/null
sql "update officer_sweep_runs set status = 'failed', completed_at = now() where organization_id = '$ORG' and status = 'running' and started_at < now() - interval '15 minutes'" >/dev/null
check "a run past its lease is reclaimable (closed as failed), then a new run can start" "$($PSQL -c "${RUN_INS}'scheduled')" 2>&1 | grep -c ERROR)" "0"

echo ""
echo "$PASS passed · $FAIL failed"
[ "$FAIL" -eq 0 ]
