-- =============================================================================
-- 0004_social_views_likes_reports.sql
-- 点赞 / 浏览去重 / 举报
-- =============================================================================

-- ---------------------------------------------------------------------------
-- app_likes（赞数由触发器维护 apps.like_count）
-- ---------------------------------------------------------------------------
create table if not exists public.app_likes (
  app_id     uuid not null references public.apps (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (app_id, user_id)
);

create index if not exists app_likes_user_idx on public.app_likes (user_id);

create or replace function public.trg_app_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.apps set like_count = like_count + 1 where id = new.app_id;
  elsif tg_op = 'DELETE' then
    update public.apps set like_count = greatest(like_count - 1, 0) where id = old.app_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_app_likes_count on public.app_likes;
create trigger trg_app_likes_count
  after insert or delete on public.app_likes
  for each row execute function public.trg_app_likes_count();

-- ---------------------------------------------------------------------------
-- app_views（浏览去重：同 hash 同日只计 1 次；不存明文 IP/UA）
-- viewer_hash = sha256(ip | ua | app_id | SECRET_SALT)
-- ---------------------------------------------------------------------------
create table if not exists public.app_views (
  id          bigserial primary key,
  app_id      uuid not null references public.apps (id) on delete cascade,
  viewer_hash text not null,
  view_date   date not null default current_date,
  created_at  timestamptz not null default now()
);

create unique index if not exists app_views_dedup_uidx
  on public.app_views (app_id, viewer_hash, view_date);
create index if not exists app_views_app_date_idx on public.app_views (app_id, view_date);

-- ---------------------------------------------------------------------------
-- reports（举报；防泄露举报人，客户端不可 SELECT）
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id            bigserial primary key,
  app_id        uuid not null references public.apps (id) on delete cascade,
  reporter_id   uuid references public.profiles (id) on delete set null,
  reporter_hash text not null default '',
  reason        text not null,
  detail        text not null default '',
  status        public.report_status_enum not null default 'pending',
  created_at    timestamptz not null default now(),
  handled_by    uuid references public.profiles (id),
  handled_at    timestamptz
);

create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_app_idx    on public.reports (app_id);
