-- 0010: the session registry (Phase 3). Any gateway instance looks sessions up here, so the lookups
-- the gateway makes on every request need indexes: by owner and lab, and by lab node.
create index if not exists sandbox_sessions_user_lab_idx on public.sandbox_sessions (user_id, lab_id);
create index if not exists sandbox_sessions_node_idx on public.sandbox_sessions (node_id) where node_id is not null;
create index if not exists sandbox_sessions_created_idx on public.sandbox_sessions (created_at);
