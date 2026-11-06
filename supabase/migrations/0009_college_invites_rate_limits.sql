-- 0009: college onboarding invites and a shared rate-limit counter.
--
-- Invites: a college admin imports a student list before those students have
-- signed in. The row waits here and becomes a membership when someone signs in
-- with that verified email address.
-- Rate limits: counters shared by every gateway instance for the strict limiters
-- (sign-in, new guests, sandbox start, AI mentor), so adding instances does not
-- multiply the allowance.

create table if not exists public.college_invites (
  id          text        primary key default gen_random_uuid()::text,
  college_id  text        not null references public.colleges (id) on delete cascade,
  section_id  text,
  email       text        not null check (email = lower(email)),
  role        text        not null default 'student' check (role in ('student', 'trainer', 'college_admin', 'placement_officer')),
  created_at  timestamptz not null default now(),
  unique (college_id, email, role),
  constraint college_invites_section_same_college foreign key (section_id, college_id) references public.sections (id, college_id)
);
create index if not exists college_invites_email_idx on public.college_invites (email);

create table if not exists public.rate_limit_hits (
  key       text        primary key,
  hits      integer     not null,
  reset_at  timestamptz not null
);
create index if not exists rate_limit_hits_reset_idx on public.rate_limit_hits (reset_at);

alter table public.college_invites enable row level security;
alter table public.rate_limit_hits enable row level security;
revoke all on public.college_invites, public.rate_limit_hits from anon, authenticated;
