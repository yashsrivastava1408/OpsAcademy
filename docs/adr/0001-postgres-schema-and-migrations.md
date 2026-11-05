# ADR 0001: Postgres schema design and migration tool

Status: accepted (Phase 1, issue #66)

## Context

OpsAcademy stores everything as JSON documents behind a synchronous in-memory
store (`getStore().get/set/all`) with three drivers: JSON file, SQLite and a
Supabase `documents` table. That was right for a demo. It cannot support the
pilot and later phases:

- no queries across learners (college leaderboards, batch progress, weak topics),
- no transactions (XP and streak updates are read-modify-write races),
- no tenant boundary (colleges, batches, roles),
- the whole data set lives in each server process.

Supabase (managed Postgres + Auth) is the chosen platform. Backups and point-in-time
recovery are provided by it.

## Decision

### 1. Postgres is the system of record, accessed through a repository layer

- Server code talks to a small **async repository interface** (users, tokens,
  progress, certificates, sandbox sessions, audit). Services never touch SQL.
- Two implementations: **PostgresRepository** (`pg` pool, production and CI) and
  **MemoryRepository** (unit tests, local development without a database). A shared
  contract test suite runs against both so they cannot drift.
- The legacy JSON, SQLite and document stores are removed once the migration (#81)
  has run (#84).

### 2. Schema conventions

- Plain SQL, `snake_case`, `timestamptz` for every time, `text` primary keys that
  keep today's ids (`g_…`, `u_…`, Supabase uuids as text) so no id ever changes.
- **Tenant column:** every row that belongs to a college carries `college_id`.
  Queries from college-scoped endpoints always filter on it (isolation tests: #93).
- **Typed columns for anything queried or ranked** (xp, role, slugs, expiry);
  **`jsonb` for the long tail** of per-learner learning state (steps, hints,
  quizzes, flashcards, interviews). Normalise a part into its own table only when
  a query needs it (for example per-question analytics, #179).
- **Row-level security is enabled on every table and the browser roles (anon,
  authenticated) have all privileges revoked** unless a table grants a narrow
  policy. The gateway is the only client and connects with a server credential
  (the owning role, which bypasses RLS). RLS is deliberately not `FORCE`d on the
  new tables so that role keeps access. CI proves on every PR that no table is
  reachable with the browser keys.
- Constraints belong in the database: foreign keys, `check` constraints for enums,
  unique indexes for email and profile slug.

### 3. Migrations: numbered SQL files and a small runner

- Files live in `supabase/migrations/NNNN_name.sql` (so the Supabase CLI and
  dashboard understand them) and are applied in filename order.
- `server/scripts/migrate.js` (library: `server/lib/migrator.js`) applies pending
  files. It records `version`, `name`, `checksum` and `applied_at` in
  `public.schema_migrations`, takes a Postgres **advisory lock** so two deploys
  cannot race, runs **each file in its own transaction**, and **refuses to run if
  an applied file was edited** (checksum mismatch).
- Never edit an applied migration; add a new one.
- **Expand → migrate → contract** for anything that changes existing tables:
  add the new shape first (additive), deploy code that uses it, backfill, and only
  later drop the old shape. A migration is applied **before** the code that needs
  it is deployed, after a backup (see `docs/BACKUP_AND_RESTORE.md`).
- CI applies every migration to a fresh Postgres (twice, to prove idempotence of
  the runner) and runs the backend test suite against it.

### Alternatives considered

| Option | Why not |
| :--- | :--- |
| Prisma / Drizzle / Knex migrations | Extra tooling and generated client; RLS policies and Supabase roles still end up as raw SQL. A 150-line runner is enough and has no lock-in. |
| Supabase CLI only | Good for local dev, but no checksum guard or deploy-time lock, and it needs Docker locally. Our files stay compatible with it. |
| PostgREST (supabase-js) from the gateway | No multi-statement transactions, which the atomic XP/streak updates (#76) need. |
| Keep the JSON `documents` table | Cannot express tenancy, constraints, ranking queries or transactions. |

## Consequences

- Services become `async`; routes use an async handler wrapper so errors reach the
  error middleware (Express 4).
- The gateway needs `DATABASE_URL` (Supabase pooled connection string) in addition
  to the existing Supabase keys. Use the **transaction pooler** for the app and the
  **direct connection** for migrations.
- Local development can still run without Postgres using the in-memory repository
  (data is lost on restart, which is fine for development).
