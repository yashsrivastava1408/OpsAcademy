# ADR 0003: One identity system (Supabase Auth) and session model

Status: accepted (Phase 2, issue #86). Implemented in #87-#98; the cutover is done with `docs/runbooks/auth-cutover.md`.

## Context

Two login systems are half joined today:

- The gateway issues its own HS256 JWTs (`/api/auth/register`, `/login`, `/guest`,
  `/reset`) and stores a bcrypt `password_hash` in `public.users`.
- The gateway also accepts Supabase access tokens (`server/lib/supabaseAuth.js`,
  verified locally against the project JWKS), and `POST /api/auth/session` creates the
  local record on first sign-in.
- The browser still uses only the custom JWT, kept in `localStorage`
  (`client/src/services/api.js`). `client/src/lib/supabase.js` exists but nothing signs in with it.

Consequences: two places to secure and rotate, password reset and email verification
implemented by hand, no SSO path for colleges, tokens readable by any script on the page,
and no single place to revoke a session.

## Decision

### 1. Supabase Auth is the only identity provider

- Sign-up, sign-in, password reset, email verification, and later college SSO
  (Google Workspace / Microsoft, #97) all go through Supabase Auth.
- The gateway **stops issuing tokens** and only **verifies** Supabase access tokens
  (asymmetric keys from the project JWKS, issuer and audience checked, already implemented).
  The custom JWT issuing code, `JWT_SECRET`, `one_time_tokens` and the hand-written reset
  and verify endpoints are removed in P2-04 once the cutover below is complete.
- Why not keep our own: we would own password storage, breach response, MFA, SSO
  federation and email deliverability for no product benefit. Supabase is already the
  system of record for data (ADR 0001) and the choice for production.

### 2. The app user and the Supabase user are linked, not merged

- `public.users.id` stays the application's user id; every foreign key already points at it.
- `public.identities (provider, subject, user_id)` maps a Supabase user id (`sub`) to the
  app user. New Supabase sign-ins create a `users` row whose id is the Supabase `sub`
  (as `ensureSupabaseUser` does today); migrated legacy accounts keep their old id and
  gain an `identities` row.
- Token verification stays read-only. The one explicit write is `POST /api/auth/session`,
  called by the client after each sign-in.

### 3. Roles and colleges come from the database, never from the token

- Roles live in `public.memberships` (student, trainer, college_admin,
  placement_officer, platform_admin) with `college_id`. The gateway loads the caller's
  memberships per request (short in-process cache, a few seconds) and sets `req.user.roles`
  and `req.user.collegeId`.
- Nothing authorisation-related is read from `user_metadata` (user-editable) and we do not
  depend on custom JWT claims, so a role change takes effect within seconds with no
  re-login. Details: P2-06 (RBAC), P2-08 (tenant scoping).

### 4. Session model

| Concern | Behaviour |
| --- | --- |
| Access token | Supabase JWT, **15 minutes** (project setting `JWT expiry = 900`). Sent as `Authorization: Bearer`. |
| Refresh | Supabase refresh tokens with rotation and reuse detection on. The client refreshes ahead of expiry; a refused refresh signs the user out. |
| Storage | Moves out of `localStorage` in P2-05: access token in memory only; refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie managed through the gateway. Until P2-05 ships, the Supabase client default storage is used and this is a known, tracked gap. |
| Logout | `signOut({ scope: 'local' })` on the device; the refresh token is revoked server-side. "Sign out everywhere" uses `scope: 'global'`. An already-issued access token stays valid until it expires (at most 15 minutes); that window is accepted. |
| Password change / reset | Supabase invalidates other refresh tokens; the old `password_changed_at` check is no longer needed after cutover. |
| Unverified email | Allowed to use the app; certificates and college features require `email_verified` (as today for certificates). |

### 5. Guests

- Guests use **Supabase anonymous sign-in**, so a guest is a real Supabase user with
  `is_anonymous = true` (already surfaced as `guest` by the verifier).
- Upgrade keeps the same user id: the anonymous user is converted by
  `updateUser({ email, password })` (or by linking an OAuth identity), so labs and
  progress carry over without a data copy. Guest rows remain subject to the existing
  expiry sweep. Details: P2-03.
- Anonymous sign-in is rate limited and protected with CAPTCHA (Supabase setting) to stop
  abuse that creates unlimited guest users. Guests cannot use certificates or college features.

### 6. Cutover plan for existing accounts

The production database holds only pilot data, so we do a one-time, reversible migration
rather than a long dual-running period:

1. **Prepare.** Ship the Supabase sign-in/sign-up screens (P2-02) behind a flag; the gateway
   keeps accepting both token types.
2. **Import.** A script (`server/scripts/migrate-auth.js`) reads local registered users and
   creates the matching Supabase users through the admin API, **importing the existing bcrypt
   hash** so passwords keep working, email marked confirmed when `email_verified` is true.
   It writes an `identities` row linking each Supabase `sub` to the unchanged `users.id`.
   It is idempotent and has a dry-run mode that reports users it would skip (no email, duplicate email).
3. **Switch the client.** Turn the flag on: the SPA signs in with Supabase only. Legacy
   guests are dropped (they are throwaway); learners with a legacy token are asked to sign in once.
4. **Soak.** Keep the gateway's legacy-token verification for one release (read-only, no
   issuing) so in-flight sessions end gracefully.
5. **Remove.** Delete the custom JWT code, `/login`, `/register`, `/reset`, `/verify-email`,
   `one_time_tokens` usage and `JWT_SECRET` (P2-04). A follow-up migration drops `password_hash`
   and `password_changed_at` once no code reads them.

**Rollback:** until step 5, the legacy columns are untouched, so turning the flag off
restores the old flow. After step 5 rollback is a revert plus a restore from the backup taken before step 3.

## Implementation notes

- Two switches make the cutover deliberate: `LEGACY_AUTH=off` on the gateway and `VITE_AUTH_MODE=supabase` in the client build. Both default to the old sign-in so a deploy never changes login by itself; local development and CI keep using the old sign-in (no Supabase project needed).
- The refresh token is stored by the gateway in an HttpOnly cookie (`/api/auth/cookie`, `/refresh`, `/logout`); the browser keeps only the short-lived access token in memory. `Content-Security-Policy` allows scripts from the app's own files only.
- A guest upgrades by adding an email and password to the anonymous Supabase user; the address becomes permanent when confirmed, and the app user (same id) is upgraded on the next `POST /api/auth/session`.
- Migrated accounts keep their app user id; `identities` maps the Supabase user id to it, and a confirmed Supabase email also claims a matching old account on first sign-in.

## Consequences

- One place to configure password rules, MFA, SSO and session lifetime.
- Operational dependency on Supabase Auth availability; verification itself is local (JWKS
  cached), so already-signed-in users keep working through short Auth outages.
- The email/password hash import depends on Supabase accepting bcrypt hashes; if a hash is
  rejected, that user is sent a password-reset email instead of being blocked.
- Frontend work (P2-02, P2-05) and backend work (P2-04) must land in the order listed in the epic.

## Open items (tracked in their own issues)

- Exact cookie/proxy mechanism for the refresh token (P2-05).
- Talhelix single sign-on and identity linking (P2-11).
- Whether placement officers and trainers sign in with college SSO only (P2-12).
