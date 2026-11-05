#!/usr/bin/env bash
# Restore a backup into a SCRATCH database and prove it matches the source.
#
#   BACKUP_FILE=backups/opsacademy-….dump \
#   SCRATCH_DATABASE_URL=postgres://…/restore_drill \
#   SOURCE_DATABASE_URL=postgres://…/postgres        # optional: compare row counts with the live database
#   scripts/restore-drill.sh
#
# The scratch database is wiped first. The script refuses to run when it is the same as the source.
set -euo pipefail

: "${BACKUP_FILE:?Set BACKUP_FILE to the dump to restore}"
: "${SCRATCH_DATABASE_URL:?Set SCRATCH_DATABASE_URL to a throwaway database}"
SOURCE="${SOURCE_DATABASE_URL:-}"
IMAGE="${PG_IMAGE:-postgres:17-alpine}"
TABLES="${DRILL_TABLES:-users identities one_time_tokens colleges sections memberships progress certificates sandbox_sessions lab_slots slot_assignments lab_queue ai_usage audit_log schema_migrations}"

[ -f "$BACKUP_FILE" ] || { echo "No such file: $BACKUP_FILE" >&2; exit 2; }
if [ -n "$SOURCE" ] && [ "$SOURCE" = "$SCRATCH_DATABASE_URL" ]; then
  echo "Refusing to restore over the source database." >&2; exit 2
fi
if [ -f "$BACKUP_FILE.sha256" ]; then
  ( cd "$(dirname "$BACKUP_FILE")" && { sha256sum -c "$(basename "$BACKUP_FILE").sha256" >/dev/null 2>&1 || shasum -a 256 -c "$(basename "$BACKUP_FILE").sha256" >/dev/null; } ) \
    || { echo "Checksum mismatch: the backup is damaged." >&2; exit 1; }
  echo "checksum ok"
fi

pg() { local tool="$1"; shift; if command -v "$tool" >/dev/null 2>&1; then "$tool" "$@"; else docker run --rm -i --network host "$IMAGE" "$tool" "$@"; fi; }
count() { pg psql "$1" -Atq -c "select count(*) from public.$2"; }

echo "wiping scratch database and restoring…"
pg psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade"
# On a plain Postgres (not a Supabase project) the policies need what Supabase provides: the roles and auth.uid().
pg psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $do$ begin
  if not exists (select 1 from pg_namespace where nspname = 'auth') then
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $do$;
SQL
pg pg_restore --no-owner --no-privileges --exit-on-error --dbname "$SCRATCH_DATABASE_URL" < "$BACKUP_FILE"

fail=0
printf '%-20s %10s %10s\n' table restored source
for t in $TABLES; do
  restored="$(count "$SCRATCH_DATABASE_URL" "$t")"
  if [ -n "$SOURCE" ]; then
    source_count="$(count "$SOURCE" "$t")"
    status=""; [ "$restored" = "$source_count" ] || { status="  <-- MISMATCH"; fail=1; }
    printf '%-20s %10s %10s%s\n' "$t" "$restored" "$source_count" "$status"
  else
    printf '%-20s %10s %10s\n' "$t" "$restored" "-"
  fi
done

# The restored database must also be a valid, current schema.
applied="$(pg psql "$SCRATCH_DATABASE_URL" -Atq -c "select count(*) from public.schema_migrations")"
echo "migrations recorded in the restored copy: $applied"
[ "$applied" -gt 0 ] || { echo "No migrations recorded: restore is incomplete." >&2; fail=1; }

if [ "$fail" = 0 ]; then echo "RESTORE DRILL PASSED"; else echo "RESTORE DRILL FAILED" >&2; fi
exit "$fail"
