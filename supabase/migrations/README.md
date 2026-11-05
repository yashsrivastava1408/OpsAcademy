# Supabase migrations

Plain SQL files applied in filename order. Each file is idempotent
(`if not exists`, `drop policy if exists`) so re-running is safe.

Apply to a Supabase project (direct connection string, not the pooler):

    cd server && DATABASE_URL=postgres://… npm run migrate          # apply pending
    cd server && DATABASE_URL=postgres://… npm run migrate:status   # applied / pending / edited

The runner records each file in `public.schema_migrations`, locks against concurrent runs, runs every file in a
transaction and refuses to continue if an applied file was edited. You can also paste a file into the SQL editor,
but then it is not recorded, so prefer the runner. Design: `docs/adr/0001-postgres-schema-and-migrations.md`. Never edit an applied migration; add a new numbered file.

`supabase/tests/rls.sh` applies every migration to a throwaway Postgres and proves
the anon key cannot read or write server-only tables (runs in CI).
