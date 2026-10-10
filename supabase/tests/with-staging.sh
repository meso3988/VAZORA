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

NAMES="NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY SUPABASE_SERVICE_ROLE_KEY STAGING_DATABASE_URL VAZORA_DATA_PROVIDER VAZORA_SWEEP_SECRET CRON_SECRET VAZORA_SCHEDULED_SWEEPS"
for n in $NAMES; do export "$n="; done
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|\#*) continue;; esac
  line="${line%$'\r'}"; key="${line%%=*}"; val="${line#*=}"; val="${val%"${val##*[![:space:]]}"}"; val="${val%%\"}"; val="${val#\"}"
  case " $NAMES " in *" $key "*) export "$key=$val";; esac
done < "$FILE"

fail() { echo "with-staging: REFUSED — $1"; exit 3; }
[ "$NEXT_PUBLIC_SUPABASE_URL" = "https://$STAGING_REF.supabase.co" ] || fail "NEXT_PUBLIC_SUPABASE_URL is not the staging project"
[ "$VAZORA_DATA_PROVIDER" = "supabase" ] || fail "VAZORA_DATA_PROVIDER must be supabase"
PUB="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"
[ -n "$PUB" ] || fail "no anon/publishable key"
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] || fail "no service-role/secret key"
case "$STAGING_DATABASE_URL" in postgres://*|postgresql://*) ;; *) fail "STAGING_DATABASE_URL is not a postgres connection string";; esac
case "$STAGING_DATABASE_URL" in *"$STAGING_REF"*) ;; *) fail "STAGING_DATABASE_URL does not name the staging project";; esac

# Key kind, for both formats Supabase issues:
#   new keys:    sb_publishable_… (public) / sb_secret_… (server); the project
#                is not encoded, so the staging API below is the project check
#   legacy JWTs: role anon (public) / service_role (server) + "ref" claim
# The key is passed through the environment, never on a command line.
key_check() { KEY="$1" WANT="$2" REF="$STAGING_REF" python3 -c '
import os, json, base64
k, want, ref = os.environ["KEY"], os.environ["WANT"], os.environ["REF"]
if k.startswith("sb_publishable_"): kind = "public"
elif k.startswith("sb_secret_"): kind = "server"
else:
    p = k.split(".")
    try:
        claims = json.loads(base64.urlsafe_b64decode(p[1] + "=" * (-len(p[1]) % 4))) if len(p) == 3 else None
    except Exception:
        claims = None
    if not isinstance(claims, dict): print("unrecognized key format"); raise SystemExit
    if claims.get("ref") != ref: print("JWT key belongs to another project"); raise SystemExit
    kind = {"anon": "public", "service_role": "server"}.get(claims.get("role"), "role " + str(claims.get("role")))
print("ok" if kind == want else "expected a " + want + " key, got " + kind)
'; }
r=$(key_check "$PUB" public); [ "$r" = "ok" ] || fail "anon/publishable key: $r"
r=$(key_check "$SUPABASE_SERVICE_ROLE_KEY" server); [ "$r" = "ok" ] || fail "service-role/secret key: $r"
for k in "$PUB" "$SUPABASE_SERVICE_ROLE_KEY"; do
  label="anon/publishable key"; [ "$k" = "$PUB" ] || label="service-role/secret key"
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "apikey: $k" "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings")
  [ "$code" = "200" ] || fail "$label is not accepted by the staging project (HTTP $code)"
done
echo "with-staging: target $STAGING_REF verified (URL, key kinds, keys accepted by staging, database URL)" >&2
exec "$@"
