# Backup and restore

The database is Supabase Postgres. It is the only place learner data lives (EC2 is
stateless), so this is the document that decides how much you can lose.

## What protects the data

| Layer | What it gives you | Notes |
| :--- | :--- | :--- |
| **Supabase daily backups** | Automatic, kept 7 days on Pro | Restore from the dashboard (Database -> Backups). Free plans have no downloadable backups. |
| **Point-in-time recovery (PITR)** | Restore to any second in the retention window | Paid add-on. Turn it on before real students use the system. Target RPO: seconds. |
| **Our logical dump** (`scripts/backup-db.sh`) | A portable `pg_dump` you hold yourself | Taken automatically before every deploy, and on demand. Independent of Supabase. |
| **Restore drill** (`scripts/restore-drill.sh`) | Proof a dump actually restores | Runs on every PR in CI, and monthly against a real dump. |

Targets for the pilot: **RPO** <= 24 h with daily backups (seconds with PITR), **RTO** <= 1 h.

## Take a backup

```bash
BACKUP_DATABASE_URL='postgres://…direct connection…' scripts/backup-db.sh backups
# -> backups/opsacademy-20261105T182849Z.dump (+ .sha256), newest 14 kept (BACKUP_KEEP)
```

Use the **direct** connection (port 5432), not the pooler. The script uses a local `pg_dump`
(version >= the server's) or falls back to a throwaway `postgres` container. The deploy
script runs it before migrating; a failed backup stops the deploy (`SKIP_BACKUP=1` overrides).
Copy dumps off the server (an S3 bucket with versioning, or your own machine); a backup on the
same disk as the thing it protects is not a backup.

## The restore drill (do this monthly, and before any risky migration)

1. Create an empty scratch database (a second Supabase project, or a local Postgres):
   `createdb restore_drill`.
2. Run:
   ```bash
   BACKUP_FILE=backups/opsacademy-….dump \
   SCRATCH_DATABASE_URL=postgres://…/restore_drill \
   SOURCE_DATABASE_URL=postgres://…/postgres \
   scripts/restore-drill.sh
   ```
3. It verifies the checksum, wipes the scratch database, restores, and compares the row count
   of every table with the source. It must end with `RESTORE DRILL PASSED`.
4. Record the date and the result in the table below.

| Date | Dump | Result | Who |
| :--- | :--- | :--- | :--- |
| _CI, every PR_ | generated | PASSED | CI |

## Restoring for real

1. **Stop the writers** so nothing is lost mid-restore: `docker compose -f docker-compose.prod.yml stop server worker`.
2. **Choose the source**: Supabase PITR to a timestamp (dashboard), or our dump.
3. **From a dump into the same project** (destroys current data, so take a fresh dump first if the database is readable):
   ```bash
   psql "$DIRECT_URL" -c "drop schema public cascade"
   pg_restore --no-owner --no-privileges --exit-on-error --dbname "$DIRECT_URL" backups/opsacademy-….dump
   ```
   Then `cd server && DATABASE_URL="$DIRECT_URL" npm run migrate:status`; every migration should read `applied`.
4. **Start the app**: `docker compose -f docker-compose.prod.yml up -d` (the `migrate` service brings the schema current).
5. **Check**: `/api/ready` returns 200; sign in; open the leaderboard; compare a user count with the last known number.

## What is not in the database

Environment secrets (`.env.production`: keep a copy in your password manager), the sandbox image (rebuilt by
the deploy), and Supabase Auth users (Supabase backs these up with the project). Losing the EC2 server loses nothing
that matters: launch a new one and run `scripts/deploy-ec2.sh`.
