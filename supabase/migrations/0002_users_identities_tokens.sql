-- 0002: accounts. Replaces the JSON `users`, `emails`, `profiles` and `tokens` collections.
--
-- Every table from here on: row-level security is ON and the browser roles have
-- no privileges. The gateway reaches the tables through its own server
-- credential (the owning role), which bypasses RLS by design. RLS is not FORCEd
-- so that role keeps access; see docs/adr/0001.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table if not exists public.users (
  id                   text        primary key,
  name                 text        not null check (length(name) between 1 and 80),
  email                text        check (email = lower(email)),
  password_hash        text,
  guest                boolean     not null default false,
  email_verified       boolean     not null default false,
  profile_public       boolean     not null default false,
  profile_slug         text        check (profile_slug ~ '^[a-z0-9-]{3,48}$'),
  password_changed_at  timestamptz,
  auth_provider        text        not null default 'local' check (auth_provider in ('local', 'supabase')),
  created_at           timestamptz not null default now(),
  registered_at        timestamptz,
  updated_at           timestamptz not null default now(),
  -- a registered (non-guest) account always has an email
  constraint users_registered_has_email check (guest or email is not null)
);

create unique index if not exists users_email_key on public.users (email) where email is not null;
create unique index if not exists users_profile_slug_key on public.users (profile_slug) where profile_slug is not null;
-- expiry sweep for guests
create index if not exists users_guest_created_idx on public.users (created_at) where guest;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- Links an external identity (today: a Supabase Auth user) to a local account,
-- so an email/password account can be moved to Supabase Auth without losing progress.
create table if not exists public.identities (
  provider    text        not null check (provider in ('supabase')),
  subject     text        not null,
  user_id     text        not null references public.users (id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (provider, subject)
);
create index if not exists identities_user_idx on public.identities (user_id);

-- Password-reset and email-confirmation links. Only the SHA-256 of the token is stored.
create table if not exists public.one_time_tokens (
  hash        text        primary key,
  user_id     text        not null references public.users (id) on delete cascade,
  kind        text        not null check (kind in ('reset', 'verify')),
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists one_time_tokens_user_kind_idx on public.one_time_tokens (user_id, kind);
create index if not exists one_time_tokens_expires_idx on public.one_time_tokens (expires_at);

alter table public.users           enable row level security;
alter table public.identities      enable row level security;
alter table public.one_time_tokens enable row level security;
revoke all on public.users, public.identities, public.one_time_tokens from anon, authenticated;
