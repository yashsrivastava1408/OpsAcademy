#!/usr/bin/env bash
# Applies all migrations to a fresh database and checks row-level security.
# Usage: PGURL=postgres://user:pass@host:5432/postgres supabase/tests/rls.sh
set -euo pipefail
: "${PGURL:?set PGURL to a superuser connection string}"
here="$(cd "$(dirname "$0")" && pwd)"
psql() { command psql "$PGURL" -v ON_ERROR_STOP=1 -X -q "$@"; }

# Stand-ins for what Supabase provides.
psql -f "$here/bootstrap.sql"

for f in "$here"/../migrations/*.sql; do psql -f "$f"; done
# Idempotent: applying twice must succeed.
for f in "$here"/../migrations/*.sql; do psql -f "$f"; done
psql -c "grant all on all tables in schema public to service_role"

fail=0
expect_denied() { # role, sql, label
  if psql -c "set role $1; $2" >/dev/null 2>&1; then echo "FAIL: $3"; fail=1; else echo "ok:   $3"; fi
}
expect_ok() {
  if psql -c "set role $1; $2" >/dev/null 2>&1; then echo "ok:   $3"; else echo "FAIL: $3"; fail=1; fi
}

expect_denied anon          "select * from public.documents"                                   "anon cannot read documents"
expect_denied anon          "insert into public.documents(collection,id,doc) values('a','b','{}')" "anon cannot write documents"
expect_denied anon          "select * from public.profiles"                                    "anon cannot read profiles"
expect_denied authenticated "select * from public.documents"                                   "authenticated cannot read documents"
expect_denied authenticated "insert into public.documents(collection,id,doc) values('a','b','{}')" "authenticated cannot write documents"
expect_denied authenticated "update public.profiles set name='x'"                              "authenticated cannot update profiles"
expect_ok     service_role  "insert into public.documents(collection,id,doc) values('users','u1','{}')" "service_role can write documents"
expect_ok     service_role  "insert into public.profiles(id,name) values('11111111-1111-1111-1111-111111111111','Ada'),('22222222-2222-2222-2222-222222222222','Bob')" "service_role can write profiles"

# Every table in public (current and future migrations) must be closed to the browser roles.
for t in $(psql -t -A -c "select tablename from pg_tables where schemaname='public' order by 1"); do
  [ "$t" = "profiles" ] && continue   # profiles has its own narrow policy, checked below
  expect_denied anon          "select 1 from public.$t limit 1" "anon cannot read $t"
  expect_denied authenticated "select 1 from public.$t limit 1" "authenticated cannot read $t"
  expect_denied anon          "delete from public.$t"           "anon cannot delete from $t"
done

# Authenticated users see only their own profile row.
rows=$(psql -t -A -c "set role authenticated; set request.jwt.claim.sub='11111111-1111-1111-1111-111111111111'; select count(*) from public.profiles" | tail -1)
if [ "$rows" = "1" ]; then echo "ok:   authenticated sees only own profile"; else echo "FAIL: authenticated saw $rows profiles"; fail=1; fi

exit $fail
