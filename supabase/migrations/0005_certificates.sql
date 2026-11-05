-- 0005: certificates and their public verification.
-- `signature` is the HMAC the application checks on /verify; the other signed
-- fields are columns so the record can be re-verified from the row alone.

create table if not exists public.certificates (
  id            text        primary key check (id ~ '^OPS-[0-9A-F]{12}$'),
  user_id       text        not null references public.users (id) on delete cascade,
  college_id    text        references public.colleges (id) on delete set null,
  student_name  text        not null,
  unit_id       text        not null,
  unit_title    text        not null,
  score         integer     not null check (score between 0 and 100),
  issued_at     timestamptz not null,
  signature     text        not null,
  unique (user_id, unit_id)
);
create index if not exists certificates_user_idx on public.certificates (user_id);
create index if not exists certificates_college_idx on public.certificates (college_id) where college_id is not null;

alter table public.certificates enable row level security;
revoke all on public.certificates from anon, authenticated;
