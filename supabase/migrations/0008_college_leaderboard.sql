-- 0008: per-college leaderboard as a materialized view (Phase 1, #80).
-- A scan of every learner on each page view does not scale; the worker refreshes
-- this view every minute (REFRESH ... CONCURRENTLY, so reads are never blocked).

create materialized view if not exists public.college_leaderboard as
select m.college_id, p.user_id, p.xp, p.completed_unit_count, p.active_days
from public.progress p
join public.memberships m on m.user_id = p.user_id and m.role = 'student' and m.college_id is not null
where p.xp > 0;

-- required for REFRESH ... CONCURRENTLY
create unique index if not exists college_leaderboard_key on public.college_leaderboard (college_id, user_id);
create index if not exists college_leaderboard_rank_idx on public.college_leaderboard (college_id, xp desc);

revoke all on public.college_leaderboard from anon, authenticated;
