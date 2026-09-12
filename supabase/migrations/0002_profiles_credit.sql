-- =============================================================================
-- 0002_profiles_credit.sql
-- 用户资料 / 积分账户 / 积分流水 / 会员套餐 / 兑换码 / 系统配置
--
-- 客户已拍板的商业模式：会员套餐 + 积分，走线下人工充值（兑换码），不做在线支付。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ① system_config（键值为 jsonb，全站配置的唯一来源）
-- 说明：建表放这里是因为 handle_new_user() 等触发器要在运行时读取它；
--      种子数据见 0006_system_config_seed.sql。
-- ---------------------------------------------------------------------------
create table if not exists public.system_config (
  key         text primary key,
  value       jsonb       not null default '{}'::jsonb,
  description text        not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- ---------------------------------------------------------------------------
-- ② profiles（auth.users 的公开扩展）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  nickname     text              not null default '老师',
  avatar_seed  text              not null default '',
  role         public.user_role_enum   not null default 'user',
  status       public.user_status_enum not null default 'active',
  subject      text              not null default '',
  grade        text              not null default '',
  school       text              not null default '',
  invite_code  text              not null default '',   -- 注册时使用的邀请码
  created_at   timestamptz       not null default now(),
  updated_at   timestamptz       not null default now()
);

create index if not exists profiles_role_idx  on public.profiles (role);
create index if not exists profiles_status_idx on public.profiles (status);

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ③ credit_accounts（积分账户，唯一余额真相源）
-- ---------------------------------------------------------------------------
create table if not exists public.credit_accounts (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  balance      integer not null default 0 check (balance >= 0),   -- 硬约束：不允许为负
  total_earned integer not null default 0,
  total_used   integer not null default 0,
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ④ credit_transactions（积分流水，只增不改）
-- 幂等：按 ref_type + ref_id 的唯一索引防止重复预扣 / 重复退还
-- ---------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id            bigserial primary key,
  user_id       uuid      not null references public.profiles (id) on delete cascade,
  delta         integer   not null,                -- 正=收入 负=支出
  balance_after integer   not null,
  reason        public.ledger_reason_enum not null,
  ref_type      text      not null default '',     -- generate_spend | generate_refund | code | admin | app
  ref_id        text      not null default '',     -- job_id / code / app_id
  tokens_in     integer   not null default 0,
  tokens_out    integer   not null default 0,
  model         text      not null default '',
  cost_cny      numeric(10, 4) not null default 0, -- 平台侧真实成本记账
  memo          text      not null default '',
  operator_id   uuid      references public.profiles (id),  -- 管理员调整时留操作人
  created_at    timestamptz not null default now()
);

create index if not exists credit_tx_user_created_idx
  on public.credit_transactions (user_id, created_at desc);
create index if not exists credit_tx_reason_idx
  on public.credit_transactions (reason);

-- 幂等唯一索引：同一个 job 只能预扣一次、只能退还一次
create unique index if not exists credit_tx_spend_uidx
  on public.credit_transactions (ref_id) where ref_type = 'generate_spend';
create unique index if not exists credit_tx_refund_uidx
  on public.credit_transactions (ref_id) where ref_type = 'generate_refund';

-- ---------------------------------------------------------------------------
-- ⑤ membership_plans（会员套餐档位，管理员可增删改）
-- ---------------------------------------------------------------------------
create table if not exists public.membership_plans (
  id            text primary key,                  -- free | basic | pro | school
  name          text      not null,
  credits       integer   not null default 0 check (credits >= 0),  -- 套餐内含积分
  duration_days integer   not null default 0 check (duration_days >= 0), -- 0 = 赠送积分不计时
  price_cny     numeric(10, 2) not null default 0, -- 线下充值参考价（仅展示/对账）
  description   text      not null default '',
  sort_order    integer   not null default 0,
  enabled       boolean   not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists trg_membership_plans_touch on public.membership_plans;
create trigger trg_membership_plans_touch
  before update on public.membership_plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ⑥ user_memberships（用户当前会员身份）
-- ---------------------------------------------------------------------------
create table if not exists public.user_memberships (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  plan_id     text not null references public.membership_plans (id),
  started_at  timestamptz not null default now(),
  expires_at  timestamptz,
  status      public.membership_status_enum not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_user_memberships_touch on public.user_memberships;
create trigger trg_user_memberships_touch
  before update on public.user_memberships
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ⑦ redemption_codes（兑换码：积分码 / 邀请码 / 套餐码）
-- ---------------------------------------------------------------------------
create table if not exists public.redemption_codes (
  code        text primary key,                     -- 10 位大写，剔除 0/O/1/I
  kind        public.redemption_kind_enum   not null default 'credit',
  plan_id     text references public.membership_plans (id),
  credits     integer not null default 0 check (credits >= 0),   -- 兑换后入账积分
  valid_days  integer not null default 0 check (valid_days >= 0), -- 会员有效天数（0=仅加积分）
  batch_no    text    not null default '',
  status      public.redemption_status_enum not null default 'unused',
  used_by     uuid    references public.profiles (id),
  used_at     timestamptz,
  expires_at  timestamptz,
  created_by  uuid    references public.profiles (id),
  created_at  timestamptz not null default now(),
  memo        text    not null default ''
);

create index if not exists redemption_codes_status_idx on public.redemption_codes (status);
create index if not exists redemption_codes_kind_idx   on public.redemption_codes (kind);
create index if not exists redemption_codes_batch_idx  on public.redemption_codes (batch_no);
create index if not exists redemption_codes_used_by_idx on public.redemption_codes (used_by);

-- ---------------------------------------------------------------------------
-- 触发器：auth.users 新增 → 建 profile + 积分账户 + 发注册赠送 + 核销邀请码
-- P0 规则：注册必须填写邀请码；不做强制邮箱验证，靠邀请码防薅。
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code      text := '';
  v_row       public.redemption_codes%rowtype;
  v_gift      integer := 100;
  v_nickname  text := '老师';
  v_subject   text := '';
  v_grade     text := '';
  v_school    text := '';
  v_plan      public.membership_plans%rowtype;
begin
  v_code     := upper(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')));
  v_nickname := coalesce(nullif(trim(new.raw_user_meta_data ->> 'nickname'), ''), '老师');
  v_subject  := coalesce(new.raw_user_meta_data ->> 'subject', '');
  v_grade    := coalesce(new.raw_user_meta_data ->> 'grade', '');
  v_school   := coalesce(new.raw_user_meta_data ->> 'school', '');

  -- 读取注册赠送额度（配置缺失时用常量兜底）
  select coalesce((value ->> 'register_gift')::integer, 100)
    into v_gift
    from public.system_config
   where key = 'credit';

  -- ---- 邀请码强校验（注册必须填邀请码）----
  if v_code = '' then
    raise exception '注册需要填写邀请码' using errcode = 'P0001';
  end if;

  select * into v_row from public.redemption_codes where code = v_code for update;

  if not found then
    raise exception '邀请码不正确，请向管理员索取' using errcode = 'P0001';
  end if;
  if v_row.kind <> 'invite' then
    raise exception '这不是邀请码，请到「我的 - 兑换码充值」使用' using errcode = 'P0001';
  end if;
  if v_row.status <> 'unused' then
    raise exception '该邀请码已被使用' using errcode = 'P0001';
  end if;
  if v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception '该邀请码已过期' using errcode = 'P0001';
  end if;

  -- 邀请码可携带赠送额度：优先用码上的面额，否则用全局注册赠送
  if v_row.credits > 0 then
    v_gift := v_row.credits;
  end if;

  -- ---- 建 profile ----
  insert into public.profiles (id, nickname, avatar_seed, subject, grade, school, invite_code)
  values (
    new.id,
    v_nickname,
    encode(digest(new.id::text || v_nickname, 'sha256'), 'hex'),
    v_subject,
    v_grade,
    v_school,
    v_code
  );

  -- ---- 建积分账户并赠送 ----
  insert into public.credit_accounts (user_id, balance, total_earned)
  values (new.id, v_gift, v_gift);

  insert into public.credit_transactions (user_id, delta, balance_after, reason, ref_type, ref_id, memo)
  values (new.id, v_gift, v_gift, 'register_gift', 'code', v_code, '新用户注册赠送');

  -- ---- 核销邀请码 ----
  update public.redemption_codes
     set status = 'used', used_by = new.id, used_at = now()
   where code = v_code;

  -- ---- 邀请码若绑定了套餐，顺带开通会员 ----
  if v_row.plan_id is not null then
    select * into v_plan from public.membership_plans where id = v_row.plan_id;
    if found and v_plan.enabled then
      insert into public.user_memberships (user_id, plan_id, started_at, expires_at, status)
      values (
        new.id,
        v_plan.id,
        now(),
        case when v_plan.duration_days > 0
             then now() + (v_plan.duration_days || ' days')::interval
             else null end,
        'active'
      );
      if v_plan.credits > 0 then
        update public.credit_accounts
           set balance = balance + v_plan.credits,
               total_earned = total_earned + v_plan.credits,
               updated_at = now()
         where user_id = new.id;
        insert into public.credit_transactions
          (user_id, delta, balance_after, reason, ref_type, ref_id, memo)
        select new.id, v_plan.credits, balance, 'redeem_code', 'code', v_code,
               '开通会员「' || v_plan.name || '」赠送'
          from public.credit_accounts where user_id = new.id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
