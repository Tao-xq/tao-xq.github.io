begin;
create table if not exists public.visitor_profiles (
 author_id uuid primary key references auth.users(id),
 avatar text,
 updated_at timestamptz not null default now()
);
alter table public.visitor_profiles enable row level security;
revoke all on public.visitor_profiles from anon, authenticated;
grant all on public.visitor_profiles to service_role;
alter table public.uploads drop constraint if exists uploads_kind_check;
alter table public.uploads add constraint uploads_kind_check check(kind in ('cover','body','avatar'));
commit;
