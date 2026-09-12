-- =============================================================================
-- 0007_jobs_daily_events.sql
-- 生成任务（并发控制 + 预扣退还的幂等锚点） / 每日计数 / 埋点
-- =============================================================================

-- ---------------------------------------------------------------------------
-- generation_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.generation_jobs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  app_id           uuid references public.apps (id) on delete set null,
  app_type         public.app_type_enum not null default 'auto',
  model            text not null default '',
  status           public.job_status_enum not null default 'running',
  reserved_credits integer not null default 0,
  tokens_in        integer not null default 0,
  tokens_out       integer not null default 0,
  cost_cny         numeric(10, 4) not null default 0,
  prompt_version   text not null default '',
  error_code       text not null default '',
  error_message    text not null default '',
  idempotency_key  text not null default '',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index if not exists gen_jobs_user_started_idx
  on public.generation_jobs (user_id, started_at desc);
create index if not exists gen_jobs_app_idx
  on public.generation_jobs (app_id);
-- 并发：单用户同时只允许 1 个 running
create unique index if not exists gen_jobs_running_uidx
  on public.generation_jobs (user_id) where status = 'running';
-- 幂等：同一 idempotency_key 只会创建一个 job
create unique index if not exists gen_jobs_idem_uidx
  on public.generation_jobs (user_id, idempotency_key)
  where idempotency_key <> '';

-- ---------------------------------------------------------------------------
-- generation_daily（单用户每日生成次数，上限 30）
-- ---------------------------------------------------------------------------
create table if not exists public.generation_daily (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  day      date not null default current_date,
  count    integer not null default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- events（埋点，只进不出）
-- name: register | generate_start | generate_success | generate_fail | publish
--       | app_open | share_click
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id       bigserial primary key,
  name     text not null,
  user_id  uuid references public.profiles (id) on delete set null,
  anon_id  text not null default '',
  app_id   uuid references public.apps (id) on delete set null,
  props    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_name_created_idx on public.events (name, created_at desc);
create index if not exists events_user_idx          on public.events (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 埋点写入入口（anon 可写；客户端不可 SELECT，由 RLS 保证）
-- ---------------------------------------------------------------------------
create or replace function public.track_event(
  p_name   text,
  p_props  jsonb default '{}'::jsonb,
  p_app_id uuid default null,
  p_anon_id text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.events (name, user_id, anon_id, app_id, props)
  values (p_name, auth.uid(), coalesce(p_anon_id, ''), p_app_id, coalesce(p_props, '{}'::jsonb));
  return true;
end;
$$;
