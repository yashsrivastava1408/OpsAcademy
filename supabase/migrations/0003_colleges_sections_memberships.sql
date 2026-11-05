-- 0003: tenants. A college has sections (batches); users belong to colleges with a role.

create table if not exists public.colleges (
  id          text        primary key default gen_random_uuid()::text,
  name        text        not null check (length(name) between 2 and 120),
  slug        text        not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  timezone    text        not null default 'Asia/Kolkata',
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.sections (
  id             text        primary key default gen_random_uuid()::text,
  college_id     text        not null references public.colleges (id) on delete cascade,
  name           text        not null check (length(name) between 1 and 80),
  academic_year  integer     check (academic_year between 2000 and 2100),
  created_at     timestamptz not null default now(),
  unique (college_id, name),
  -- lets memberships prove a section belongs to the same college
  unique (id, college_id)
);

create table if not exists public.memberships (
  id          text        primary key default gen_random_uuid()::text,
  user_id     text        not null references public.users (id) on delete cascade,
  college_id  text        references public.colleges (id) on delete cascade,
  section_id  text,
  role        text        not null check (role in ('student', 'trainer', 'college_admin', 'placement_officer', 'platform_admin')),
  created_at  timestamptz not null default now(),
  -- the platform admin is the only role without a college
  constraint memberships_college_iff_not_platform check ((role = 'platform_admin') = (college_id is null)),
  -- a section implies a college, and must belong to that same college
  constraint memberships_section_same_college foreign key (section_id, college_id) references public.sections (id, college_id)
);
create unique index if not exists memberships_user_college_role_key on public.memberships (user_id, college_id, role) where college_id is not null;
create unique index if not exists memberships_platform_admin_key on public.memberships (user_id) where college_id is null;
create index if not exists memberships_college_role_idx on public.memberships (college_id, role);
create index if not exists memberships_section_idx on public.memberships (section_id) where section_id is not null;

drop trigger if exists colleges_set_updated_at on public.colleges;
create trigger colleges_set_updated_at before update on public.colleges
  for each row execute function public.set_updated_at();

alter table public.colleges    enable row level security;
alter table public.sections    enable row level security;
alter table public.memberships enable row level security;
revoke all on public.colleges, public.sections, public.memberships from anon, authenticated;
