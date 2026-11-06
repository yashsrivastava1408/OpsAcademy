-- 0011: lab nodes and single-use terminal tickets (ADR 0005).
--
-- lab_nodes: one row per lab server, refreshed by the agent's heartbeat. Placement only uses rows seen
-- recently and not draining.
-- terminal_tickets: a browser trades its bearer token for a short-lived, single-use ticket and opens the
-- terminal WebSocket with that, so no JWT sits in a URL. Only the SHA-256 of the ticket is stored.

create table if not exists public.lab_nodes (
  node_id       text        primary key check (length(node_id) between 1 and 64),
  base_url      text        not null,
  capacity      integer     not null check (capacity >= 0),
  running       integer     not null default 0 check (running >= 0),
  draining      boolean     not null default false,
  version       text,
  last_seen_at  timestamptz not null default now()
);
create index if not exists lab_nodes_seen_idx on public.lab_nodes (last_seen_at);

create table if not exists public.terminal_tickets (
  hash        text        primary key,
  session_id  text        not null references public.sandbox_sessions (session_id) on delete cascade,
  user_id     text        not null references public.users (id) on delete cascade,
  expires_at  timestamptz not null
);
create index if not exists terminal_tickets_expires_idx on public.terminal_tickets (expires_at);

alter table public.lab_nodes enable row level security;
alter table public.terminal_tickets enable row level security;
revoke all on public.lab_nodes, public.terminal_tickets from anon, authenticated;
