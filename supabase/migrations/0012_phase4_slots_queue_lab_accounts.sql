-- 0012: Phase 4. Lab accounts, slot templates and blackouts, queue bookkeeping, lab analytics.

-- ── Lab accounts: an ID and password issued by the platform admin, no email ──
alter table public.users add column if not exists username text check (username ~ '^[a-z0-9][a-z0-9_-]{2,39}$');
alter table public.users add column if not exists lab_access boolean not null default false;
alter table public.users add column if not exists disabled boolean not null default false;
create unique index if not exists users_username_key on public.users (username) where username is not null;
-- a registered (non-guest) account has an email or a lab ID
alter table public.users drop constraint if exists users_registered_has_email;
alter table public.users add constraint users_registered_has_email check (guest or email is not null or username is not null);

-- ── Slot templates (a weekly pattern per college) and blackout dates ──
create table if not exists public.slot_templates (
  id                text        primary key default gen_random_uuid()::text,
  college_id        text        not null references public.colleges (id) on delete cascade,
  section_id        text,
  weekday           smallint    not null check (weekday between 0 and 6), -- 0 = Sunday ... 6 = Saturday
  start_time        time        not null,
  duration_minutes  integer     not null check (duration_minutes between 15 and 480),
  seats             integer     not null check (seats > 0),
  unit_id           text,
  makeup            boolean     not null default false,
  active            boolean     not null default true,
  created_by        text        references public.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint slot_templates_section_same_college foreign key (section_id, college_id) references public.sections (id, college_id)
);
create index if not exists slot_templates_college_idx on public.slot_templates (college_id);

create table if not exists public.blackout_dates (
  id          text        primary key default gen_random_uuid()::text,
  college_id  text        not null references public.colleges (id) on delete cascade,
  on_date     date        not null,
  reason      text        check (length(reason) <= 200),
  unique (college_id, on_date)
);

alter table public.lab_slots add column if not exists template_id text references public.slot_templates (id) on delete set null;
alter table public.lab_slots add column if not exists makeup boolean not null default false;
-- generating the same template for the same start twice does nothing
create unique index if not exists lab_slots_template_start_key on public.lab_slots (template_id, starts_at) where template_id is not null;

-- a trainer can add a student to a slot, or remove one from the slot their section would give them
alter table public.slot_assignments add column if not exists kind text not null default 'add' check (kind in ('add', 'remove'));

-- ── Sessions and the queue know which slot they belong to ──
alter table public.sandbox_sessions add column if not exists slot_id text references public.lab_slots (id) on delete set null;

alter table public.lab_queue add column if not exists slot_id text references public.lab_slots (id) on delete cascade;
alter table public.lab_queue add column if not exists last_seen_at timestamptz not null default now();
alter table public.lab_queue add column if not exists session_id text;
alter table public.lab_queue drop constraint if exists lab_queue_status_check;
alter table public.lab_queue add constraint lab_queue_status_check check (status in ('waiting', 'admitted', 'started', 'expired', 'cancelled'));
-- a learner has at most one open entry (waiting for a seat, or holding one not yet used)
create unique index if not exists lab_queue_one_open_key on public.lab_queue (user_id) where status in ('waiting', 'admitted');
create index if not exists lab_queue_scope_idx on public.lab_queue (slot_id, status, id);

-- ── Lab analytics: switch clicks, transition steps, failures ──
create table if not exists public.analytics_events (
  id          bigint      generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     text,
  college_id  text,
  name        text        not null check (length(name) between 1 and 64),
  props       jsonb       not null default '{}'::jsonb
);
create index if not exists analytics_events_name_idx on public.analytics_events (name, at);

alter table public.slot_templates   enable row level security;
alter table public.blackout_dates   enable row level security;
alter table public.analytics_events enable row level security;
revoke all on public.slot_templates, public.blackout_dates, public.analytics_events from anon, authenticated;
