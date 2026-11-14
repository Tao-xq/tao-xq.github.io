begin;
create table public.community_posts (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references auth.users(id),
 author text not null check(char_length(author) between 1 and 24), title text not null check(char_length(title) between 1 and 28),
 body text not null check(octet_length(body)<=400000), plain_body text not null check(char_length(plain_body) between 1 and 50000),
 cover text not null, lang text not null check(lang in ('zh','en','ja')),
 published_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 version integer not null default 1, status text not null default 'published' check(status in ('published','hidden'))
);
create index community_latest on public.community_posts(published_at desc, id desc) where status='published';
create table public.short_notes (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references auth.users(id),
 author text not null check(char_length(author) between 1 and 24), body text not null check(char_length(body) between 1 and 280),
 published_at timestamptz not null default now(), status text not null default 'published' check(status in ('published','hidden'))
);
create index notes_latest on public.short_notes(published_at desc, id desc) where status='published';
create table public.post_view_counts(post_id text primary key, views bigint not null default 0);
create table public.post_view_receipts(post_id text not null, visitor_hash text not null, day date not null default current_date, primary key(post_id,visitor_hash,day));
create table public.api_limits(bucket text primary key, used integer not null default 0, expires_at timestamptz not null);
create table public.post_translations(post_id text not null, version text not null, target text not null check(target in ('zh','en','ja')), texts jsonb, state text not null default 'pending', created_at timestamptz not null default now(), primary key(post_id,version,target));
create table public.translation_budget(id boolean primary key default true check(id), used bigint not null default 0, maximum bigint not null default 900000 check(maximum>=0));
insert into public.translation_budget(id) values(true);
create table public.uploads(path text primary key, author_id uuid not null references auth.users(id), kind text not null check(kind in ('cover','body')), bytes integer not null, created_at timestamptz not null default now());
alter table public.community_posts enable row level security;
alter table public.short_notes enable row level security;
alter table public.post_view_counts enable row level security;
alter table public.post_view_receipts enable row level security;
alter table public.api_limits enable row level security;
alter table public.post_translations enable row level security;
alter table public.translation_budget enable row level security;
alter table public.uploads enable row level security;
-- All access goes through the validated Edge API. No public table/RPC writes.
revoke all on public.community_posts, public.short_notes, public.post_view_counts, public.post_view_receipts, public.api_limits, public.post_translations, public.translation_budget, public.uploads from anon, authenticated;
grant all on public.community_posts, public.short_notes, public.post_view_counts, public.post_view_receipts, public.api_limits, public.post_translations, public.translation_budget, public.uploads to service_role;
create function public.take_limit(p_bucket text,p_max integer,p_seconds integer) returns boolean language plpgsql security definer set search_path=public as $$
declare n integer; begin
 insert into api_limits(bucket,used,expires_at) values(p_bucket,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket) do update set used=case when api_limits.expires_at<now() then 1 else api_limits.used+1 end,
 expires_at=case when api_limits.expires_at<now() then now()+make_interval(secs=>p_seconds) else api_limits.expires_at end returning used into n;
 return n<=p_max; end $$;
create function public.record_view(p_post text,p_visitor text) returns bigint language plpgsql security definer set search_path=public as $$
declare n bigint; begin
 insert into post_view_receipts(post_id,visitor_hash) values(p_post,p_visitor) on conflict do nothing;
 if found then insert into post_view_counts(post_id,views) values(p_post,1) on conflict(post_id) do update set views=post_view_counts.views+1; end if;
 select views into n from post_view_counts where post_id=p_post; return coalesce(n,0); end $$;
create function public.reserve_translation(p_chars integer) returns boolean language plpgsql security definer set search_path=public as $$
begin update translation_budget set used=used+p_chars where id and used+p_chars<=maximum; return found; end $$;
revoke all on function public.take_limit(text,integer,integer), public.record_view(text,text), public.reserve_translation(integer) from public,anon,authenticated;
grant execute on function public.take_limit(text,integer,integer), public.record_view(text,text), public.reserve_translation(integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('post-images','post-images',true,2097152,array['image/jpeg','image/png']) on conflict(id) do nothing;
-- Storage writes also pass through the Edge API; the public bucket only serves images.
commit;
