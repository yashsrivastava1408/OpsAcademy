# Runbook: cut over to Supabase Auth

Follows ADR 0003. Do this once, in a quiet hour, after the code is deployed. Nothing here changes by itself:
both switches default to the old sign-in.

| Switch | Where | Old | New |
| --- | --- | --- | --- |
| `LEGACY_AUTH` | gateway env | on (default) | `off` |
| `VITE_AUTH_MODE` | client build env | unset | `supabase` |

## 0. Before you start

1. Backup: `scripts/backup-db.sh` (see `docs/BACKUP_AND_RESTORE.md`).
2. Supabase dashboard, **Authentication**:
   - Sign-in providers: Email enabled; **Allow anonymous sign-ins** enabled; Confirm email enabled.
   - Anonymous sign-ins: turn on CAPTCHA (Auth > Attack protection) so guests cannot be created in bulk.
   - Sessions: JWT expiry `900` seconds; refresh token rotation on; reuse interval 10 s.
   - URL configuration: Site URL = the web app address; Redirect URLs include `<app>/auth/callback` and `<app>/reset-password`.
   - Password policy: minimum length 8.
3. Gateway env (server): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` set; `CORS_ORIGINS` lists the web origin if the web app and
   API are on different origins; `AUTH_COOKIE_SAMESITE=none` only if they are on different *sites* (needs HTTPS).
4. First operator: set `PLATFORM_ADMIN_EMAILS=<your verified email>` (or run `npm run grant-role` later).

## 1. Move existing accounts

```
cd server
node scripts/migrate-auth.js            # dry run: lists who would move
node scripts/migrate-auth.js --apply    # needs SUPABASE_SECRET_KEY; creates users with their password hashes
```
Anyone reported as "already in Supabase" is left alone and links automatically the first time they sign in with the
same confirmed email. Failures are listed; fix and re-run (it skips accounts already linked).

## 2. Flip the switches

1. Rebuild the client with `VITE_AUTH_MODE=supabase`. With `docker-compose.prod.yml` set `VITE_AUTH_MODE=supabase` in `.env.production`; the Supabase URL and publishable key are taken from `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The browser build bakes these in, so run `docker compose … up -d --build client`.
2. Set `LEGACY_AUTH=off` on the gateway and restart. The old `/login`, `/register`, `/guest`, `/forgot`, `/reset`,
   `/verify-email` endpoints now answer 404 and old tokens are rejected.
3. Everyone signs in once; old guests are simply new guests.

## 3. Check

- Sign in with a migrated account: the old progress is there and the old password works.
- Reload the page: still signed in (the `oa_rt` cookie, HttpOnly). `localStorage` holds no token.
- Start as a guest, do a lab step, create an account, confirm the email: progress is kept.
- `/admin` as the platform admin; `GET /api/colleges` works for the admin and returns 403 for others.

## Rollback

Set `LEGACY_AUTH=on`, rebuild the client without `VITE_AUTH_MODE`, redeploy. The legacy columns are untouched until a
later cleanup migration, so old passwords keep working. Accounts created in Supabase only (new sign-ups) remain in Supabase.

## After a quiet release

Drop `password_hash`, `password_changed_at` and `one_time_tokens` use in a new migration, and delete the legacy auth code.
