-- =============================================================================
-- 0036_register_harden.sql
-- 注册链路加固（排查「Database error saving new user」后落地）
--
-- 背景：
--   - Supabase Auth 在触发器 raise exception 时，会把中文异常一律吞成通用报错
--     "Database error saving new user"，前端拿不到真因。
--   - 磁盘上 0002（强制邀请码闸）与 0032（强制邮箱验证码闸）都 create or replace
--     同一个 handle_new_user；若手动跑 SQL 漏了 0032，DB 会停在 0002 旧闸，
--     而新前端已不发邀请码 → 注册必炸。
--   - system_config 种子写的是 registerGift（驼峰），触发器却读 register_gift（蛇形），
--     导致配置赠分永远失效、兜底成 100。
--
-- 本迁移幂等、可重复跑，确定性地把「邮箱验证码闸」版本落到 DB，并修键名 bug。
-- 不改任何其他业务逻辑；不新增表以外的对象。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ① 确保 email_verifications 表 / 索引 / RLS 存在（防 0032 漏跑）
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'email_verifications'
  ) then
    create table public.email_verifications (
      id          uuid primary key default gen_random_uuid(),
      email       text not null,
      code_hash   text not null,
      expires_at  timestamptz not null,
      consumed    boolean not null default false,
      consumed_at timestamptz,
      attempts    integer not null default 0,
      ip          text not null default '',
      created_at  timestamptz not null default now()
    );
    create index email_verifications_email_idx
      on public.email_verifications (email, created_at desc);
    alter table public.email_verifications enable row level security;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ② 重建 handle_new_user：邮箱验证码闸 + 修 register_gift 键名
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gift      integer := 100;
  v_nickname  text := '老师';
  v_subject   text := '';
  v_grade     text := '';
  v_school    text := '';
  v_cfg       jsonb := '{}'::jsonb;
begin
  v_nickname := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), '老师');
  v_subject  := coalesce(new.raw_user_meta_data ->> 'subject', '');
  v_grade    := coalesce(new.raw_user_meta_data ->> 'grade', '');
  v_school   := coalesce(new.raw_user_meta_data ->> 'school', '');

  -- 读取注册赠送额度：键名兼容 register_gift 与 registerGift 两种写法，
  -- 缺失或非数字时兜底 100，绝不因配置读取出错而中断注册。
  select coalesce(value, '{}'::jsonb) into v_cfg
    from public.system_config where key = 'credit';
  v_gift := coalesce(
    nullif(v_cfg ->> 'register_gift', '')::integer,
    nullif(v_cfg ->> 'registerGift', '')::integer,
    100
  );

  -- ---- 服务端信任校验（纵深防御，不轻信客户端传来的 email_verified 标记）----
  if not exists (
    select 1 from public.email_verifications
    where lower(email) = lower(new.email)
      and consumed = true
      and consumed_at > now() - interval '30 minutes'
  ) then
    raise exception '请先完成邮箱验证' using errcode = 'P0001';
  end if;

  -- ---- 建 profile ----（avatar_seed 用核心 PG 的 md5，不依赖 pgcrypto）
  insert into public.profiles (id, nickname, avatar_seed, subject, grade, school)
  values (
    new.id,
    v_nickname,
    md5(new.id::text || v_nickname),
    v_subject,
    v_grade,
    v_school
  );

  -- ---- 建积分账户并赠送 ----
  insert into public.credit_accounts (user_id, balance, total_earned)
  values (new.id, v_gift, v_gift);

  insert into public.credit_transactions (user_id, delta, balance_after, reason, ref_type, ref_id, memo)
  values (new.id, v_gift, v_gift, 'register_gift', 'code', lower(new.email), '新用户注册赠送');

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- ③ 确保触发器存在（防 0002 漏跑导致注册不建资料）
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
