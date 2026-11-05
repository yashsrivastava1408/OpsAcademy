-- 0004: learning progress, one row per learner.
--
-- Fields that are ranked or filtered are typed columns. The per-learner learning
-- state (steps, hints, quizzes, flashcards, interviews) stays jsonb with the same
-- shape the application already uses (timestamps inside are epoch milliseconds);
-- split a part out only when a query needs it. Updates run inside a transaction
-- on a `select … for update` row lock, so XP and streaks cannot race.

create table if not exists public.progress (
  user_id               text        primary key references public.users (id) on delete cascade,
  xp                    integer     not null default 0 check (xp >= 0),
  completed_unit_count  integer     not null default 0 check (completed_unit_count >= 0),
  active_days           date[]      not null default '{}',
  completed_units       jsonb       not null default '{}'::jsonb,
  steps                 jsonb       not null default '{}'::jsonb,
  hints                 jsonb       not null default '{}'::jsonb,
  quizzes               jsonb       not null default '{}'::jsonb,
  cards                 jsonb       not null default '{}'::jsonb,
  interviews            jsonb       not null default '[]'::jsonb,
  daily                 jsonb       not null default '{}'::jsonb,
  updated_at            timestamptz not null default now()
);
create index if not exists progress_xp_idx on public.progress (xp desc) where xp > 0;

drop trigger if exists progress_set_updated_at on public.progress;
create trigger progress_set_updated_at before update on public.progress
  for each row execute function public.set_updated_at();

alter table public.progress enable row level security;
revoke all on public.progress from anon, authenticated;
