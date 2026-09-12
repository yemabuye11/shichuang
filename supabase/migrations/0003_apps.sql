-- =============================================================================
-- 0003_apps.sql
-- 应用元数据（**不存 HTML 正文**，只存 URL / 状态 / 摘要）
-- =============================================================================

create table if not exists public.apps (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references public.profiles (id) on delete cascade,

  title           text not null default '未命名应用',
  summary         text not null default '',
  app_type        public.app_type_enum not null default 'auto',

  subject         text not null default '',
  grade           text not null default '',
  textbook        text not null default '',
  duration        text not null default '',
  difficulty      text not null default '',

  prompt_raw      text not null default '',
  prompt_enhanced text not null default '',
  model           text not null default '',
  prompt_version  text not null default '',

  html_url        text,                                   -- 外部静态托管的对外 URL
  html_status     public.html_status_enum not null default 'pending',
  html_size_bytes integer not null default 0,
  html_sha256     text    not null default '',
  html_version    integer not null default 1,

  cover_kind      text not null default 'auto',
  cover_seed      text not null default '',
  cover_url       text,

  status          public.app_status_enum not null default 'draft',
  published_at    timestamptz,

  view_count      integer not null default 0,
  like_count      integer not null default 0,
  remix_count     integer not null default 0,

  credits_cost    integer not null default 0,
  tokens_in       integer not null default 0,
  tokens_out      integer not null default 0,
  generation_ms   integer not null default 0,

  parent_app_id   uuid references public.apps (id) on delete set null,   -- remix 来源

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 数据库层二次防线：单文件 200KB 上限
  constraint apps_html_size_chk check (html_size_bytes <= 204800)
);

create index if not exists apps_status_published_idx
  on public.apps (status, published_at desc);
create index if not exists apps_status_view_idx
  on public.apps (status, view_count desc);
create index if not exists apps_status_like_idx
  on public.apps (status, like_count desc);
create index if not exists apps_type_status_idx
  on public.apps (app_type, status, published_at desc);
create index if not exists apps_author_created_idx
  on public.apps (author_id, created_at desc);
create index if not exists apps_title_trgm_idx
  on public.apps using gin (title gin_trgm_ops);

drop trigger if exists trg_apps_touch on public.apps;
create trigger trg_apps_touch
  before update on public.apps
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 被下架的应用不允许作者自行改回（只允许管理员恢复）
-- ---------------------------------------------------------------------------
create or replace function public.apps_guard_takedown()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'taken_down' and new.status <> 'taken_down' then
    if not exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role = 'admin'
    ) then
      raise exception '该应用已被下架，如需恢复请联系管理员' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_apps_guard_takedown on public.apps;
create trigger trg_apps_guard_takedown
  before update on public.apps
  for each row execute function public.apps_guard_takedown();
