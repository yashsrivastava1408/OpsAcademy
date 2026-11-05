# Supabase migrations

Plain SQL files applied in filename order. Each file is idempotent
(`if not exists`, `drop policy if exists`) so re-running is safe.

Apply to a Supabase project:

    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_documents_and_profiles.sql

or paste the file into the SQL editor. Never edit an applied migration; add a new numbered file.

`supabase/tests/rls.sh` applies every migration to a throwaway Postgres and proves
the anon key cannot read or write server-only tables (runs in CI).
