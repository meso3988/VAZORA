#!/usr/bin/env bash
# Run a command against the STAGING Supabase project only.
#
#   bash supabase/tests/with-staging.sh <command...>
#
# Reads .env.staging.local (git-ignored; values are never printed) and exports
# every Supabase name the code reads, blanking the ones the file does not set,
# so nothing can fall back to the values in .env.local. Refuses to run unless
# the URL, both API keys and the database connection string all belong to
# STAGING_REF. Test scripts only fill names that are undefined, and Next.js
# gives the process environment precedence over .env.local.
set -euo pipefail
STAGING_REF="oivrwhvbvfhsslsqghuz"
FILE="${STAGING_ENV_FILE:-.env.staging.local}"
[ -f "$FILE" ] || { echo "with-staging: $FILE not found"; exit 2; }

NAMES="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY STAGING_DATABASE_URL VAZORA_SWEEP_SECRET CRON_SECRET VAZORA_SCHEDULED_SWEEPS"
for n in $NAMES; do export "$n="; done
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue;; esac
  key="${line%%=*}"; val="${line#*=}"; val="${val%\"}"; val="${val#\"}"
  case " $NAMES " in *" $key "*) export "$key=$val";; esac
done < "$FILE"
export VAZORA_DATA_PROVIDER=supabase

fail() { echo "with-staging: REFUSED — $1"; exit 3; }
[ "$NEXT_PUBLIC_SUPABASE_URL" = "https://$STAGING_REF.supabase.co" ] || fail "NEXT_PUBLIC_SUPABASE_URL is not the staging project"
PUB="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"
[ -n "$PUB" ] || fail "no anon/publishable key"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || fail "no service-role/secret key"
case "$STAGING_DATABASE_URL" in *"$STAGING_REF"*) ;; *) fail "STAGING_DATABASE_URL does not name the staging project";; esac

# A JWT key carries its project in the "ref" claim; any key is checked by the
# staging API itself (keys are bound to one project).
jwt_ref() { python3 -c 'import sys,json,base64
p=sys.argv[1].split(".")
if len(p)!=3: print(""); sys.exit()
s=p[1]+"="*(-len(p[1])%4); print(json.loads(base64.urlsafe_b64decode(s)).get("ref",""))' "$1"; }
for k in "$PUB" "$SUPABASE_SERVICE_ROLE_KEY"; do
  r=$(jwt_ref "$k"); [ -z "$r" ] || [ "$r" = "$STAGING_REF" ] || fail "an API key belongs to another project"
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $k" "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings")
  [ "$code" = "200" ] || fail "an API key is not accepted by the staging project (HTTP $code)"
done
echo "with-staging: target $STAGING_REF verified (URL, keys, database URL)" >&2
exec "$@"
