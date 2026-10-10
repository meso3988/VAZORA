#!/usr/bin/env bash
# Inspect / initialise the STAGING database from the repository migrations.
# Run only through with-staging.sh (which verifies the target):
#
#   bash supabase/tests/with-staging.sh bash supabase/tests/staging-migrate.sh inspect
#   bash supabase/tests/with-staging.sh bash supabase/tests/staging-migrate.sh apply
#
# inspect  read-only: application tables, row counts, migration history
# apply    applies the repository migrations that the history does not list,
#          in order, each in ONE transaction together with its history row
#          (supabase_migrations.schema_migrations, the Supabase CLI's table).
#          Refuses if application tables exist without a matching history,
#          or if any application table already holds rows.
set -euo pipefail
: "${STAGING_DATABASE_URL:?run through with-staging.sh}"
case "$STAGING_DATABASE_URL" in *oivrwhvbvfhsslsqghuz*) ;; *) echo "refusing: not the staging database"; exit 3;; esac
PSQL_BIN="${PSQL_BIN:-/opt/homebrew/opt/postgresql@15/bin/psql}"
q() { "$PSQL_BIN" "$STAGING_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c "$1"; }
MODE="${1:-inspect}"

echo "server: $(q "select current_setting('server_version')") · database: $(q 'select current_database()')"
HAS_HISTORY=$(q "select to_regclass('supabase_migrations.schema_migrations') is not null")
APPLIED=""
[ "$HAS_HISTORY" = "t" ] && APPLIED=$(q "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations")
TABLES=$(q "select coalesce(string_agg(table_name, ' ' order by table_name), '') from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")
echo "migration history table: $([ "$HAS_HISTORY" = "t" ] && echo present || echo absent) · applied: ${APPLIED:-none}"
echo "public tables: ${TABLES:-none}"
ROWS=0
for t in $TABLES; do
  n=$(q "select count(*) from public.\"$t\""); ROWS=$((ROWS + n))
  [ "$n" = "0" ] || echo "  $t: $n rows"
done
echo "application rows: $ROWS"
echo "auth users: $(q 'select count(*) from auth.users') · storage objects: $(q 'select count(*) from storage.objects')"
[ "$MODE" = "inspect" ] && exit 0
[ "$MODE" = "apply" ] || { echo "unknown mode $MODE"; exit 2; }

if [ -n "$TABLES" ] && [ -z "$APPLIED" ]; then echo "STOP: application tables exist without migration history"; exit 4; fi
if [ "$ROWS" != "0" ]; then echo "STOP: application tables already hold data"; exit 4; fi

q "create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)" >/dev/null
for f in supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  base=$(basename "$f" .sql); version="${base%%_*}"; name="${base#*_}"
  case " $APPLIED " in *" $version "*) echo "skip  $base (already applied)"; continue;; esac
  if "$PSQL_BIN" "$STAGING_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -1 \
      -f "$f" \
      -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')" >/dev/null 2>/tmp/staging-migrate.err; then
    echo "apply $base ok (sha256 $(shasum -a 256 "$f" | cut -c1-12))"
  else
    echo "FAIL  $base — rolled back:"; grep -m3 -E "ERROR|LINE" /tmp/staging-migrate.err; exit 5
  fi
done
echo "history now: $(q "select string_agg(version, ' ' order by version) from supabase_migrations.schema_migrations")"
