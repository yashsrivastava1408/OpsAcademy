-- 0001: tables used by server/lib/supabaseStore.js
--
-- Both tables are SERVER-ONLY. The gateway talks to them with the service-role
-- key, which bypasses row-level security. The browser (anon / authenticated
-- keys) must never read or write them directly, so RLS is on and no policy
-- grants anon access. Table privileges are revoked as a second layer.

create table if not exists public.documents (
  collection  text        not null,
  id          text        not null,
  doc         jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists documents_collection_updated_idx
  on public.documents (collection, updated_at desc);

create table if not exists public.profiles (
  id            text        primary key,
  name          text,
  email         text,
  guest         boolean     not null default false,
  profile_slug  text,
  updated_at    timestamptz not null default now()
);

-- Not unique on purpose: slug uniqueness is enforced by the gateway, and a
-- duplicate here must never make a profile mirror write fail.
create index if not exists profiles_profile_slug_idx
  on public.profiles (profile_slug) where profile_slug is not null;

alter table public.documents enable row level security;
alter table public.documents force row level security;
alter table public.profiles  enable row level security;
alter table public.profiles  force row level security;

revoke all on public.documents from anon, authenticated;
revoke all on public.profiles  from anon, authenticated;

-- A signed-in learner may read only their own profile row (id = their auth uid).
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid()::text);
grant select on public.profiles to authenticated;

-- documents: deliberately no policy and no grant for anon / authenticated.
