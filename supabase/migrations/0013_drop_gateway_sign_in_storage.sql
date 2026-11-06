-- 0013: drop what the gateway's own sign-in stored. Supabase Auth keeps passwords and sends the email links
-- (ADR 0003), so the app no longer holds a password hash, a password-change time, one-time link tokens, or a
-- per-user "which sign-in" marker.
--
-- Not reversible: the dropped hashes are gone. The accounts that had one were moved into Supabase Auth with
-- their hashes on 2026-11-06 (see docs/runbooks/auth-cutover.md), so nothing needs them.

drop table if exists public.one_time_tokens;
alter table public.users drop column if exists password_hash;
alter table public.users drop column if exists password_changed_at;
alter table public.users drop column if exists auth_provider;
