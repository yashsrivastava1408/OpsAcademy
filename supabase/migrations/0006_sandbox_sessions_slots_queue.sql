-- 0006: lab sessions, lab slots, slot assignments and the admission queue.
-- Sessions replace the JSON `sessions` collection (and later hold the node that owns
-- each container, Phase 3). Slots/queue are used from Phase 4.

create table if not exists public.sandbox_sessions (
  session_id      text        primary key,
  engine_id       text        not null,
  user_id         text        not null references public.users (id) on delete cascade,
  lab_id          text,
  node_id         text,
  from_pool       boolean     not null default false,
  claim_ms        numeric,
  history         jsonb       not null default '[]'::jsonb,
  strikes         integer     not null default 0 check (strikes >= 0),
  created_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now()
);
create index if not exists sandbox_sessions_user_idx on public.sandbox_sessions (user_id);
create index if not exists sandbox_sessions_last_active_idx on public.sandbox_sessions (last_active_at);

create table if not exists public.lab_slots (
  id          text        primary key default gen_random_uuid()::text,
  college_id  text        not null references public.colleges (id) on delete cascade,
  section_id  text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  capacity    integer     not null check (capacity > 0),
  unit_id     text,
  created_by  text        references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint lab_slots_ends_after_start check (ends_at > starts_at),
  constraint lab_slots_section_same_college foreign key (section_id, college_id) references public.sections (id, college_id)
);
create index if not exists lab_slots_college_start_idx on public.lab_slots (college_id, starts_at);

create table if not exists public.slot_assignments (
  slot_id      text        not null references public.lab_slots (id) on delete cascade,
  user_id      text        not null references public.users (id) on delete cascade,
  assigned_by  text        references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (slot_id, user_id)
);
create index if not exists slot_assignments_user_idx on public.slot_assignments (user_id);

create table if not exists public.lab_queue (
  id           bigint      generated always as identity primary key,
  user_id      text        not null references public.users (id) on delete cascade,
  college_id   text        references public.colleges (id) on delete cascade,
  unit_id      text,
  status       text        not null default 'waiting' check (status in ('waiting', 'admitted', 'expired', 'cancelled')),
  enqueued_at  timestamptz not null default now(),
  admitted_at  timestamptz,
  expires_at   timestamptz
);
-- a learner waits at most once
create unique index if not exists lab_queue_one_waiting_key on public.lab_queue (user_id) where status = 'waiting';
create index if not exists lab_queue_waiting_idx on public.lab_queue (college_id, enqueued_at) where status = 'waiting';

alter table public.sandbox_sessions enable row level security;
alter table public.lab_slots        enable row level security;
alter table public.slot_assignments enable row level security;
alter table public.lab_queue        enable row level security;
revoke all on public.sandbox_sessions, public.lab_slots, public.slot_assignments, public.lab_queue from anon, authenticated;
