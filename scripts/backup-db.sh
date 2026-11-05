#!/usr/bin/env bash
# Logical backup of the OpsAcademy database (public schema) in pg_dump custom format.
#
#   BACKUP_DATABASE_URL=postgres://… scripts/backup-db.sh [backup-dir]
#
# URL precedence: BACKUP_DATABASE_URL, MIGRATION_DATABASE_URL (direct connection), DATABASE_URL.
# Uses a local pg_dump when present, otherwise a throwaway postgres container.
# Keeps the newest BACKUP_KEEP dumps (default 14). Prints the path of the new dump.
set -euo pipefail

URL="${BACKUP_DATABASE_URL:-${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}}"
[ -n "$URL" ] || { echo "Set BACKUP_DATABASE_URL (or MIGRATION_DATABASE_URL / DATABASE_URL)." >&2; exit 2; }
DIR="${1:-backups}"
KEEP="${BACKUP_KEEP:-14}"
IMAGE="${PG_IMAGE:-postgres:17-alpine}"

pg() { # pg <tool> <args...>; stdin passes through
  local tool="$1"; shift
  if command -v "$tool" >/dev/null 2>&1; then "$tool" "$@"
  else docker run --rm -i --network host "$IMAGE" "$tool" "$@"; fi
}

umask 077
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/opsacademy-$STAMP.dump"

pg pg_dump --format=custom --no-owner --no-privileges --schema=public "$URL" > "$OUT"

# A dump that cannot be listed is not a backup.
if ! pg pg_restore --list < "$OUT" > /dev/null; then
  rm -f "$OUT"
  echo "Backup failed verification and was removed." >&2
  exit 1
fi
( cd "$DIR" && { sha256sum "$(basename "$OUT")" 2>/dev/null || shasum -a 256 "$(basename "$OUT")"; } > "$(basename "$OUT").sha256" )

# Retention: delete all but the newest $KEEP dumps.
ls -1t "$DIR"/opsacademy-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done

echo "$OUT"
