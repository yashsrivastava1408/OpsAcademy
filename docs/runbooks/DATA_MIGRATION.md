# Runbook: moving data from the old stores to Postgres

Used once, when switching a deployment that has real accounts from the JSON, SQLite or Supabase
`documents` store to the relational schema. A deployment with only test data can skip it.

## Before

1. Take a backup (`docs/BACKUP_AND_RESTORE.md`) and, for a SQLite/JSON source, copy the file somewhere safe.
2. Apply the schema: `cd server && DATABASE_URL=<direct url> npm run migrate`.
3. Freeze writes to the old system if it is live (stop the old gateway), so nothing changes mid-copy.

## Dry run (writes nothing)

```bash
cd server
DATABASE_URL=<direct url> npm run migrate:data -- --from sqlite:/path/to/store.db
#   or  --from json:/path/to/store.json
#   or  --from supabase        (needs SUPABASE_URL and SUPABASE_SECRET_KEY)
```

It performs the whole import inside a transaction and rolls it back, then prints a report:
for each of users, tokens, progress and certificates, how many records were in the source, how many
were imported, and how many were skipped **and why**.

| Reason | Meaning | What to do |
| :--- | :--- | :--- |
| `already_present` | row exists from an earlier run | nothing |
| `email_or_slug_conflict` | two accounts used one email/slug; the older one wins | decide if the other needs a manual merge |
| `registered_without_email` | a non-guest account with no email | contact the user or drop |
| `orphan_no_user` | progress or a certificate whose account is gone | usually safe to drop |
| `expired` / `malformed` | stale token or unreadable record | nothing |

The `verification` block must say `"ok": true`: every source record is imported or explained, imported
XP is present, and nothing in the target is orphaned.

## Apply

Add `--apply`. It commits only if verification passes; otherwise nothing is written and the exit code is 1.
Re-running is safe: existing rows are never overwritten.

## After

Point the gateway at the database (`DATABASE_URL`), start it, and spot-check: log in as a migrated user,
check their XP and certificates, and open `/api/progress/leaderboard`. Keep the old store file for 30 days.
