-- 0007: AI usage (cost, latency, outcome per call) and an append-only audit log.

create table if not exists public.ai_usage (
  id             bigint      generated always as identity primary key,
  user_id        text        references public.users (id) on delete set null,
  college_id     text        references public.colleges (id) on delete set null,
  job            text        not null check (job in ('hint', 'interview', 'embedding', 'other')),
  provider       text        not null,
  model          text        not null,
  input_tokens   integer     not null default 0 check (input_tokens >= 0),
  output_tokens  integer     not null default 0 check (output_tokens >= 0),
  cost_micros    bigint      not null default 0 check (cost_micros >= 0), -- millionths of a US dollar
  latency_ms     integer     check (latency_ms >= 0),
  outcome        text        not null default 'ok' check (outcome in ('ok', 'fallback', 'refused', 'error')),
  created_at     timestamptz not null default now()
);
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, created_at);
create index if not exists ai_usage_college_day_idx on public.ai_usage (college_id, created_at);

create table if not exists public.audit_log (
  id           bigint      generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     text,
  actor_role   text,
  action       text        not null,
  entity_type  text,
  entity_id    text,
  college_id   text,
  ip           inet,
  meta         jsonb       not null default '{}'::jsonb
);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index if not exists audit_log_college_idx on public.audit_log (college_id, at desc);

-- Append-only: rows cannot be changed or removed unless a retention job opts in
-- with `set local app.audit_purge = 'on'` inside its own transaction.
create or replace function public.audit_log_immutable() returns trigger
language plpgsql as $$
begin
  if current_setting('app.audit_purge', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

alter table public.ai_usage  enable row level security;
alter table public.audit_log enable row level security;
revoke all on public.ai_usage, public.audit_log from anon, authenticated;
