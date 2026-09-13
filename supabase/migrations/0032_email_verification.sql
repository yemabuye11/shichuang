-- ---------------------------------------------------------------------------
-- T11：用「邮箱验证码」取代「邀请码」注册门槛
--  ① 新增 email_verifications 表（存验证码哈希，仅 service_role / 安全定义者可读）
--  ② 重建 handle_new_user()：删掉邀请码校验 + 去掉 pgcrypto(digest) 依赖
--     （也顺手修了之前「Database error saving new user」的根因：pgcrypto 缺失时 digest 直接报错且被 Supabase 吞掉）
--  ③ system_config 的 auth 段：只保留 password 登录方式、关闭 requireInviteCode
-- ---------------------------------------------------------------------------

-- a) 邮箱验证码表
--    RLS 必须开启（无策略 = 默认全拒绝）：前端/匿名用户访问不了；
--    service_role（Edge Function）自动绕过 RLS 正常读写；
--    security definer 触发器以表主身份执行，同样不受影响。
create table if not exists public.email_verifications (
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

create index if not exists email_verifications_email_idx
  on public.email_verifications (email, created_at desc);

alter table public.email_verifications enable row level security;

-- b) 重建注册触发器：去掉邀请码校验 + 去掉 pgcrypto
--    签名（returns trigger）不变，故可用 create or replace，无需 ALTER TYPE、无需重建触发器。
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
  -- 客户端传来的 email_verified 只是便利标记，真正信任以数据库 consumed 记录为准（纵深防御）
  v_email_verified boolean := false;
begin
  v_nickname := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), '老师');
  v_subject  := coalesce(new.raw_user_meta_data ->> 'subject', '');
  v_grade    := coalesce(new.raw_user_meta_data ->> 'grade', '');
  v_school   := coalesce(new.raw_user_meta_data ->> 'school', '');

  -- 读取注册赠送额度（配置缺失时用常量兜底）
  select coalesce((value ->> 'register_gift')::integer, 100)
    into v_gift
    from public.system_config
   where key = 'credit';

  -- 客户端元数据里可能带了 email_verified=true，但不可轻信（客户端可伪造），仅记录
  v_email_verified := coalesce(new.raw_user_meta_data ->> 'email_verified', '') = 'true';

  -- ---- 服务端信任校验（纵深防御，客户端无法通过伪造 email_verified 绕过）----
  if not exists (
    select 1 from public.email_verifications
    where lower(email) = lower(new.email)
      and consumed = true
      and consumed_at > now() - interval '30 minutes'
  ) then
    raise exception '请先完成邮箱验证' using errcode = 'P0001';
  end if;

  -- ---- 建 profile ----（avatar_seed 改用核心 PG 的 md5，去掉 pgcrypto 依赖）
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

-- 触发器 on_auth_user_created 已在 0002 创建（after insert on auth.users），
-- create or replace function 不改变签名，触发器继续生效，这里无需重建。

-- c) 更新 system_config：登录界面只展示「密码」登录方式 + 关闭邀请码门槛
update public.system_config
  set value = jsonb_set(jsonb_set(value, '{auth,providers}', '["password"]'::jsonb, true), '{auth,requireInviteCode}', 'false'::jsonb, true)
  where key = 'auth';
