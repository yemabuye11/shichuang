-- 师创 shichuang 数据库迁移合并文件 (0001 -> 030)
-- 含硅基流动适配器模型配置(0030)。SQL Editor：新建查询 -> 粘贴全部 -> Run（仅一次）。

-- =================== 0001_extensions_enums.sql ===================
-- =============================================================================
-- 0001_extensions_enums.sql
-- 扩展与全部枚举类型（幂等：重复执行不会报错）
--
-- 命名约定（ARCHITECTURE.md §8.5）：
--   表名复数小写 / 列名 snake_case / 枚举值 snake_case
-- =============================================================================

-- 通用扩展
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists pg_trgm;    -- 标题模糊搜索

-- ---------------------------------------------------------------------------
-- 枚举类型
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.app_type_enum as enum (
    'auto',
    'teaching_animation',
    'edu_tool',
    'teaching_game',
    'interactive_courseware',
    'data_collection',
    'ai_item_generation',
    'ai_paper_composition',
    'ai_lesson_plan',
    'lesson_plan',
    'ppt',
    'courseware_2d',
    'courseware_3d',
    'office_doc'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_status_enum as enum ('draft', 'published', 'taken_down');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.html_status_enum as enum ('pending', 'ready', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status_enum as enum ('running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- 积分流水原因（客户拍板口径：注册赠送 / 生成消耗 / 失败退还 / 兑换码充值 / 管理员调整 / 发布奖励）
do $$ begin
  create type public.ledger_reason_enum as enum (
    'register_gift',
    'generate_spend',
    'generate_refund',
    'redeem_code',
    'admin_adjust',
    'publish_reward',
    'expire',
    'recharge_self'
  );
exception when duplicate_object then null; end $$;

-- 兑换码类型：积分码 / 邀请码 / 套餐码
do $$ begin
  create type public.redemption_kind_enum as enum ('credit', 'invite', 'membership');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.redemption_status_enum as enum ('unused', 'used', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_role_enum as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_status_enum as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_status_enum as enum ('pending', 'handled', 'dismissed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status_enum as enum ('active', 'expired', 'disabled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 通用：updated_at 自动维护
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =================== 0002_profiles_credit.sql ===================
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


-- =================== 0003_apps.sql ===================
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


-- =================== 0004_social_views_likes_reports.sql ===================
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


-- =================== 0005_prompt_templates_model_profiles.sql ===================
-- =============================================================================
-- 0005_prompt_templates_model_profiles.sql
-- 提示词版本管理 + 模型适配器配置（模型 ID / 单价 / 峰谷系数全部读表，代码零硬编码）
-- =============================================================================

-- ---------------------------------------------------------------------------
-- prompt_templates（按 kind 分节存储，运行时按固定顺序拼装成 system 消息）
--   kind: system_section | app_type | user_enhance | repair
-- ---------------------------------------------------------------------------
create table if not exists public.prompt_templates (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  key        text not null,
  version    integer not null default 1,
  content    text not null,
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index if not exists prompt_templates_kind_key_idx
  on public.prompt_templates (kind, key);
-- 同一 key 只允许一个 active 版本
create unique index if not exists prompt_templates_active_uidx
  on public.prompt_templates (key) where is_active;

-- ---------------------------------------------------------------------------
-- model_profiles（模型供应商 / 模型 ID / 单价 / 积分，后台可配）
-- pricing: { input, cachedInput, output, peakMultiplier }  单位：元 / 百万 token
-- ---------------------------------------------------------------------------
create table if not exists public.model_profiles (
  id                text primary key,                 -- deepseek-v4-flash
  provider          text not null,                    -- deepseek | qwen | glm | doubao
  model_id          text not null,                    -- 厂商 API 的 model 字段
  display_name      text not null,
  api_base          text not null default '',         -- 留空则用适配器内置默认地址
  pricing           jsonb not null default '{"input":1.5,"cachedInput":0.05,"output":4.5,"peakMultiplier":2}'::jsonb,
  max_output_tokens integer not null default 8000,
  credits_per_call  integer not null default 1,        -- 仅展示/兜底，实际按 app_type 计
  is_default        boolean not null default false,
  enabled           boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index if not exists model_profiles_default_uidx
  on public.model_profiles (is_default) where is_default;

drop trigger if exists trg_model_profiles_touch on public.model_profiles;
create trigger trg_model_profiles_touch
  before update on public.model_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- app_type_profiles（8 类 + 自动判断：积分成本 / 模型路由 / 子模板 key）
-- ---------------------------------------------------------------------------
create table if not exists public.app_type_profiles (
  app_type       public.app_type_enum primary key,
  label          text not null,
  credit_cost    integer not null default 1,
  model_override text,                                  -- 按应用类型路由到不同模型
  prompt_key     text not null default '',
  sort_order     integer not null default 0,
  enabled        boolean not null default true
);

insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  ('auto',                   '自动判断',      1, '',                             0),
  ('teaching_animation',     '教学动画',      3, 'app_type:teaching_animation',    1),
  ('edu_tool',               '教育应用',      2, 'app_type:edu_tool',              2),
  ('teaching_game',          '教学游戏',      3, 'app_type:teaching_game',         3),
  ('interactive_courseware', '互动课件',      2, 'app_type:interactive_courseware',4),
  ('data_collection',        '数据回收',      2, 'app_type:data_collection',       5),
  ('ai_item_generation',     'AI命题',        1, 'app_type:ai_item_generation',    6),
  ('ai_paper_composition',   'AI组题',        1, 'app_type:ai_paper_composition',  7),
  ('ai_lesson_plan',         'AI教案·大单元', 1, 'app_type:ai_lesson_plan',        8)
on conflict (app_type) do update
  set label      = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key = excluded.prompt_key,
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- monthly_spend（全局月度支出阀的数据源）
-- ---------------------------------------------------------------------------
create table if not exists public.monthly_spend (
  period     text primary key,                 -- 'YYYY-MM'
  model      text not null default '',
  provider   text not null default '',
  calls      integer not null default 0,
  tokens_in  bigint  not null default 0,
  tokens_out bigint  not null default 0,
  cost_cny   numeric(12, 4) not null default 0,
  updated_at timestamptz not null default now()
);


-- =================== 0006_system_config_seed.sql ===================
-- =============================================================================
-- 0006_system_config_seed.sql
-- 全站配置种子 + 会员套餐档位种子 + 模型配置种子
--
-- 设计原则（ARCHITECTURE.md §3.6）：三项「客户拍板事项」全部走配置，
-- 改配置不改代码、不重新发版。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 品牌（Q1：平台名 = 师创）
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('brand', jsonb_build_object(
    'name',      '师创',
    'shortName', '师创',
    'slogan',    '一句话，做出你的教学应用',
    'subSlogan', '不用写代码，生成后一个链接就能发给学生',
    'logoUrl',   '/icons/icon.svg',
    'domain',    ''
  ), '品牌信息（运行时覆盖前端默认值，改名无需发版）')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 认证（Q2：邮箱 + 密码 + 邀请码；手机号/微信 P0 不启用）
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('auth', jsonb_build_object(
    'providers', jsonb_build_array('password', 'invite'),
    'requireInviteCode', true,
    'requireEmailConfirm', false,
    'smsProvider', '',
    'wechatEnabled', false
  ), '认证方式开关：password | invite | phone(预留) | wechat(预留)')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 积分规则
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('credit', jsonb_build_object(
    'registerGift', 100,
    'publishReward', 2,
    'publishRewardDailyCap', 10,
    'dailyGenerationLimit', 30,
    'cnyPerCredit', 0.05
  ), '积分规则（教师侧计价，与 token 完全解耦）')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 全局限额 / 护栏
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('limit', jsonb_build_object(
    'monthlySpendCny', 100,
    'maxInputTokens', 8000,
    'maxOutputTokens', 8000,
    'maxHtmlBytes', 204800,
    'serveFallbackPerDay', 500,
    'squarePageSize', 24
  ), '平台侧成本护栏与全局上限')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 产物存储：P0 默认 github_pages（零门槛，无需绑卡/域名）
-- 客户办下 Cloudflare 后把 provider 改成 'r2' 即可，代码零改动。
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('artifact', jsonb_build_object(
    'provider', 'github_pages',
    'baseUrl', '',
    'warmup', true
  ), '产物存储 provider：r2 | github_pages | supabase_storage')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 广场
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('square', jsonb_build_object(
    'pageSize', 24,
    'publicBrowsable', true,
    'defaultSort', 'latest'
  ), '应用广场配置')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 会员套餐档位（线下人工充值，不做在线支付）
-- ---------------------------------------------------------------------------
insert into public.membership_plans (id, name, credits, duration_days, price_cny, description, sort_order) values
  ('free',   '体验版',    0,   0,   0,   '注册即赠送，够做完一节课的应用', 0),
  ('basic',  '标准版',    200, 365, 9.9, '适合一位老师一学年的日常备课',   1),
  ('pro',    '专业版',    600, 365, 29,  '适合教研组长与高频使用者',       2),
  ('school', '校级版',    3000, 365, 99, '面向教研组/年级组共享使用',      3)
on conflict (id) do update
  set name = excluded.name,
      credits = excluded.credits,
      duration_days = excluded.duration_days,
      price_cny = excluded.price_cny,
      description = excluded.description,
      sort_order = excluded.sort_order,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 模型配置（Q3：必须同时支持多家；密钥走 Supabase Secrets，不入库）
-- 单价单位：元 / 百万 token；peakMultiplier 为高峰时段倍率。
-- ---------------------------------------------------------------------------
insert into public.model_profiles
  (id, provider, model_id, display_name, api_base, pricing, max_output_tokens, credits_per_call, is_default, enabled, sort_order)
values
  ('deepseek-v4-flash', 'deepseek', 'deepseek-chat', 'DeepSeek V4 Flash',
   'https://api.deepseek.com/v1',
   '{"input":1.5,"cachedInput":0.05,"output":4.5,"peakMultiplier":2}'::jsonb,
   8000, 1, true,  true, 1),

  ('qwen-plus', 'qwen', 'qwen-plus', '通义千问 Plus',
   'https://dashscope.aliyuncs.com/compatible-mode/v1',
   '{"input":2.0,"cachedInput":0.5,"output":8.0,"peakMultiplier":1}'::jsonb,
   8000, 1, false, true, 2),

  ('glm-4-flash', 'glm', 'glm-4-flash', '智谱 GLM-4-Flash',
   'https://open.bigmodel.cn/api/paas/v4',
   '{"input":0.1,"cachedInput":0.05,"output":0.4,"peakMultiplier":1}'::jsonb,
   8000, 1, false, false, 3),

  ('doubao-pro-32k', 'doubao', 'doubao-pro-32k', '豆包 Pro 32K',
   'https://ark.cn-beijing.volces.com/api/v3',
   '{"input":0.8,"cachedInput":0.2,"output":2.0,"peakMultiplier":1}'::jsonb,
   8000, 1, false, false, 4)
on conflict (id) do update
  set provider  = excluded.provider,
      model_id  = excluded.model_id,
      display_name = excluded.display_name,
      api_base  = excluded.api_base,
      pricing   = excluded.pricing,
      max_output_tokens = excluded.max_output_tokens,
      sort_order = excluded.sort_order,
      updated_at = now();

-- 保证只有一个默认模型
update public.model_profiles set is_default = false where is_default and id <> 'deepseek-v4-flash';
update public.model_profiles set is_default = true  where id = 'deepseek-v4-flash';


-- =================== 0007_jobs_daily_events.sql ===================
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


-- =================== 0008_rpc_credit.sql ===================
-- =============================================================================
-- 0008_rpc_credit.sql
-- 积分原子性：预扣 / 结算 / 退还 / 兑换 / 预估 / 生成前检查
--
-- 硬要求（ARCHITECTURE.md §3.5 + PRD P0-F6）：
--   - SELECT ... FOR UPDATE 行锁；
--   - balance >= amount 校验，不足抛 INSUFFICIENT_CREDITS；
--   - 按 job_id / code 的唯一索引保证幂等（重复调用不重复扣/退）；
--   - 全程单事务（函数体本身即事务）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 读配置的便捷函数（统一默认值，避免各处硬编码）
-- ---------------------------------------------------------------------------
create or replace function public.cfg_num(p_key text, p_field text, p_default numeric)
returns numeric
language sql
stable
as $$
  select coalesce((value ->> p_field)::numeric, p_default)
    from public.system_config
   where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- 内部：写入一条流水并同步账户余额（单一出口，保证余额与流水永远一致）
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit(
  p_user_id uuid,
  p_delta   integer,
  p_reason  public.ledger_reason_enum,
  p_ref_type text default '',
  p_ref_id   text default '',
  p_memo     text default '',
  p_tokens_in  integer default 0,
  p_tokens_out integer default 0,
  p_model      text default '',
  p_cost_cny   numeric default 0,
  p_operator_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  -- 行锁：并发下串行化，保证余额不超额
  select balance into v_balance
    from public.credit_accounts
   where user_id = p_user_id
     for update;

  if not found then
    insert into public.credit_accounts (user_id, balance, total_earned)
    values (p_user_id, 0, 0);
    v_balance := 0;
  end if;

  v_balance := v_balance + p_delta;

  if v_balance < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.credit_accounts
     set balance      = v_balance,
         total_earned = total_earned + case when p_delta > 0 then p_delta else 0 end,
         total_used   = total_used   + case when p_delta < 0 then -p_delta else 0 end,
         updated_at   = now()
   where user_id = p_user_id;

  insert into public.credit_transactions
    (user_id, delta, balance_after, reason, ref_type, ref_id,
     tokens_in, tokens_out, model, cost_cny, memo, operator_id)
  values
    (p_user_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id,
     p_tokens_in, p_tokens_out, p_model, coalesce(p_cost_cny, 0), p_memo, p_operator_id);

  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- estimate_cost：生成前预估积分（P0-F2）
-- ---------------------------------------------------------------------------
create or replace function public.estimate_cost(
  p_app_type text default 'auto',
  p_model    text default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cost integer;
begin
  select credit_cost into v_cost
    from public.app_type_profiles
   where app_type = p_app_type::public.app_type_enum;

  return coalesce(v_cost, 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- check_generation_allowed：日限 / 并发 / 月度阀 三查
-- ---------------------------------------------------------------------------
create or replace function public.check_generation_allowed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_limit    integer;
  v_used     integer;
  v_running  integer;
  v_cap      numeric;
  v_spend    numeric;
  v_period   text := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM');
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'code', 'UNAUTHORIZED',
                              'message', '请先登录', 'remainingToday', 0);
  end if;

  v_limit := coalesce((select (value ->> 'dailyGenerationLimit')::integer
                         from public.system_config where key = 'credit'), 30);
  v_cap   := coalesce((select (value ->> 'monthlySpendCny')::numeric
                         from public.system_config where key = 'limit'), 100);

  select coalesce(count, 0) into v_used
    from public.generation_daily
   where user_id = v_uid and day = (now() at time zone 'Asia/Shanghai')::date;

  select count(*) into v_running
    from public.generation_jobs
   where user_id = v_uid and status = 'running';

  if v_running > 0 then
    return jsonb_build_object('allowed', false, 'code', 'CONCURRENT_LIMIT',
                              'message', '你还有一个应用在生成中，请稍等一下',
                              'remainingToday', greatest(v_limit - v_used, 0));
  end if;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'code', 'DAILY_LIMIT',
                              'message', format('今天生成次数已达上限（%s 次），明天再来吧', v_limit),
                              'remainingToday', 0);
  end if;

  select coalesce(sum(cost_cny), 0) into v_spend
    from public.monthly_spend
   where period = v_period;

  if v_spend >= v_cap then
    return jsonb_build_object('allowed', false, 'code', 'MONTHLY_CAP',
                              'message', '平台本月额度已用完，下月再来试试',
                              'remainingToday', greatest(v_limit - v_used, 0));
  end if;

  return jsonb_build_object('allowed', true, 'code', '',
                            'message', '', 'remainingToday', greatest(v_limit - v_used, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_credits：生成前预扣（幂等）
-- ---------------------------------------------------------------------------
create or replace function public.reserve_credits(
  p_amount   integer,
  p_job_id   uuid,
  p_app_type text default 'auto',
  p_model    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
  v_existing integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'UNAUTHORIZED');
  end if;

  -- 幂等：同一 job 已预扣过则直接返回当前余额
  select balance_after into v_existing
    from public.credit_transactions
   where ref_type = 'generate_spend' and ref_id = p_job_id::text;

  if found then
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
    return jsonb_build_object('ok', true, 'balance', coalesce(v_balance, 0), 'code', '', 'idempotent', true);
  end if;

  -- 行锁 + 余额校验
  select balance into v_balance
    from public.credit_accounts
   where user_id = v_uid
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'INSUFFICIENT_CREDITS');
  end if;

  if v_balance < p_amount then
    return jsonb_build_object('ok', false, 'balance', v_balance, 'code', 'INSUFFICIENT_CREDITS');
  end if;

  v_balance := public.apply_credit(
    p_user_id   => v_uid,
    p_delta     => -p_amount,
    p_reason    => 'generate_spend',
    p_ref_type  => 'generate_spend',
    p_ref_id    => p_job_id::text,
    p_memo      => format('生成%s应用预扣', coalesce(p_app_type, '')),
    p_model     => coalesce(p_model, '')
  );

  return jsonb_build_object('ok', true, 'balance', v_balance, 'code', '', 'idempotent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- settle_generation：成功后记账（回填 token/成本 + 累加 monthly_spend）
-- ---------------------------------------------------------------------------
create or replace function public.settle_generation(
  p_job_id     uuid,
  p_tokens_in  integer default 0,
  p_tokens_out integer default 0,
  p_cost_cny   numeric  default 0,
  p_model      text     default '',
  p_app_id     uuid     default null,
  p_ms         integer  default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_period text := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM');
  v_provider text := '';
begin
  if p_job_id is null then
    return;
  end if;
  if v_uid is null then
    select user_id into v_uid from public.generation_jobs where id = p_job_id;
  end if;

  select provider into v_provider from public.model_profiles where id = p_model;

  update public.generation_jobs
     set status      = 'succeeded',
         app_id      = coalesce(p_app_id, app_id),
         tokens_in   = coalesce(p_tokens_in, 0),
         tokens_out  = coalesce(p_tokens_out, 0),
         cost_cny    = coalesce(p_cost_cny, 0),
         model       = coalesce(nullif(p_model, ''), model),
         finished_at = now()
   where id = p_job_id;

  -- 回填流水（预扣那条）与 apps
  update public.credit_transactions
     set tokens_in  = coalesce(p_tokens_in, 0),
         tokens_out = coalesce(p_tokens_out, 0),
         cost_cny   = coalesce(p_cost_cny, 0),
         model      = coalesce(nullif(p_model, ''), model)
   where ref_type = 'generate_spend' and ref_id = p_job_id::text;

  if p_app_id is not null then
    update public.apps
       set tokens_in     = coalesce(p_tokens_in, 0),
           tokens_out    = coalesce(p_tokens_out, 0),
           generation_ms = coalesce(p_ms, 0),
           model         = coalesce(nullif(p_model, ''), model)
     where id = p_app_id;
  end if;

  -- 累加月度支出
  insert into public.monthly_spend (period, model, provider, calls, tokens_in, tokens_out, cost_cny)
  values (v_period, coalesce(p_model, ''), coalesce(v_provider, ''), 1,
          coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), coalesce(p_cost_cny, 0))
  on conflict (period) do update
    set calls      = public.monthly_spend.calls + 1,
        tokens_in  = public.monthly_spend.tokens_in  + excluded.tokens_in,
        tokens_out = public.monthly_spend.tokens_out + excluded.tokens_out,
        cost_cny   = public.monthly_spend.cost_cny   + excluded.cost_cny,
        model      = excluded.model,
        provider   = excluded.provider,
        updated_at = now();

  -- 每日计数
  if v_uid is not null then
    insert into public.generation_daily (user_id, day, count)
    values (v_uid, (now() at time zone 'Asia/Shanghai')::date, 1)
    on conflict (user_id, day) do update
      set count = public.generation_daily.count + 1;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_generation：失败/取消全额退还（幂等，连续调用只退 1 次）
-- ---------------------------------------------------------------------------
create or replace function public.refund_generation(
  p_job_id        uuid,
  p_error_code    text default '',
  p_error_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_amount  integer;
  v_balance integer;
  v_done    boolean := false;
begin
  select user_id, reserved_credits into v_uid, v_amount
    from public.generation_jobs
   where id = p_job_id
     for update;

  if not found then
    return jsonb_build_object('refunded', false, 'balance', 0);
  end if;

  -- 幂等：已退过则不再退
  if exists (
    select 1 from public.credit_transactions
     where ref_type = 'generate_refund' and ref_id = p_job_id::text
  ) then
    v_done := true;
  end if;

  if not v_done and coalesce(v_amount, 0) > 0 then
    v_balance := public.apply_credit(
      p_user_id  => v_uid,
      p_delta    => v_amount,
      p_reason   => 'generate_refund',
      p_ref_type => 'generate_refund',
      p_ref_id   => p_job_id::text,
      p_memo     => format('生成失败退还（%s）', coalesce(nullif(p_error_code, ''), '未知原因'))
    );
  else
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
  end if;

  update public.generation_jobs
     set status        = case when coalesce(p_error_code, '') = 'CANCELLED'
                              then 'cancelled'::public.job_status_enum
                              else 'failed'::public.job_status_enum end,
         error_code    = coalesce(p_error_code, ''),
         error_message = coalesce(p_error_message, ''),
         finished_at   = now()
   where id = p_job_id;

  return jsonb_build_object('refunded', not v_done, 'balance', coalesce(v_balance, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- redeem_code：兑换码充值（积分码 / 套餐码）
-- 事务内 FOR UPDATE 锁定码行，status='unused' 才可兑；同用户同码不可重复。
-- ---------------------------------------------------------------------------
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := upper(trim(coalesce(p_code, '')));
  v_row   public.redemption_codes%rowtype;
  v_plan  public.membership_plans%rowtype;
  v_balance integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'credits', 0, 'balance', 0,
                              'message', '请先登录后再兑换');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE', 'credits', 0, 'balance', 0,
                              'message', '请输入兑换码');
  end if;

  -- 行锁：并发下只有第一个事务能拿到 unused 状态
  select * into v_row from public.redemption_codes where code = v_code for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE', 'credits', 0, 'balance', 0,
                              'message', '兑换码不存在，请检查后重试');
  end if;

  if v_row.status = 'used' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_USED', 'credits', 0, 'balance', 0,
                              'message', '这个兑换码已经被用过了');
  end if;

  if v_row.status = 'disabled' then
    return jsonb_build_object('ok', false, 'code', 'DISABLED', 'credits', 0, 'balance', 0,
                              'message', '这个兑换码已被停用，请联系管理员');
  end if;

  if v_row.kind = 'invite' then
    return jsonb_build_object('ok', false, 'code', 'DISABLED', 'credits', 0, 'balance', 0,
                              'message', '这是邀请码，注册时才能使用');
  end if;

  if v_row.expires_at is not null and v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'EXPIRED', 'credits', 0, 'balance', 0,
                              'message', '这个兑换码已过期');
  end if;

  -- 入账积分
  if v_row.credits > 0 then
    v_balance := public.apply_credit(
      p_user_id  => v_uid,
      p_delta    => v_row.credits,
      p_reason   => 'redeem_code',
      p_ref_type => 'code',
      p_ref_id   => v_code,
      p_memo     => format('兑换码充值（批次 %s）', coalesce(nullif(v_row.batch_no, ''), '默认'))
    );
  else
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
  end if;

  -- 套餐码：开通/续期会员
  if v_row.kind = 'membership' and v_row.plan_id is not null then
    select * into v_plan from public.membership_plans where id = v_row.plan_id;
    if found and v_plan.enabled then
      insert into public.user_memberships (user_id, plan_id, started_at, expires_at, status)
      values (
        v_uid, v_plan.id, now(),
        case when coalesce(nullif(v_row.valid_days, 0), v_plan.duration_days) > 0
             then now() + (coalesce(nullif(v_row.valid_days, 0), v_plan.duration_days) || ' days')::interval
             else null end,
        'active'
      )
      on conflict (user_id) do update
        set plan_id    = excluded.plan_id,
            started_at = now(),
            expires_at = case
              when excluded.expires_at is null then null
              when public.user_memberships.expires_at is not null
                   and public.user_memberships.expires_at > now()
              then public.user_memberships.expires_at
                   + (coalesce(nullif(v_row.valid_days, 0), v_plan.duration_days) || ' days')::interval
              else excluded.expires_at
            end,
            status     = 'active',
            updated_at = now();
    end if;
  end if;

  update public.redemption_codes
     set status = 'used', used_by = v_uid, used_at = now()
   where code = v_code;

  return jsonb_build_object('ok', true, 'code', '', 'credits', v_row.credits,
                            'balance', coalesce(v_balance, 0),
                            'message', format('充值成功，到账 %s 积分', v_row.credits));
end;
$$;


-- =================== 0009_rpc_apps_social_admin.sql ===================
-- =============================================================================
-- 0009_rpc_apps_social_admin.sql
-- 应用 CRUD / 发布 / 点赞 / 举报 / 广场列表 / 管理员后台
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 我的应用：当前用户的积分账户 + 会员（一次往返拿全，省请求）
-- ---------------------------------------------------------------------------
create or replace function public.get_my_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('balance', 0, 'totalEarned', 0, 'totalUsed', 0, 'membership', null);
  end if;

  return jsonb_build_object(
    'balance',     coalesce((select balance from public.credit_accounts where user_id = v_uid), 0),
    'totalEarned', coalesce((select total_earned from public.credit_accounts where user_id = v_uid), 0),
    'totalUsed',   coalesce((select total_used from public.credit_accounts where user_id = v_uid), 0),
    'membership',  (
      select jsonb_build_object(
               'planId', m.plan_id,
               'planName', p.name,
               'expiresAt', m.expires_at,
               'status', m.status
             )
        from public.user_memberships m
        left join public.membership_plans p on p.id = m.plan_id
       where m.user_id = v_uid
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- publish_app：发布到广场（校验作者 + html 就绪 + 发奖励，每日上限 10）
-- ---------------------------------------------------------------------------
create or replace function public.publish_app(
  p_app_id     uuid,
  p_title      text default null,
  p_summary    text default null,
  p_subject    text default null,
  p_grade      text default null,
  p_cover_kind text default 'auto',
  p_cover_seed text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_app     public.apps%rowtype;
  v_reward  integer := 0;
  v_cap     integer := 10;
  v_used    integer := 0;
  v_balance integer;
begin
  select * into v_app from public.apps where id = p_app_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'appId', p_app_id, 'rewardCredits', 0, 'balance', 0,
                              'message', '应用不存在');
  end if;
  if v_app.author_id <> v_uid then
    return jsonb_build_object('ok', false, 'appId', p_app_id, 'rewardCredits', 0, 'balance', 0,
                              'message', '只能发布自己的应用');
  end if;
  if v_app.html_status <> 'ready' then
    return jsonb_build_object('ok', false, 'appId', p_app_id, 'rewardCredits', 0, 'balance', 0,
                              'message', '应用内容还在发布中，请稍候再试');
  end if;

  update public.apps
     set title      = coalesce(nullif(trim(p_title), ''), title),
         summary    = coalesce(p_summary, summary),
         subject    = coalesce(p_subject, subject),
         grade      = coalesce(p_grade, grade),
         cover_kind = coalesce(p_cover_kind, cover_kind),
         cover_seed = coalesce(nullif(trim(p_cover_seed), ''), cover_seed, id::text),
         status     = 'published',
         published_at = coalesce(published_at, now())
   where id = p_app_id;

  -- 发布奖励（每日上限）
  v_reward := coalesce((select (value ->> 'publishReward')::integer
                          from public.system_config where key = 'credit'), 2);
  v_cap    := coalesce((select (value ->> 'publishRewardDailyCap')::integer
                          from public.system_config where key = 'credit'), 10);

  select count(*) into v_used
    from public.credit_transactions
   where user_id = v_uid
     and reason = 'publish_reward'
     and created_at >= (now() at time zone 'Asia/Shanghai')::date;

  if v_used < v_cap then
    v_balance := public.apply_credit(
      p_user_id  => v_uid,
      p_delta    => v_reward,
      p_reason   => 'publish_reward',
      p_ref_type => 'app',
      p_ref_id   => p_app_id::text,
      p_memo     => '发布应用奖励'
    );
  else
    v_reward := 0;
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
  end if;

  insert into public.events (name, user_id, app_id, props)
  values ('publish', v_uid, p_app_id, jsonb_build_object('reward', v_reward));

  return jsonb_build_object('ok', true, 'appId', p_app_id, 'rewardCredits', v_reward,
                            'balance', coalesce(v_balance, 0), 'message', '发布成功');
end;
$$;

-- ---------------------------------------------------------------------------
-- unpublish_app / rename_app / delete_app / duplicate_app
-- ---------------------------------------------------------------------------

create or replace function public.unpublish_app(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.apps
     set status = 'draft', published_at = null
   where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能下架自己的应用');
  end if;
  return jsonb_build_object('ok', true, 'message', '已取消发布');
end;
$$;

create or replace function public.rename_app(p_app_id uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'message', '标题不能为空');
  end if;
  update public.apps
     set title = trim(p_title)
   where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能修改自己的应用');
  end if;
  return jsonb_build_object('ok', true, 'message', '已保存');
end;
$$;

create or replace function public.delete_app(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.apps where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能删除自己的应用');
  end if;
  return jsonb_build_object('ok', true, 'message', '已删除');
end;
$$;

create or replace function public.duplicate_app(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_src    public.apps%rowtype;
begin
  select * into v_src from public.apps where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能复制自己的应用');
  end if;

  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, prompt_enhanced, model, prompt_version,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url, status, parent_app_id
  ) values (
    v_src.author_id, v_src.title || ' 的副本', v_src.summary, v_src.app_type,
    v_src.subject, v_src.grade, v_src.textbook, v_src.duration, v_src.difficulty,
    v_src.prompt_raw, v_src.prompt_enhanced, v_src.model, v_src.prompt_version,
    v_src.html_url, v_src.html_status, v_src.html_size_bytes, v_src.html_sha256, v_src.html_version,
    'auto', gen_random_uuid()::text, null, 'draft', v_src.id
  ) returning id into v_new_id;

  update public.apps set remix_count = remix_count + 1 where id = p_app_id;

  return jsonb_build_object('ok', true, 'appId', v_new_id, 'message', '已复制');
end;
$$;

-- ---------------------------------------------------------------------------
-- toggle_like
-- ---------------------------------------------------------------------------
create or replace function public.toggle_like(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_liked boolean;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('liked', false, 'likeCount',
           coalesce((select like_count from public.apps where id = p_app_id), 0));
  end if;

  if exists (select 1 from public.app_likes where app_id = p_app_id and user_id = v_uid) then
    delete from public.app_likes where app_id = p_app_id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.app_likes (app_id, user_id) values (p_app_id, v_uid);
    v_liked := true;
  end if;

  select like_count into v_count from public.apps where id = p_app_id;
  return jsonb_build_object('liked', v_liked, 'likeCount', coalesce(v_count, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_app_view（service_role only；由 Edge Function 调用）
-- ---------------------------------------------------------------------------
create or replace function public.record_app_view(
  p_app_id      uuid,
  p_viewer_hash text,
  p_day         date default current_date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean := false;
begin
  insert into public.app_views (app_id, viewer_hash, view_date)
  values (p_app_id, p_viewer_hash, coalesce(p_day, current_date))
  on conflict (app_id, viewer_hash, view_date) do nothing;

  v_inserted := found;

  if v_inserted then
    update public.apps set view_count = view_count + 1 where id = p_app_id;
  end if;

  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- report_app（匿名可举报）
-- ---------------------------------------------------------------------------
create or replace function public.report_app(
  p_app_id        uuid,
  p_reason        text,
  p_detail        text default '',
  p_reporter_hash text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'message', '请选择举报原因');
  end if;
  insert into public.reports (app_id, reporter_id, reporter_hash, reason, detail)
  values (p_app_id, auth.uid(), coalesce(p_reporter_hash, ''), trim(p_reason), coalesce(p_detail, ''));
  return jsonb_build_object('ok', true, 'message', '举报已提交，我们会尽快处理');
end;
$$;

-- ---------------------------------------------------------------------------
-- list_square：服务端分页（每页 ≤24）/ 搜索 / 过滤 / 排序
-- ---------------------------------------------------------------------------
create or replace function public.list_square(
  p_type    text default null,
  p_subject text default null,
  p_grade   text default null,
  p_sort    text default 'latest',
  p_q       text default null,
  p_offset  integer default 0,
  p_limit   integer default 24
)
returns table (
  id                uuid,
  title             text,
  summary           text,
  app_type          public.app_type_enum,
  subject           text,
  grade             text,
  cover_kind        text,
  cover_seed        text,
  cover_url         text,
  status            public.app_status_enum,
  published_at      timestamptz,
  view_count        integer,
  like_count        integer,
  author_id         uuid,
  author_nickname   text,
  author_avatar_seed text,
  liked_by_me       boolean,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  v_uid   uuid := auth.uid();
begin
  return query
  with filtered as (
    select a.*
      from public.apps a
     where a.status = 'published'
       and (p_type    is null or p_type    = '' or a.app_type::text = p_type)
       and (p_subject is null or p_subject = '' or a.subject = p_subject)
       and (p_grade   is null or p_grade   = '' or a.grade   = p_grade)
       and (
         p_q is null or p_q = ''
         or a.title ilike '%' || p_q || '%'
         or a.summary ilike '%' || p_q || '%'
         or a.prompt_raw ilike '%' || p_q || '%'
       )
  )
  select
    f.id, f.title, f.summary, f.app_type, f.subject, f.grade,
    f.cover_kind, f.cover_seed, f.cover_url, f.status, f.published_at,
    f.view_count, f.like_count,
    f.author_id,
    p.nickname,
    p.avatar_seed,
    (v_uid is not null and exists (
      select 1 from public.app_likes l where l.app_id = f.id and l.user_id = v_uid
    )),
    (count(*) over())::bigint
  from filtered f
  left join public.profiles p on p.id = f.author_id
  order by
    case when p_sort = 'hottest' then f.view_count end desc nulls last,
    case when p_sort = 'liked'   then f.like_count end desc nulls last,
    f.published_at desc nulls last,
    f.created_at desc
  limit v_limit
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：批量生成兑换码（可指定面额 / 张数 / 类型 / 套餐 / 有效期）
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_codes(
  p_credits    integer default 0,
  p_count      integer default 10,
  p_batch_no   text default null,
  p_expires_at timestamptz default null,
  p_kind       text default 'credit',
  p_plan_id    text default null,
  p_valid_days integer default 0,
  p_prefix     text default '',
  p_memo       text default ''
)
returns table (code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_kind   public.redemption_kind_enum;
  v_batch  text;
  v_i      integer;
  v_code   text;
  v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_credits integer := greatest(coalesce(p_credits, 0), 0);
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可生成兑换码' using errcode = '42501';
  end if;

  v_kind  := coalesce(p_kind, 'credit')::public.redemption_kind_enum;
  v_batch := coalesce(nullif(trim(p_batch_no), ''), to_char(now(), 'YYYYMMDD-HH24MI'));

  for v_i in 1..greatest(least(coalesce(p_count, 10), 2000), 1) loop
    loop
      v_code := upper(coalesce(p_prefix, '')) || (
        select string_agg(substr(v_chars, 1 + (random() * (length(v_chars) - 1))::int, 1), '')
          from generate_series(1, 10)
      );
      exit when not exists (select 1 from public.redemption_codes r where r.code = v_code);
    end loop;

    insert into public.redemption_codes
      (code, kind, plan_id, credits, valid_days, batch_no, expires_at, created_by, memo)
    values
      (v_code, v_kind, p_plan_id, v_credits, greatest(coalesce(p_valid_days, 0), 0),
       v_batch, p_expires_at, v_uid, coalesce(p_memo, ''));

    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：查看兑换码（已用/未用）
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_codes(
  p_kind    text default null,
  p_status  text default null,
  p_batch_no text default null,
  p_offset  integer default 0,
  p_limit   integer default 100
)
returns table (
  code        text,
  kind        public.redemption_kind_enum,
  plan_id     text,
  credits     integer,
  valid_days  integer,
  batch_no    text,
  status      public.redemption_status_enum,
  used_by     uuid,
  used_by_name text,
  used_at     timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz,
  memo        text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看兑换码' using errcode = '42501';
  end if;

  return query
  select r.code, r.kind, r.plan_id, r.credits, r.valid_days, r.batch_no, r.status,
         r.used_by, u.nickname, r.used_at, r.expires_at, r.created_at, r.memo,
         (count(*) over())::bigint
    from public.redemption_codes r
    left join public.profiles u on u.id = r.used_by
   where (p_kind     is null or p_kind     = '' or r.kind::text   = p_kind)
     and (p_status   is null or p_status   = '' or r.status::text = p_status)
     and (p_batch_no is null or p_batch_no = '' or r.batch_no     = p_batch_no)
   order by r.created_at desc, r.code
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_disable_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可停用兑换码' using errcode = '42501';
  end if;
  update public.redemption_codes set status = 'disabled'
   where code = upper(trim(p_code)) and status = 'unused';
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能停用未使用的兑换码');
  end if;
  return jsonb_build_object('ok', true, 'message', '已停用');
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：手动给指定用户加减积分（留操作人与备注，便于对账）
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_delta   integer,
  p_memo    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可调整积分' using errcode = '42501';
  end if;
  if p_delta = 0 then
    return jsonb_build_object('ok', false, 'balance', 0, 'message', '调整数量不能为 0');
  end if;

  begin
    v_balance := public.apply_credit(
      p_user_id    => p_user_id,
      p_delta      => p_delta,
      p_reason     => 'admin_adjust',
      p_ref_type   => 'admin',
      p_ref_id     => v_uid::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
      p_memo       => coalesce(nullif(trim(p_memo), ''), '管理员手动调整'),
      p_operator_id => v_uid
    );
  exception when others then
    return jsonb_build_object('ok', false, 'balance', 0, 'message', '调整失败：余额不足');
  end;

  return jsonb_build_object('ok', true, 'balance', v_balance, 'message', '已调整');
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：用户列表（用于挑人加积分）
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_q      text default null,
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id          uuid,
  nickname    text,
  role        public.user_role_enum,
  balance     integer,
  plan_id     text,
  created_at  timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看用户' using errcode = '42501';
  end if;

  return query
  select p.id, p.nickname, p.role, coalesce(c.balance, 0), m.plan_id, p.created_at,
         (count(*) over())::bigint
    from public.profiles p
    left join public.credit_accounts c on c.user_id = p.id
    left join public.user_memberships m on m.user_id = p.id
   where (p_q is null or p_q = '' or p.nickname ilike '%' || p_q || '%')
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：套餐档位维护
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_plan(
  p_id           text,
  p_name         text,
  p_credits      integer,
  p_duration_days integer,
  p_price_cny    numeric,
  p_description  text default '',
  p_sort_order   integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护套餐' using errcode = '42501';
  end if;

  insert into public.membership_plans (id, name, credits, duration_days, price_cny, description, sort_order)
  values (p_id, p_name, greatest(coalesce(p_credits, 0), 0),
          greatest(coalesce(p_duration_days, 0), 0), coalesce(p_price_cny, 0),
          coalesce(p_description, ''), coalesce(p_sort_order, 0))
  on conflict (id) do update
    set name = excluded.name, credits = excluded.credits,
        duration_days = excluded.duration_days, price_cny = excluded.price_cny,
        description = excluded.description, sort_order = excluded.sort_order,
        updated_at = now();

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.admin_set_plan_enabled(p_id text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护套餐' using errcode = '42501';
  end if;
  update public.membership_plans set enabled = coalesce(p_enabled, true), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：模型配置维护（后台可配多家 Key / 模型 ID / 单价 / 路由）
-- 说明：API Key 不入库，只存在 Supabase Secrets。
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_model(
  p_id               text,
  p_provider         text,
  p_model_id         text,
  p_display_name     text,
  p_api_base         text default '',
  p_pricing          jsonb default '{}'::jsonb,
  p_max_output_tokens integer default 8000,
  p_credits_per_call integer default 1,
  p_is_default       boolean default false,
  p_enabled          boolean default true,
  p_sort_order       integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护模型配置' using errcode = '42501';
  end if;

  if coalesce(p_is_default, false) then
    update public.model_profiles set is_default = false where is_default;
  end if;

  insert into public.model_profiles
    (id, provider, model_id, display_name, api_base, pricing,
     max_output_tokens, credits_per_call, is_default, enabled, sort_order)
  values
    (p_id, p_provider, p_model_id, p_display_name, coalesce(p_api_base, ''), coalesce(p_pricing, '{}'::jsonb),
     coalesce(p_max_output_tokens, 8000), coalesce(p_credits_per_call, 1),
     coalesce(p_is_default, false), coalesce(p_enabled, true), coalesce(p_sort_order, 0))
  on conflict (id) do update
    set provider = excluded.provider, model_id = excluded.model_id,
        display_name = excluded.display_name, api_base = excluded.api_base,
        pricing = case when coalesce(p_pricing, '{}'::jsonb) = '{}'::jsonb
                       then public.model_profiles.pricing else excluded.pricing end,
        max_output_tokens = excluded.max_output_tokens,
        credits_per_call = excluded.credits_per_call,
        is_default = excluded.is_default,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_at = now();

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：应用类型积分与模型路由配置
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_app_type(
  p_app_type      text,
  p_label         text,
  p_credit_cost   integer,
  p_model_override text default null,
  p_enabled       boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护应用类型配置' using errcode = '42501';
  end if;

  update public.app_type_profiles
     set label = coalesce(nullif(trim(p_label), ''), label),
         credit_cost = greatest(coalesce(p_credit_cost, credit_cost), 0),
         model_override = p_model_override,
         enabled = coalesce(p_enabled, true)
   where app_type = p_app_type::public.app_type_enum;

  return jsonb_build_object('ok', true, 'appType', p_app_type);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：下架 / 恢复 / 举报处理 / 看板
-- ---------------------------------------------------------------------------

create or replace function public.admin_takedown(p_app_id uuid, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可下架应用' using errcode = '42501';
  end if;
  update public.apps
     set status = 'taken_down', summary = coalesce(nullif(trim(p_reason), ''), summary)
   where id = p_app_id;
  return jsonb_build_object('ok', true, 'message', '已下架');
end;
$$;

create or replace function public.admin_restore(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可恢复应用' using errcode = '42501';
  end if;
  update public.apps set status = 'draft' where id = p_app_id;
  return jsonb_build_object('ok', true, 'message', '已恢复为草稿');
end;
$$;

create or replace function public.admin_list_reports(
  p_status text default 'pending',
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id         bigint,
  app_id     uuid,
  app_title  text,
  reason     text,
  detail     text,
  status     public.report_status_enum,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看举报' using errcode = '42501';
  end if;

  return query
  select r.id, r.app_id, a.title, r.reason, r.detail, r.status, r.created_at,
         (count(*) over())::bigint
    from public.reports r
    left join public.apps a on a.id = r.app_id
   where (p_status is null or p_status = '' or r.status::text = p_status)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_handle_report(
  p_report_id bigint,
  p_action    text default 'handled'   -- handled | dismissed
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可处理举报' using errcode = '42501';
  end if;
  update public.reports
     set status = p_action::public.report_status_enum,
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_report_id;
  return jsonb_build_object('ok', true, 'message', '已处理');
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看统计' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users',     (select count(*) from public.profiles),
    'apps',      (select count(*) from public.apps),
    'published', (select count(*) from public.apps where status = 'published'),
    'gensToday', (
      select coalesce(sum(count), 0) from public.generation_daily
       where day = (now() at time zone 'Asia/Shanghai')::date
    ),
    'spendMonthCny', (
      select coalesce(sum(cost_cny), 0) from public.monthly_spend where period = v_period
    ),
    'topApps', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', a.id, 'title', a.title,
                 'viewCount', a.view_count, 'likeCount', a.like_count
               ) as x
          from public.apps a
         where a.status = 'published'
         order by a.view_count desc, a.like_count desc
         limit 10
      ) t
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_public_config：未登录也可调用的白名单配置
-- ---------------------------------------------------------------------------
create or replace function public.get_public_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_brand jsonb := '{}'::jsonb;
  v_auth  jsonb := '{}'::jsonb;
  v_credit jsonb := '{}'::jsonb;
  v_square jsonb := '{}'::jsonb;
  v_types jsonb := '[]'::jsonb;
begin
  select value into v_brand  from public.system_config where key = 'brand';
  select value into v_auth   from public.system_config where key = 'auth';
  select value into v_credit from public.system_config where key = 'credit';
  select value into v_square from public.system_config where key = 'square';

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', t.app_type,
           'label', t.label,
           'creditCost', t.credit_cost,
           'enabled', t.enabled,
           'sortOrder', t.sort_order
         ) order by t.sort_order), '[]'::jsonb)
    into v_types
    from public.app_type_profiles t
   where t.enabled;

  return jsonb_build_object(
    'brand',  coalesce(v_brand, '{}'::jsonb),
    'auth',   coalesce(v_auth, '{}'::jsonb),
    'credit', coalesce(v_credit, '{}'::jsonb),
    'square', coalesce(v_square, '{}'::jsonb),
    'appTypes', v_types
  );
end;
$$;


-- =================== 0010_rls_policies.sql ===================
-- =============================================================================
-- 0010_rls_policies.sql
-- 全表 ENABLE ROW LEVEL SECURITY（无一例外，ARCHITECTURE.md §8.7 红线）
--
-- 约定：
--   - 积分 / 兑换码相关写操作只允许经 SECURITY DEFINER RPC，不给任何写策略；
--   - 未登录（anon）只能看到 status='published' 的应用与公开配置；
--   - 作者信息经 public_authors 视图下发，只暴露 id / nickname / avatar_seed。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 开启 RLS
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.credit_accounts     enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.membership_plans    enable row level security;
alter table public.user_memberships    enable row level security;
alter table public.redemption_codes    enable row level security;
alter table public.apps                enable row level security;
alter table public.app_likes           enable row level security;
alter table public.app_views           enable row level security;
alter table public.reports             enable row level security;
alter table public.system_config       enable row level security;
alter table public.prompt_templates    enable row level security;
alter table public.model_profiles      enable row level security;
alter table public.app_type_profiles   enable row level security;
alter table public.generation_jobs     enable row level security;
alter table public.generation_daily    enable row level security;
alter table public.monthly_spend       enable row level security;
alter table public.events              enable row level security;

-- ---------------------------------------------------------------------------
-- profiles：本人可读写；作者昵称经视图下发
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select p.role from public.profiles p where p.id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- credit_accounts：本人可读；写入仅 RPC
-- ---------------------------------------------------------------------------
drop policy if exists credit_accounts_select_self on public.credit_accounts;
create policy credit_accounts_select_self on public.credit_accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- credit_transactions：本人可读；只增不改不删
-- ---------------------------------------------------------------------------
drop policy if exists credit_tx_select_self on public.credit_transactions;
create policy credit_tx_select_self on public.credit_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- membership_plans / user_memberships
-- ---------------------------------------------------------------------------
drop policy if exists membership_plans_select on public.membership_plans;
create policy membership_plans_select on public.membership_plans
  for select to anon, authenticated
  using (enabled);

drop policy if exists user_memberships_select_self on public.user_memberships;
create policy user_memberships_select_self on public.user_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- apps：anon 只看已发布；作者看自己的全部
-- ---------------------------------------------------------------------------
drop policy if exists apps_select_public on public.apps;
create policy apps_select_public on public.apps
  for select to anon
  using (status = 'published');

drop policy if exists apps_select_own_or_published on public.apps;
create policy apps_select_own_or_published on public.apps
  for select to authenticated
  using (status = 'published' or author_id = (select auth.uid()));

drop policy if exists apps_insert_own on public.apps;
create policy apps_insert_own on public.apps
  for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists apps_update_own on public.apps;
create policy apps_update_own on public.apps
  for update to authenticated
  using (author_id = (select auth.uid()) and status <> 'taken_down')
  with check (author_id = (select auth.uid()) and status <> 'taken_down');

drop policy if exists apps_delete_own on public.apps;
create policy apps_delete_own on public.apps
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- app_likes：全表可读；本人可增删
-- ---------------------------------------------------------------------------
drop policy if exists app_likes_select on public.app_likes;
create policy app_likes_select on public.app_likes
  for select to anon, authenticated
  using (true);

drop policy if exists app_likes_insert_self on public.app_likes;
create policy app_likes_insert_self on public.app_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists app_likes_delete_self on public.app_likes;
create policy app_likes_delete_self on public.app_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- app_views / reports
-- app_views 仅 service_role 写入（无客户端策略 = 全拒）
-- reports 允许匿名插入；客户端不可 SELECT（防泄露举报人）
-- ---------------------------------------------------------------------------
drop policy if exists reports_insert_any on public.reports;
create policy reports_insert_any on public.reports
  for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- system_config：仅经 get_public_config() 暴露白名单；管理员可改
-- ---------------------------------------------------------------------------
drop policy if exists system_config_admin_update on public.system_config;
create policy system_config_admin_update on public.system_config
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists system_config_admin_insert on public.system_config;
create policy system_config_admin_insert on public.system_config
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- prompt_templates：核心资产，仅管理员可读可改
-- ---------------------------------------------------------------------------
drop policy if exists prompt_templates_admin_select on public.prompt_templates;
create policy prompt_templates_admin_select on public.prompt_templates
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists prompt_templates_admin_write on public.prompt_templates;
create policy prompt_templates_admin_write on public.prompt_templates
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- model_profiles / app_type_profiles：enabled 的公开可读；写仅管理员
-- ---------------------------------------------------------------------------
drop policy if exists model_profiles_select_enabled on public.model_profiles;
create policy model_profiles_select_enabled on public.model_profiles
  for select to anon, authenticated
  using (enabled);

drop policy if exists model_profiles_admin_write on public.model_profiles;
create policy model_profiles_admin_write on public.model_profiles
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists app_type_profiles_select on public.app_type_profiles;
create policy app_type_profiles_select on public.app_type_profiles
  for select to anon, authenticated
  using (enabled);

-- ---------------------------------------------------------------------------
-- generation_jobs：本人可读（前端重连与状态查询）
-- ---------------------------------------------------------------------------
drop policy if exists gen_jobs_select_self on public.generation_jobs;
create policy gen_jobs_select_self on public.generation_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- generation_daily / monthly_spend / redemption_codes / app_views：无客户端策略（全拒）

-- ---------------------------------------------------------------------------
-- events：埋点只进不出
-- ---------------------------------------------------------------------------
drop policy if exists events_insert_any on public.events;
create policy events_insert_any on public.events
  for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- public_authors 视图：只暴露 id / nickname / avatar_seed
-- security_invoker=false → 以视图属主权限读取，绕过 profiles 的 RLS，
-- 从而让未登录访客也能看到作者署名（PRD P0-C6）。
-- ---------------------------------------------------------------------------
drop view if exists public.public_authors;
create view public.public_authors with (security_invoker = false) as
  select p.id, p.nickname, p.avatar_seed
    from public.profiles p
   where p.status = 'active';

grant select on public.public_authors to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 函数执行授权
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'get_public_config','estimate_cost','check_generation_allowed',
         'reserve_credits','settle_generation','refund_generation','redeem_code',
         'publish_app','unpublish_app','rename_app','delete_app','duplicate_app',
         'toggle_like','report_app','list_square','get_my_summary','track_event',
         'admin_create_codes','admin_list_codes','admin_disable_code',
         'admin_adjust_credits','admin_list_users','admin_upsert_plan',
         'admin_set_plan_enabled','admin_upsert_model','admin_upsert_app_type',
         'admin_takedown','admin_restore','admin_list_reports',
         'admin_handle_report','admin_stats'
       )
  loop
    execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role',
                   f.proname, f.args);
  end loop;
end $$;

-- record_app_view 仅允许 service_role（Edge Function 使用 service_role key 调用）
revoke all on function public.record_app_view(uuid, text, date) from public;
revoke all on function public.record_app_view(uuid, text, date) from anon, authenticated;
grant execute on function public.record_app_view(uuid, text, date) to service_role;


-- =================== 0011_seed_prompt_templates.sql ===================
-- =============================================================================
-- 0011_seed_prompt_templates.sql
-- 提示词工程种子（PRD 3.1 —— 决定产品成败的 P0 核心）
--
-- 组织方式（ARCHITECTURE.md §5.4）：
--   kind = system_section | app_type | user_enhance | repair
--   运行时按固定顺序拼装成一条 system 消息：
--     role → output_format → pedagogy → safety → code_quality → app_type:{type}
--   每次修改新增 version+1 并把 is_active 转移，旧版本保留（可归因失败率）。
--
-- ⚠️ 拼装结果必须逐字节稳定（命中上下文缓存）：禁止把时间戳/随机数/用户信息
--    放进 system 段，结构化字段一律进 user 消息。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 幂等 seed 助手：新增一行 version+1 并置为 active
-- ---------------------------------------------------------------------------
create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  -- 若已有同 key 的 active 版本，则在其基础上 +1 并把旧的置为 inactive
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- 一、system_section：角色设定
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:role', $pt$
# 角色

你是资深教育技术应用开发工程师 + 中小学学科教研专家，擅长把教师的教学想法实现为可直接在浏览器运行的单文件网页应用。

你同时具备三种能力：
1. 学科教研能力：准确把握课标要求、知识点梯度与该年级学生的认知水平；
2. 前端工程能力：用原生 HTML / CSS / JavaScript 写出健壮、无外部依赖的单文件应用；
3. 教学设计能力：把"学习目标—练习—反馈—激励"这条闭环设计进应用里。

你服务的对象是不懂代码的学科教师，他们只会用一句话描述需求。你要做的是：把这句口语化的需求，变成一节真正能上课用的数字化教学活动。
$pt$);

-- =============================================================================
-- 二、system_section：输出格式硬约束
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:output_format', $pt$
# 输出格式（硬约束，违反即判定失败）

1. 只输出 **一个** 完整的 HTML 文件。全部 CSS 写在 `<style>` 标签内，全部 JavaScript 写在 `<script>` 标签内，全部内联。
2. **绝对不引用任何外部资源**：不得使用 CDN 链接、外部字体、外部图片、外部音频、外部 CSS/JS 文件。原因：应用需要在离线、长期保存、校园网被限制的环境下依然可用。需要图形时用 CSS 绘制、SVG 内联或 emoji；需要音效时用 Web Audio API 合成。
3. 输出必须包裹在 ```html 代码块中，代码块外**不得有任何解释性文字**（不要说"好的""以下是…"，也不要在结尾追加说明）。
4. 必须包含以下三行，且顺序正确：
   - `<!DOCTYPE html>`
   - `<meta charset="utf-8">`
   - `<meta name="viewport" content="width=device-width, initial-scale=1">`
5. 单文件体积 **≤ 200KB**。若内容过多，请精简重复样式、合并数据结构、压缩题目文本，**不得截断输出**（截断 = 失败）。
6. 页面必须是"打开即可用"的完整成品，不得出现需要用户再填代码才能运行的部分。
$pt$);

-- =============================================================================
-- 三、system_section：教学性约束
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:pedagogy', $pt$
# 教学性要求（本产品与通用代码生成器的核心差异）

1. **明确的学习目标**：开场必须有一句话说明"这节课/这个练习要练什么"，让学生知道自己在学什么。
2. **即时反馈机制**：学生作答后必须立刻判定对错，并给出解析或讲解。**不能只判对错**——要说明为什么对、为什么错。
3. **进度与成就机制**：必须有进度条 / 得分 / 关卡 / 星级中的至少一种，让学生看到自己的进展。
4. **防挫败设计**：答错不清零、错题可重做、鼓励性文案（如"再想想，你离正确答案只差一步"）。**严禁**使用惩罚性、嘲讽性、制造焦虑的文案。
5. **贴合年级与学科**：语言、示例、难度必须匹配指定年级与学科。不得出现超纲内容、成人化表达或与该学段认知水平不符的抽象概念。
6. **课堂可用性**：界面文案全部简体中文；正文 ≥16px；按钮与可点击区域 ≥44×44px；颜色对比度足够；关键内容在手机竖屏与教室投屏两种场景下都清晰可读。
7. **收尾总结**：应用结束时应给出本次学习的总结（正确率、掌握情况、建议），帮助教师与学生回顾。
$pt$);

-- =============================================================================
-- 四、system_section：安全与合规
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:safety', $pt$
# 安全与合规（红线）

1. 不得生成政治敏感、暴力、血腥、色情、赌博、迷信、自伤等不适宜未成年人的内容。
2. **不得收集学生个人信息**：不得出现姓名、班级、学号、手机号、家庭住址、位置定位的采集项。如确实需要区分使用者，只能让用户输入"昵称"，并明确提示"请用昵称，不要填真实姓名"。
3. **不得发起任何外部网络请求**：不得使用 fetch / XMLHttpRequest / WebSocket / 外部图片地址 / 外部字体。所有数据必须内置在单文件里。
4. 不得使用 localStorage / sessionStorage / cookie 之外的持久化存储；如使用，只能保存本机进度，不得回传。
5. 内容不得出现商业广告、诱导分享、外部链接跳转。
6. 若教师的需求本身违反上述任一条，请在保持教学目标的前提下给出合规的替代方案，而不是直接拒绝。
$pt$);

-- =============================================================================
-- 五、system_section：代码质量
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:code_quality', $pt$
# 代码质量

1. 不使用 `eval`、不使用 `new Function`、不使用 `innerHTML` 拼接不可信输入。
2. 所有用户输入要做校验与长度限制，避免脚本注入与异常崩溃。
3. 单文件内不得出现未定义的变量引用、不得出现需要构建的语法（如裸 JSX、TypeScript 语法、`import` 语句）。
4. 用 `'use strict';` 包裹脚本，避免隐式全局。
5. DOM 查询做好空值保护；事件绑定使用 `addEventListener`，不使用内联 `onclick` 字符串。
6. 数据与视图分离：题目、关卡、文案等结构化数据用数组/对象集中声明，渲染逻辑统一处理，便于后续扩展。
7. 适配移动端：使用 `viewport` 与相对单位，避免固定宽高导致的横向滚动；触摸与鼠标事件都可用。
8. 代码组织清晰，关键函数加简短中文注释。
$pt$);

-- =============================================================================
-- 六、app_type：8 类子模板（PRD 3.1.2）
-- =============================================================================

select public.seed_prompt('app_type', 'app_type:teaching_animation', $pt$
# 类型：教学动画

用 CSS / JS 帧动画或内联 SVG 动画演示一个知识点的形成或变化过程。

必须包含：
- **旁白文字区**：与动画同步的解说文字，说明"现在发生了什么"；
- **播放控制**：播放 / 暂停 / 重播 / 进度拖动（或分步"上一步/下一步"）；
- **速度控制**（可选）：至少提供常速与慢速；
- 动画结束后给出一句知识点总结，并配 2–3 道随堂小测（即时判分 + 解析）。

动画要求：过程要"看得清"，关键变化处要有高亮、标注或短暂停顿；不要用学生看不懂的抽象运动代替知识点本身。
$pt$);

select public.seed_prompt('app_type', 'app_type:edu_tool', $pt$
# 类型：教育应用（工具类）

生成一个解决某个具体教学场景痛点的小工具（如口算练习器、单词卡、课堂计时器、随机点名、单位换算、古诗填空等）。

必须包含：
- **参数可调**：题型 / 题量 / 难度 / 范围等至少 2 个可调参数，用下拉或按钮组选择，不要让教师改代码；
- **即时反馈**：操作后立即给出结果与错误提示；
- **统计信息**：本次正确率、用时、题数等至少一项统计；
- **重置与再来一次**按钮。

界面要极简，主功能一眼可见，一步即可开始使用。
$pt$);

select public.seed_prompt('app_type', 'app_type:teaching_game', $pt$
# 类型：教学游戏

把一个知识点包装成有明确游戏机制的闯关游戏。

必须包含：
- **明确的游戏机制**：从闯关 / 积分 / 排行榜 / 限时 / 收集 / 对战中至少选择一种，并在开场一句话说明规则；
- **关卡数据至少 5 关**，难度递增，每关至少 3 道题或 1 个挑战；
- **结束页总结**：总得分、正确率、星级评价、鼓励性评语，以及"再来一次"按钮；
- 答错不清零、可重做，失败文案必须鼓励而非惩罚。

视觉上要有"游戏感"（色彩、动效、音效反馈可用 Web Audio 合成），但不能喧宾夺主影响题目阅读。
$pt$);

select public.seed_prompt('app_type', 'app_type:interactive_courseware', $pt$
# 类型：互动课件

生成一节可自主学习的互动课件。

必须包含：
- **分段式讲解**：把内容拆成 4–8 个知识小节，每节一段讲解 + 一个示例；
- **每节后的小检测**：1–2 道题，即时判分并给解析；
- **可跳转目录**：顶部或侧边提供小节目录，可任意跳转，并显示已完成进度；
- 最后一节给出本节课的知识结构小结。

讲解语言要口语化、面向学生，避免大段文字；多用类比、图示（CSS/SVG 绘制）与高亮。
$pt$);

select public.seed_prompt('app_type', 'app_type:data_collection', $pt$
# 类型：数据回收（表单 / 问卷）

生成一份课堂用的表单或问卷（如学情调查、课堂反馈、投票、报名登记）。

必须包含：
- 5–10 个题目，题型覆盖单选、多选、量表（1–5 分）、简答中的至少三种；
- **必填校验**与友好的错误提示；
- 提交后在本机展示"已提交"结果页，并给出本次填写的内容摘要；
- 顶部醒目提示："本表单仅在你的设备上保存结果，不会上传，请不要填写真实姓名等个人信息"。

⚠️ 严禁任何网络提交行为（不得用 form action 指向外部地址，不得用 fetch）。
$pt$);

select public.seed_prompt('app_type', 'app_type:ai_item_generation', $pt$
# 类型：AI命题

生成一套高质量的题目（默认 10 题，如教师指定题量则按指定数量）。

必须包含：
- 题干表述严谨、无歧义，选项（若有）干扰项合理；
- **答案与解析折叠展示**：默认折叠，点击展开；解析要说明解题思路与易错点；
- 题型可与题量可切换（如"只看选择题"），并提供"显示/隐藏答案"总开关；
- **一键打印样式**：提供 `@media print` 样式，A4 打印友好（隐藏按钮、合理分页、黑白可读）。

题目前标注难度与考查知识点，便于教师挑选。
$pt$);

select public.seed_prompt('app_type', 'app_type:ai_paper_composition', $pt$
# 类型：AI组题（组卷）

按知识点、难度、题型组一份完整试卷。

必须包含：
- **试卷头**：标题、学科、年级、考试时长、满分、姓名/班级/得分填写栏；
- **分板块**：至少 3 个板块（如：基础积累 / 阅读理解 / 综合运用），每板块注明分值说明；
- 题型覆盖选择、填空、简答、计算（按学科取舍），难度梯度合理；
- **A4 打印友好 CSS**：`@media print` 下隐藏所有交互元素、设置合适页边距、避免题目被分页截断（`page-break-inside: avoid`）；
- 提供"显示答案与解析"开关（默认隐藏），答案附在卷末。

题量与分值总和应与卷头标称一致。
$pt$);

select public.seed_prompt('app_type', 'app_type:ai_lesson_plan', $pt$
# 类型：AI教案·大单元

生成一份结构完整、可直接打印使用的教案（或大单元教学设计）。

必须包含以下板块：
1. 教学基本信息（学科 / 年级 / 课时 / 教材版本）
2. 教学目标（知识与技能 / 过程与方法 / 情感态度价值观，分条表述）
3. 教学重难点
4. 教学准备
5. 教学过程（分环节，每环节含"教师活动 / 学生活动 / 设计意图 / 时间分配"）
6. 板书设计（用等宽字体或方框示意图呈现）
7. 作业设计（分层：基础 / 拓展）
8. 教学反思（预留可填写区域）

排版要求：层级清晰、标题加粗、表格规整；提供 `@media print` 打印样式（A4，隐藏交互元素）。

若是"大单元"设计，需额外给出单元整体架构表（课时安排与每课时目标）。
$pt$);

-- =============================================================================
-- 七、user_enhance：结构化字段拼装模板（进 user 消息，不进 system）
-- =============================================================================
select public.seed_prompt('user_enhance', 'user_enhance:fields', $pt$
请按下面的教学背景生成应用（教师已填写的字段为准；标注"未填写"的请你自行推断一个合理默认值，并在应用开场用一行小字说明"我按 XX 年级/XX 难度理解的，不对可以让老师改"）。

- 学科：{subject}
- 年级：{grade}
- 教材版本：{textbook}
- 课堂时长：{duration}
- 难度：{difficulty}

教师原始需求：
{prompt}
$pt$);

-- =============================================================================
-- 八、repair：自修复模板（第二轮 user 消息，仅重试 1 次）
-- =============================================================================
select public.seed_prompt('repair', 'repair:retry', $pt$
你上一次的输出没有通过自动校验，具体问题如下：

{errors}

请针对上述问题逐条修正，然后重新输出**完整**的单文件 HTML。
注意：不要只输出修改片段，不要省略任何部分，仍然只输出一个 ```html 代码块，代码块外不要有任何文字。
$pt$);

-- =============================================================================
-- 九、标题与摘要抽取模板（供 generate 生成应用标题/简介用）
-- =============================================================================
select public.seed_prompt('repair', 'meta:extract', $pt$
请为下面这个教学应用生成一段 JSON 元数据，只输出 JSON，不要任何解释：

{
  "title": "不超过 20 个汉字的中文标题，要具体、有吸引力，适合展示在应用广场",
  "summary": "不超过 60 个汉字的中文简介，说明这个应用是做什么的、适合谁用"
}

教学应用需求：{prompt}
$pt$);

drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0012_category_and_docs.sql ===================
-- =============================================================================
-- 0012_category_and_docs.sql
-- T06 文档与课件生成：apps 表加 category 维度 + 文档类字段；app_type_profiles 扩 5 类文档
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. apps 表扩展文档维度
--    category 默认 'app'（沿用既有应用单文件 HTML 形态）；'doc' 表示结构化文档
--    doc_json_url 一律存 Storage（不进 DB 字段，守 500MB 红线，ARCHITECTURE §C.8 阻塞① 选 B）
-- ---------------------------------------------------------------------------
alter table public.apps
  add column if not exists category        text not null default 'app',
  add column if not exists doc_type        text,
  add column if not exists doc_json_url    text,
  add column if not exists doc_version     integer not null default 1,
  add column if not exists verify_status   text not null default 'pending',
  add column if not exists textbook_version_id uuid;

-- category 取值约束
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_category_chk'
  ) then
    alter table public.apps
      add constraint apps_category_chk
      check (category in ('app', 'doc'));
  end if;
end $$;

-- verify_status 取值约束
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_verify_status_chk'
  ) then
    alter table public.apps
      add constraint apps_verify_status_chk
      check (verify_status in ('pending', 'verified', 'partial'));
  end if;
end $$;

-- doc_type 取值约束
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_doc_type_chk'
  ) then
    alter table public.apps
      add constraint apps_doc_type_chk
      check (
        doc_type is null
        or doc_type in (
          'lesson_plan', 'ppt', 'courseware_2d', 'courseware_3d', 'office_doc'
        )
      );
  end if;
end $$;

-- textbook_version_id 外键（T07 建表后由 0013 建立；这里仅建索引）
create index if not exists apps_category_doc_type_idx
  on public.apps (category, doc_type, published_at desc);
create index if not exists apps_textbook_version_idx
  on public.apps (textbook_version_id);

-- ---------------------------------------------------------------------------
-- 2. 扩展 app_type_enum（app_type_profiles 的 PK 是 public.app_type_enum）
--    5 个文档类必须先成为合法枚举值，才能写进 app_type_profiles。
--    枚举在 0001 已创建（跨事务），此处 ADD VALUE 在 PG12+ 事务内可用。
-- ---------------------------------------------------------------------------
alter type public.app_type_enum add value if not exists 'lesson_plan';
alter type public.app_type_enum add value if not exists 'ppt';
alter type public.app_type_enum add value if not exists 'courseware_2d';
alter type public.app_type_enum add value if not exists 'courseware_3d';
alter type public.app_type_enum add value if not exists 'office_doc';

-- ---------------------------------------------------------------------------
-- 3. app_type_profiles 扩 5 个文档类（积分：教案1 / PPT2 / 课件(2D)2 / 课件(3D)3 / 办公文档1）
--    提示词 key 约定：doc_type:<kind>
-- ---------------------------------------------------------------------------
insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  ('lesson_plan',     '教案',         1, 'doc_type:lesson_plan',     20),
  ('ppt',             'PPT 课件',     2, 'doc_type:ppt',             21),
  ('courseware_2d',   '课件（2D）',   2, 'doc_type:courseware_2d',   22),
  ('courseware_3d',   '课件（3D）',   3, 'doc_type:courseware_3d',   23),
  ('office_doc',      '办公文档',     1, 'doc_type:office_doc',      24)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. 视图字段对齐（public_authors 已存在，无需改动；apps 视图若需筛选文档类在此留口）
-- ---------------------------------------------------------------------------
comment on column public.apps.category is '产物大类：app=单文件HTML应用(沙箱)；doc=结构化文档(平台渲染壳)';
comment on column public.apps.doc_json_url is '结构化 DocModel 的 Storage 路径（不进 DB 正文，守 500MB 红线）';
comment on column public.apps.doc_version is '文档版本号，保存即新版本 v{n+1}';
comment on column public.apps.verify_status is 'AI 生成内容核对状态：pending/partial/verified';


-- =================== 0013_textbook_versions.sql ===================
-- =============================================================================
-- 0013_textbook_versions.sql
-- T07 教材版本机制：textbook_versions 表
--   级联 5 维（年级 grade / 学科 subject / 出版社 publisher / 版本 version / 年份 year）
--   + 章节 chapter + 电子版 upload_url + 状态 status
--   并补 apps.textbook_version_id 外键（0012 仅建了索引，外键在此建立）
-- =============================================================================

create table if not exists public.textbook_versions (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  year       text not null default '2024',
  version    text not null default '通用版',
  publisher  text not null default '通用',
  subject    text not null default '通用',
  grade      text not null default '通用',
  chapter    text,
  upload_url text,
  status     text not null default 'draft'
               check (status in ('draft', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 级联筛选索引（生成页按 年级/学科/出版社/版本/年份 过滤教材版本）
create index if not exists textbook_versions_cascade_idx
  on public.textbook_versions (grade, subject, publisher, version, year);
create index if not exists textbook_versions_owner_idx
  on public.textbook_versions (owner_id);

-- apps.textbook_version_id 外键（版本删除时置空，不级联删应用）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_textbook_version_fk'
  ) then
    alter table public.apps
      add constraint apps_textbook_version_fk
      foreign key (textbook_version_id)
      references public.textbook_versions (id)
      on delete set null;
  end if;
end $$;

comment on table public.textbook_versions is
  '教师维护的教材版本（级联维度：年级/学科/出版社/版本/年份 + 章节），生成时作为教材上下文来源';


-- =================== 0014_textbook_knowledge.sql ===================
-- =============================================================================
-- 0014_textbook_knowledge.sql
-- T07：textbook_knowledge 表
--   同版本可复用的知识点沉淀；命中缓存则跳过联网检索省成本。
--   status='verified' 后全教师可读（含 anon）；pending 仅版本 owner 可读。
-- =============================================================================

create table if not exists public.textbook_knowledge (
  id                  uuid primary key default gen_random_uuid(),
  textbook_version_id  uuid not null references public.textbook_versions (id) on delete cascade,
  section             text not null,
  content             text not null,
  status              text not null default 'pending'
                        check (status in ('pending', 'verified')),
  verified_by         uuid references auth.users (id) on delete set null,
  source              text not null default 'ai'
                        check (source in ('ai', 'teacher', 'upload')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 按版本 + 状态查询（命中缓存判断 / 公开知识下发）
create index if not exists textbook_knowledge_version_idx
  on public.textbook_knowledge (textbook_version_id, status);

comment on table public.textbook_knowledge is
  '教材版本沉淀的知识点；verified 后全教师可读（含 anon），作为生成时的教材上下文缓存';


-- =================== 0015_rls_docs_textbook.sql ===================
-- =============================================================================
-- 0015_rls_docs_textbook.sql
-- T07 RLS（ARCHITECTURE.md §C.5 T07 验收点）：
--   - textbook_versions：版本仅 owner 可增改删；登录教师可读全部（便于选教材）
--   - textbook_knowledge：status='verified' 全教师可读（含 anon）；
--                        pending 仅版本 owner 可读；
--                        未登录(anon) 不可写任何行
-- =============================================================================

alter table public.textbook_versions   enable row level security;
alter table public.textbook_knowledge enable row level security;

-- ---------------------------------------------------------------------------
-- textbook_versions：读全部登录用户；写仅 owner
-- ---------------------------------------------------------------------------
drop policy if exists textbook_versions_select on public.textbook_versions;
create policy textbook_versions_select on public.textbook_versions
  for select to authenticated
  using (true);

drop policy if exists textbook_versions_insert on public.textbook_versions;
create policy textbook_versions_insert on public.textbook_versions
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists textbook_versions_owner on public.textbook_versions;
create policy textbook_versions_owner on public.textbook_versions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- textbook_knowledge
--   verified：全教师（含 anon）可读
--   pending：仅版本 owner 可读
--   写：仅版本 owner（已登录）；anon 不可写
-- ---------------------------------------------------------------------------
drop policy if exists textbook_knowledge_select_verified on public.textbook_knowledge;
create policy textbook_knowledge_select_verified on public.textbook_knowledge
  for select to anon, authenticated
  using (status = 'verified');

drop policy if exists textbook_knowledge_select_own on public.textbook_knowledge;
create policy textbook_knowledge_select_own on public.textbook_knowledge
  for select to authenticated
  using (
    verified_by = (select auth.uid())
    or exists (
      select 1 from public.textbook_versions tv
       where tv.id = textbook_version_id
         and tv.owner_id = (select auth.uid())
    )
  );

drop policy if exists textbook_knowledge_write_owner on public.textbook_knowledge;
create policy textbook_knowledge_write_owner on public.textbook_knowledge
  for all to authenticated
  using (
    exists (
      select 1 from public.textbook_versions tv
       where tv.id = textbook_version_id
         and tv.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.textbook_versions tv
       where tv.id = textbook_version_id
         and tv.owner_id = (select auth.uid())
    )
  );


-- =================== 0016_seed_doc_prompts.sql ===================
-- =============================================================================
-- 0016_seed_doc_prompts.sql
-- T06 文档与课件生成：文档类（教案 / PPT / 课件2D / 课件3D / 办公文档）提示词种子
--   + 教材感知 system_section（T07 教材检索回填用）
--
-- 与 0011 同款幂等助手 public.seed_prompt，运行时被 generate 拼进 system 消息：
--   role → output_format → pedagogy → safety → code_quality
--        → textbook_aware（本文件新增） → doc_type:<kind>（本文件新增）
--
-- ⚠️ 文档类产物走「结构化 DocModel JSON」而非单文件 HTML（见 src/types/doc.ts），
--    因此 app_type:<kind> 的提示词与 0011 的 app_type 段不同：本文件要求输出 DocModel。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 幂等 seed 助手（与 0011 同实现；0011 末尾已 drop，这里 recreate 以便本文件独立可重跑）
-- ---------------------------------------------------------------------------
create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- 一、system_section：教材感知（T07 教材检索结果回填后生效；本批仅 seed 节，逻辑 T07）
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:textbook_aware', $pt$
# 教材感知（让 AI 生成内容贴合教师所选教材版本与章节）

如果教师在请求中提供了「教材版本 / 年级 / 学科 / 章节」信息（由后台教材检索模块回填，
会出现在 user 消息的 {textbook_context} 占位符），你必须：

1. **锚定教材顺序**：知识点的先后、名称、例题口径严格对齐该教材对应章节，不得凭空编造
   课时编号或“第几单元”。
2. **难度贴合学段**：题目与讲解的难度、语言、生活情境必须符合该年级课标与认知水平。
3. **标注不确定点**：凡是教材版本信息缺失、或你对该版本某个细节（如具体页码、例题数据）
   无把握时，在 DocModel 的 `verifyHints` 数组里写明“建议教师核对：XX”，由教师人工确认。
4. **不越界**：不要因为缺失教材信息就拒绝生成——按通用教学逻辑给出合理默认，并在
   `verifyHints` 提示教师按需替换为实际教材内容。

教材信息由可信后台提供，不要质疑其真实性，直接使用即可。
$pt$);

-- =============================================================================
-- 二、doc_type：5 类文档子模板（输出目标均为 DocModel JSON，见 src/types/doc.ts）
--    通用 DocModel 结构（务必严格遵守字段，缺失字段用空或合理默认值）：
--    {
--      "id": "<产物id，后台注入>",
--      "kind": "<lesson_plan|ppt|courseware_2d|courseware_3d|office_doc>",
--      "meta": { "title","subject?","grade?","textbook?","author?","duration?","difficulty?" },
--      "blocks": [ { "id","type","level?","text?","ordered?","items?","rows?","header?","src?","caption?","align?" } ],
--      "slides": [ { "index","title","body":[DocBlock],"notes?","layout?" } ],   -- 仅 ppt
--      "scene":  { "type","params","explodable","annotations":[],"title?" },     -- 仅 courseware_3d
--      "verifyHints": [ "建议教师核对：..." ],
--      "version": 1,
--      "createdAt": "<ISO 时间，后台注入>"
--    }
--    输出约束：只输出一个 ```json 代码块，块外不得有任何文字；不得截断；不得含外部资源引用。
-- =============================================================================

select public.seed_prompt('doc_type', 'doc_type:lesson_plan', $pt$
# 文档类型：教案（lesson_plan）

输出一份结构完整、可直接打印使用的教案，必须包含以下板块，用 `blocks` 富文本块表达：

1. 教学基本信息（学科 / 年级 / 课时 / 教材版本）——heading + paragraph
2. 教学目标——heading + list（分 知识与技能 / 过程与方法 / 情感态度价值观）
3. 教学重难点——heading + list
4. 教学准备——heading + list（含教具、课件、学具）
5. 教学过程——heading + 多个子 heading（环节名），每环节用 list 或 paragraph 给出
   「教师活动 / 学生活动 / 设计意图 / 时间分配」四要素
6. 板书设计——heading + paragraph（用方框示意或等宽描述）
7. 作业设计——heading + list（分层：基础 / 拓展）
8. 教学反思——heading + paragraph（预留可填写区域，可写“（待课后填写）”）

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整；如涉及评分表等
结构化数据，可用 type=table 的 block 表达。凡 AI 推断的课时数、例题数据等不确定点，写入
`verifyHints`。
$pt$);

select public.seed_prompt('doc_type', 'doc_type:ppt', $pt$
# 文档类型：PPT 课件（ppt）

输出一份幻灯片课件，用 `slides` 数组表达，每页 slide 含 `title` 与 `body`（DocBlock 列表）与
可选 `notes`（演讲者备注）与 `layout`（title|content|two_col|section）。

要求：
- 页数 ≥ 8 页，逻辑顺序：封面 → 目标 → 新知导入 → 2~4 个知识页 → 例题/活动 → 小结 → 作业；
- 每页 `body` 用 heading / list / paragraph / image 等块，避免大段纯文字；
- `notes` 给教师一句“怎么讲”：开场白、易错提醒、互动提问；
- 关键概念、公式、对比可用 table 或 callout 块突出；
- 若需要配图，image 块的 `src` 留空并 `caption` 注明“建议配图：XX”，由教师后续上传；
- 不确定处（如例题数据）写入 `verifyHints`。
$pt$);

select public.seed_prompt('doc_type', 'doc_type:courseware_2d', $pt$
# 文档类型：课件（2D / 伪 3D）（courseware_2d）

输出一节以图文为主的互动式 2D 课件，用 `blocks` 富文本表达，强调“边看边学”的版式：

- 开场用 heading 说明本节目标；
- 每个知识点用 paragraph + image（caption 注明“建议配图/动画：XX”，src 留空）+ callout（提示/易错）组织；
- 关键对比、步骤、数据用 table 块；
- 每 2~3 个知识点插入一个 list 形式的“想一想/做一做”小活动；
- 结尾 heading“本节课小结”+ paragraph 总结；
- 需要动图/可交互演示的，用 callout 注明“建议在此插入 2D 动图/演示：XX”；
- 不确定处写入 `verifyHints`。

（2D 课件的可视化在 T08 由富文本编辑器 + 静态图形渲染；本批只需结构化 blocks。）
$pt$);

select public.seed_prompt('doc_type', 'doc_type:courseware_3d', $pt$
# 文档类型：课件（3D 真 Three.js）（courseware_3d）

输出一节含可旋转/可拆解 3D 模型的课件，除 `blocks` 富文本讲解外，必须提供 `scene`
（SceneDescriptor）结构化描述，供平台 ThreeViewer 渲染：

- `scene.type` 从 geometry|function|molecule|globe|circuit|biology|physics|custom 选一；
- `scene.params` 按 type 约定给出结构化参数（如 geometry 的 形状/尺寸、molecule 的分子式与
  原子坐标、function 的 表达式与区间）；
- `scene.explodable`：是否支持点击拆解观察内部（如细胞器、电路元件），默认尽量 true；
- `scene.annotations`：部件/知识点标注文字列表（显示在模型旁）；
- `scene.title`：场景标题。
- `blocks` 仍提供文字讲解（目标/知识点/操作步骤/小结），与 3D 模型呼应；
- 凡 3D 参数（如精确坐标、比例）由 AI 推断的，写入 `verifyHints`。

（真实 three.js 在前端懒加载渲染，本批只需给出可被解析的 scene 结构。）
$pt$);

select public.seed_prompt('doc_type', 'doc_type:office_doc', $pt$
# 文档类型：办公文档（office_doc）

输出一份教师日常办公文档（如：通知、计划、总结、发言稿、家长会文案、活动方案、阅卷说明等），
用 `blocks` 富文本表达，结构清晰、用语正式得体：

- 文档标题用 heading(level=1)；
- 正文分段用 paragraph；
- 要点、步骤、名单用 list（有序/无序按内容）；
- 涉及排期、分工、名单等可用 table；
- 如引用文件/模板，callout 注明“依据：XX 文件”；
- 落款、日期等用 paragraph 或 caption；
- 缺失的具体信息（如学校名、日期、人名）用占位并写入 `verifyHints`，不要编造真实机构名。

排版要求：层级分明、便于直接复制进 Word/WPS 使用。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾：与 0011 保持一致，删除幂等助手（后续若有 T08 文档导出模板可再次 recreate）
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0017_doc_library.sql ===================
-- =============================================================================
-- 0017_doc_library.sql
-- T06 收尾：内容沉淀库 doc_library（「生成即沉淀」，为后续 Skill 提炼降本做准备）
--
-- 业务动机（BRD BR-014/015）：
--   教师每次生成教案 / PPT / 课件都直接落一条沉淀记录。同类内容累积到阈值（≥100 条）后，
--   可离线提炼为 Skill —— 新请求命中 Skill 时走「套骨架 + 局部填空」而非全量生成，
--   按 40% 命中率估算 token 成本可降约 30%。
--
-- 设计约束：
--   - 本表只存**元数据索引**（关键词 / 学科 / 年级 / 教材版本），不存文档正文；
--     正文仍是 Storage 里的 doc_json（守 Postgres 500MB 红线，ARCHITECTURE §C.8）。
--   - doc_id 指向 public.apps(id)（文档类产物复用 apps 行，category='doc'）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 表结构
-- ---------------------------------------------------------------------------
create table if not exists public.doc_library (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  doc_id              uuid not null references public.apps (id) on delete cascade,

  category            text not null default 'doc',
  doc_type            text,
  subject             text not null default '',
  grade               text not null default '',
  textbook_version_id uuid,                       -- T07 教材版本表建好后可加外键；此处仅存 id
  keywords            text[] not null default '{}',

  is_public           boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint doc_library_category_chk
    check (category in ('app', 'doc')),
  constraint doc_library_doc_type_chk
    check (
      doc_type is null
      or doc_type in ('lesson_plan', 'ppt', 'courseware_2d', 'courseware_3d', 'office_doc')
    )
);

-- 唯一约束：一个产物只沉淀一条记录（重复生成不会灌水）
create unique index if not exists doc_library_doc_id_key
  on public.doc_library (doc_id);

-- 检索索引：按「学科 + 年级 + 文档类型」聚合同类内容，供 Skill 提炼扫描
create index if not exists doc_library_skill_idx
  on public.doc_library (doc_type, subject, grade);
create index if not exists doc_library_owner_idx
  on public.doc_library (owner_id, created_at desc);
create index if not exists doc_library_public_idx
  on public.doc_library (is_public) where is_public;
create index if not exists doc_library_textbook_idx
  on public.doc_library (textbook_version_id);
-- 关键词数组检索（GIN）
create index if not exists doc_library_keywords_idx
  on public.doc_library using gin (keywords);

comment on table  public.doc_library is '内容沉淀库：文档/课件生成的元数据索引，供 Skill 提炼与复用降本（BR-014/015）';
comment on column public.doc_library.doc_id is '指向 public.apps(id)，文档类产物 category=''doc''';
comment on column public.doc_library.keywords is '关键词数组，用于同类内容聚合与 Skill 命中判定';
comment on column public.doc_library.is_public is 'true 时对全体登录教师可读（用于跨校共享样例）';

-- ---------------------------------------------------------------------------
-- 2. updated_at 自动维护（沿用 0001 的 public.touch_updated_at()）
-- ---------------------------------------------------------------------------
drop trigger if exists trg_doc_library_touch on public.doc_library;
create trigger trg_doc_library_touch
  before update on public.doc_library
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS（红线：全表开启，无一例外）
--    读：本人全部可读；is_public=true 的记录全体登录教师可读
--    写：仅本人可增删改（写入实际由 Edge Function 以 service_role 完成，走 SECURITY DEFINER 语境）
-- ---------------------------------------------------------------------------
alter table public.doc_library enable row level security;

drop policy if exists doc_library_select_owner on public.doc_library;
create policy doc_library_select_owner on public.doc_library
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists doc_library_select_public on public.doc_library;
create policy doc_library_select_public on public.doc_library
  for select to authenticated
  using (is_public);

drop policy if exists doc_library_insert_owner on public.doc_library;
create policy doc_library_insert_owner on public.doc_library
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists doc_library_update_owner on public.doc_library;
create policy doc_library_update_owner on public.doc_library
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists doc_library_delete_owner on public.doc_library;
create policy doc_library_delete_owner on public.doc_library
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. 幂等沉淀函数：由 generate 的 doc 分支在成功后调用（service_role 绕过 RLS）
--    on conflict (doc_id) do nothing —— 重跑不灌水。
-- ---------------------------------------------------------------------------
create or replace function public.deposit_doc_library(
  p_doc_id              uuid,
  p_owner_id            uuid,
  p_category            text default 'doc',
  p_doc_type            text default null,
  p_subject             text default '',
  p_grade               text default '',
  p_textbook_version_id uuid default null,
  p_keywords            text[] default '{}',
  p_is_public           boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.doc_library (
    owner_id, doc_id, category, doc_type, subject, grade,
    textbook_version_id, keywords, is_public
  ) values (
    p_owner_id, p_doc_id, p_category, p_doc_type,
    coalesce(p_subject, ''), coalesce(p_grade, ''),
    p_textbook_version_id, coalesce(p_keywords, '{}'::text[]), coalesce(p_is_public, false)
  )
  on conflict (doc_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.deposit_doc_library(
  uuid, uuid, text, text, text, text, uuid, text[], boolean
) from public;
grant execute on function public.deposit_doc_library(
  uuid, uuid, text, text, text, text, uuid, text[], boolean
) to service_role;


-- =================== 0018_doc_storage_rls.sql ===================
-- =============================================================================
-- 0018_doc_storage_rls.sql
-- T08 上线前置：文档产物 Storage 桶 + 仅作者可写策略
--
-- 设计（对应野马诉求「仅作者可改，且作者本人永远能恢复」）：
--   - `docs` 桶：公开读（文档本就是要分享给老师看的，与网页一致）；
--   - 写（增/改/删）：仅该文档作者可操作，陌生人无法篡改、也无法删；
--   - 作者本人随时可再编辑 / 保存新版本 = 自带恢复能力。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 建 docs 桶（公开读）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('docs', 'docs', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- 2. 辅助函数：从对象路径解析 appId 并查作者
--    SECURITY DEFINER 绕过 RLS，供 Storage 策略判断「这个对象归谁」
--    路径格式：d/{yyyy}/{mm}/{appId}/v{n}.json
-- ---------------------------------------------------------------------------
create or replace function public.doc_object_owner(object_name text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select a.author_id
    from public.apps a
   where a.id = (
     (regexp_match(object_name, '^d/\d{4}/\d{2}/([0-9a-fA-F-]{36})/'))[1]
   )::uuid
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Storage 对象策略
-- ---------------------------------------------------------------------------
drop policy if exists docs_select_public on storage.objects;
create policy docs_select_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'docs');

drop policy if exists docs_insert_author on storage.objects;
create policy docs_insert_author on storage.objects
  for insert to authenticated
  with check (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()));

drop policy if exists docs_update_author on storage.objects;
create policy docs_update_author on storage.objects
  for update to authenticated
  using (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()))
  with check (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()));

drop policy if exists docs_delete_author on storage.objects;
create policy docs_delete_author on storage.objects
  for delete to authenticated
  using (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()));


-- =================== 0019_doc_credit_cost.sql ===================
-- =============================================================================
-- 0019_doc_credit_cost.sql
-- 客户要求「一个文档 2～3 积分」：上调文档类积分成本（配置表，幂等可重跑）
--
-- 新值（沿用 0012 的 5 个文档类）：
--   lesson_plan    教案        = 2
--   office_doc     办公文档     = 2
--   ppt           PPT 课件     = 3
--   courseware_2d 课件（2D）   = 3
--   courseware_3d 课件（3D）   = 4   （3D 最烧 token，最高）
--
-- ⚠️ 红线：积分数值只能走配置表（app_type_profiles.credit_cost），
--    前端代码不得写死任何积分数值。这里只改配置，不改逻辑。
-- =============================================================================

insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  ('lesson_plan',     '教案',         2, 'doc_type:lesson_plan',     20),
  ('office_doc',      '办公文档',     2, 'doc_type:office_doc',      24),
  ('ppt',             'PPT 课件',     3, 'doc_type:ppt',             21),
  ('courseware_2d',   '课件（2D）',   3, 'doc_type:courseware_2d',   22),
  ('courseware_3d',   '课件（3D）',   4, 'doc_type:courseware_3d',   23)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order;


-- =================== 0020_credit_expiry.sql ===================
-- =============================================================================
-- 0020_credit_expiry.sql
-- 注册赠送体验积分 7 天过期 + FIFO（先扣最快到期）+ 到期自动作废
--
-- 设计要点（资金逻辑保守，余额（credit_accounts.balance）永远是权威真相源）：
--   1. credit_lots 记录每一笔「收入」的剩余量与过期时间，是 FIFO 扣减的批次真相源；
--   2. apply_credit 统一维护 balance + credit_lots + credit_transactions：
--        - 正变动（发放）：记一条 lot（带 expires_at），再调余额；
--        - 负变动（生成扣减 / 管理员减）：按 expires_at 升序（null 永放最后）从 lot 扣减；
--   3. void_expired_credits：把已过期 lot 的剩余量清零并同步调减余额（不超过当前余额）；
--   4. reserve_credits 扣前先作废过期积分，再校验余额，扣减走 apply_credit（FIFO）；
--   5. 注册触发器：建积分账户时，把赠送体验积分登记为一条带 7 天过期的 lot；
--   6. 配置 registerGiftDays（默认 7，0 = 永不过期），过期天数走配置、不写死；
--   7. get_my_summary / admin_list_users 展示余额时剔除「已过期但尚未触发作废」部分，保证一致。
--
-- 注意：本机无 Supabase 实例，无法真连库执行；正确性问题见文件末尾「自测说明」。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 流水原因枚举增加 'expire'（过期作废）
-- ---------------------------------------------------------------------------
alter type public.ledger_reason_enum add value if not exists 'expire';

-- ---------------------------------------------------------------------------
-- 2. credit_transactions 增加 expires_at（便于流水追溯有效期 / 过期时间）
-- ---------------------------------------------------------------------------
alter table public.credit_transactions
  add column if not exists expires_at timestamptz;

create index if not exists credit_tx_expires_idx
  on public.credit_transactions (user_id, expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- 3. credit_lots：积分批次（lot），记录每笔收入的剩余量与过期时间
-- ---------------------------------------------------------------------------
create table if not exists public.credit_lots (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  amount     integer not null check (amount >= 0),      -- 原始发放量
  remaining  integer not null check (remaining >= 0),  -- 剩余可花
  expires_at timestamptz,                               -- null = 永久有效
  reason     public.ledger_reason_enum not null,
  ref_type   text not null default '',
  ref_id     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists credit_lots_user_exp_idx
  on public.credit_lots (user_id, expires_at) where expires_at is not null;
create index if not exists credit_lots_user_rem_idx
  on public.credit_lots (user_id) where remaining > 0;

-- 仅经 SECURITY DEFINER RPC 访问，客户端无策略（默认全拒），不暴露给 anon
alter table public.credit_lots enable row level security;

-- ---------------------------------------------------------------------------
-- 4. 配置：注册赠送有效期（天），默认 7；0 = 永不过期
-- ---------------------------------------------------------------------------
update public.system_config
   set value = jsonb_set(value, '{registerGiftDays}', to_jsonb(7))
 where key = 'credit';

-- ---------------------------------------------------------------------------
-- 5. 重写 apply_credit：统一维护 balance + credit_lots + credit_transactions
--    - 正变动：记 lot（带 expires_at）+ 调余额；
--    - 负变动（生成扣减 / 管理员减）：按到期顺序 FIFO 从 lot 扣减。
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit(
  p_user_id uuid,
  p_delta integer,
  p_reason public.ledger_reason_enum,
  p_ref_type text default '',
  p_ref_id text default '',
  p_memo text default '',
  p_tokens_in integer default 0,
  p_tokens_out integer default 0,
  p_model text default '',
  p_cost_cny numeric default 0,
  p_operator_id uuid default null,
  p_expires_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_lot public.credit_lots%rowtype;
  v_need integer;
  v_take integer;
begin
  -- 行锁：并发下串行化，保证余额不超额
  select balance into v_balance
    from public.credit_accounts
   where user_id = p_user_id
     for update;

  if not found then
    insert into public.credit_accounts (user_id, balance, total_earned)
    values (p_user_id, 0, 0);
    v_balance := 0;
  end if;

  -- 收入：记 lot + 调余额 + 写流水
  if p_delta > 0 then
    v_balance := v_balance + p_delta;

    update public.credit_accounts
       set balance = v_balance,
           total_earned = total_earned + p_delta,
           updated_at = now()
     where user_id = p_user_id;

    insert into public.credit_lots (user_id, amount, remaining, expires_at, reason, ref_type, ref_id)
    values (p_user_id, p_delta, p_delta, p_expires_at, p_reason, p_ref_type, p_ref_id);

    insert into public.credit_transactions
      (user_id, delta, balance_after, reason, ref_type, ref_id,
       tokens_in, tokens_out, model, cost_cny, memo, operator_id, expires_at)
    values
      (p_user_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id,
       p_tokens_in, p_tokens_out, p_model, coalesce(p_cost_cny, 0), p_memo, p_operator_id, p_expires_at);

    return v_balance;
  end if;

  -- 支出：FIFO 从「未过期 lot」中扣减（expires_at 升序，null 永久放最后）
  if p_delta < 0 then
    v_need := -p_delta;
    for v_lot in
      select * from public.credit_lots
       where user_id = p_user_id and remaining > 0
         and (expires_at is null or expires_at > now())
       order by expires_at asc nulls last, id asc
       for update
    loop
      exit when v_need <= 0;
      v_take := least(v_lot.remaining, v_need);
      update public.credit_lots set remaining = remaining - v_take where id = v_lot.id;
      v_need := v_need - v_take;
    end loop;

    v_balance := v_balance + p_delta;   -- p_delta < 0
    if v_balance < 0 then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;

    update public.credit_accounts
       set balance = v_balance,
           total_used = total_used + (-p_delta),
           updated_at = now()
     where user_id = p_user_id;

    insert into public.credit_transactions
      (user_id, delta, balance_after, reason, ref_type, ref_id,
       tokens_in, tokens_out, model, cost_cny, memo, operator_id, expires_at)
    values
      (p_user_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id,
       p_tokens_in, p_tokens_out, p_model, coalesce(p_cost_cny, 0), p_memo, p_operator_id, null);

    return v_balance;
  end if;

  -- p_delta = 0：无操作
  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. void_expired_credits：把已过期 lot 剩余量清零并同步调减余额
--    保守：单次调减不超过当前余额，绝不让余额变负。
--    可周期性由 Edge Function（service_role）调用 void_expired_credits(null) 全量清扫；
--    客户端路径 reserve_credits 在扣前也会先对本用户作废一次。
-- ---------------------------------------------------------------------------
create or replace function public.void_expired_credits(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.credit_lots%rowtype;
  v_balance integer;
  v_deduct integer;
  v_count integer := 0;
begin
  for v_lot in
    select * from public.credit_lots
     where remaining > 0 and expires_at is not null and expires_at <= now()
       and (p_user_id is null or user_id = p_user_id)
     order by user_id, expires_at asc
     for update of credit_lots
  loop
    select balance into v_balance
      from public.credit_accounts where user_id = v_lot.user_id for update;

    v_deduct := least(v_lot.remaining, greatest(v_balance, 0));
    if v_deduct > 0 then
      update public.credit_accounts
         set balance = balance - v_deduct, updated_at = now()
       where user_id = v_lot.user_id;

      insert into public.credit_transactions
        (user_id, delta, balance_after, reason, ref_type, ref_id, memo)
      values
        (v_lot.user_id, -v_deduct,
         (select balance from public.credit_accounts where user_id = v_lot.user_id),
         'expire', 'expire', v_lot.id::text, '体验积分过期自动作废');
    end if;

    update public.credit_lots set remaining = remaining - v_deduct where id = v_lot.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 重写 reserve_credits：扣前先作废过期积分 → 余额校验 → FIFO 扣减
-- ---------------------------------------------------------------------------
create or replace function public.reserve_credits(
  p_amount integer,
  p_job_id uuid,
  p_app_type text default 'auto',
  p_model text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
  v_existing integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'UNAUTHORIZED');
  end if;

  -- 扣前先作废过期积分，保证余额真实（保守）
  perform public.void_expired_credits(v_uid);

  -- 幂等：同一 job 已预扣过则直接返回当前余额
  select balance_after into v_existing
    from public.credit_transactions
   where ref_type = 'generate_spend' and ref_id = p_job_id::text;

  if found then
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
    return jsonb_build_object('ok', true, 'balance', coalesce(v_balance, 0), 'code', '', 'idempotent', true);
  end if;

  select balance into v_balance
    from public.credit_accounts
   where user_id = v_uid
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'INSUFFICIENT_CREDITS');
  end if;

  if v_balance < p_amount then
    return jsonb_build_object('ok', false, 'balance', v_balance, 'code', 'INSUFFICIENT_CREDITS');
  end if;

  v_balance := public.apply_credit(
    p_user_id   => v_uid,
    p_delta     => -p_amount,
    p_reason    => 'generate_spend',
    p_ref_type  => 'generate_spend',
    p_ref_id    => p_job_id::text,
    p_memo      => format('生成%s应用预扣', coalesce(p_app_type, '')),
    p_model     => coalesce(p_model, '')
  );

  return jsonb_build_object('ok', true, 'balance', v_balance, 'code', '', 'idempotent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. get_my_summary：展示余额剔除「已过期但尚未触发作废」部分，保持一致
-- ---------------------------------------------------------------------------
create or replace function public.get_my_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null then
    return jsonb_build_object('balance', 0, 'totalEarned', 0, 'totalUsed', 0, 'membership', null);
  end if;

  select coalesce(c.balance, 0) - coalesce((
           select sum(l.remaining) from public.credit_lots l
            where l.user_id = v_uid and l.remaining > 0
              and l.expires_at is not null and l.expires_at <= now()
         ), 0)
    into v_balance
    from public.credit_accounts c
   where c.user_id = v_uid;

  return jsonb_build_object(
    'balance',     coalesce(v_balance, 0),
    'totalEarned', coalesce((select total_earned from public.credit_accounts where user_id = v_uid), 0),
    'totalUsed',   coalesce((select total_used from public.credit_accounts where user_id = v_uid), 0),
    'membership',  (
      select jsonb_build_object(
               'planId', m.plan_id,
               'planName', p.name,
               'expiresAt', m.expires_at,
               'status', m.status
             )
        from public.user_memberships m
        left join public.membership_plans p on p.id = m.plan_id
       where m.user_id = v_uid
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 触发器：注册建积分账户时，把赠送体验积分登记为一条带过期的 lot
--    （handle_new_user 直接 insert credit_accounts，这里在其后自动补 lot，零侵入）
-- ---------------------------------------------------------------------------
create or replace function public.tag_register_gift_lot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := 7;
  v_exp timestamptz;
begin
  if new.balance <= 0 then
    return new;
  end if;

  select coalesce((value ->> 'registerGiftDays')::integer, 7)
    into v_days
    from public.system_config
   where key = 'credit';

  v_exp := case when coalesce(v_days, 0) > 0
             then now() + (v_days || ' days')::interval
             else null end;

  insert into public.credit_lots (user_id, amount, remaining, expires_at, reason, ref_type, ref_id)
  values (new.user_id, new.balance, new.balance, v_exp, 'register_gift', 'register_gift', new.user_id::text);

  return new;
end;
$$;

drop trigger if exists trg_credit_accounts_gift_lot on public.credit_accounts;
create trigger trg_credit_accounts_gift_lot
  after insert on public.credit_accounts
  for each row execute function public.tag_register_gift_lot();

-- ---------------------------------------------------------------------------
-- 10. 授权（create or replace 保留 ACL；这里再显式授一次，幂等）
--     void_expired_credits 供 Edge Function（service_role）全量清扫；apply_credit 仅内部调用，无需客户端授权。
-- ---------------------------------------------------------------------------
grant execute on function public.void_expired_credits(uuid) to service_role;

-- =============================================================================
-- 自测说明（本机无 Supabase 实例，无法真连库执行；以下为部署后应覆盖的断言，
-- 可在 Supabase SQL Editor / Edge Function 中验证）：
--   1) 发放：新用户注册后 credit_lots 应有一条 reason='register_gift'、
--            expires_at≈ now()+7d 的 lot，remaining = registerGift（默认 100）。
--   2) 7 天内消费：reserve_credits(job) 成功扣减，FIFO 优先消耗该 gift lot
--            （其 expires_at 最早；若同时有其他永久 lot，则 gift 先被扣）。
--   3) 7 天后过期：void_expired_credits(uid) 将该 lot remaining 置 0，并把余额扣回；
--            get_my_summary().balance 不再含过期部分（展示已自动剔除）。
--   4) 余额正确：总 gift 100 → 消费 2 → 余额 98；若 100 一直未消费，过期后余额回到 0。
--   5) 保守性：余额永不为负（void / 扣减都受 balance>=0 约束）。
-- =============================================================================


-- =================== 0021_admin_users.sql ===================
-- =============================================================================
-- 0021_admin_users.sql
-- 后台「查看注册用户」增强（复用既有 admin_* RPC 体系，不另起炉灶）
--
-- 改动点（在既有 admin_list_users 上补强）：
--   1. 增加 email（来自 auth.users，仅管理员经 SECURITY DEFINER 可见）、generation_count（生成次数）；
--   2. 分页上限收紧到每页 ≤ 50（p_limit 被 clamp 到 [1,50]），防脚本批量爬取；
--   3. 身份校验不变：函数体内校验调用者 role='admin'，非管理员直接 raise 42501；
--   4. 余额剔除「已过期但尚未触发作废」的体验积分，与 get_my_summary 口径一致；
--   5. 反爬要点：列表接口为 SECURITY DEFINER RPC（PII 不进任何视图、不暴露给 anon），
--      RLS 对相关表默认全拒；最小化限频建议后续在 Edge Function 层做
--      （如 supabase.functions 限流 / 网关层 WAF），本次把分页上限 + 身份校验做扎实。
--
-- 说明：本 RPC 经 SECURITY DEFINER 读取 auth.users.email 与 generation_jobs，
--       绕过客户端 RLS，故 PII 绝不会下发到非 admin 客户端。
-- =============================================================================

-- 0021 在 0009 基础上补强（增加 email / generation_count 列），返回结构变了，
-- 必须用 drop + create（CREATE OR REPLACE 不允许改 RETURNS TABLE 列数，会 42P13）。
drop function if exists public.admin_list_users(text, integer, integer);
create function public.admin_list_users(
  p_q      text default null,
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id               uuid,
  nickname         text,
  role             public.user_role_enum,
  email            text,
  balance          integer,
  plan_id          text,
  generation_count bigint,
  created_at       timestamptz,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 身份校验：仅管理员可查看（非管理员直接报错，绝不返回数据）
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then
    raise exception '仅管理员可查看用户' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.nickname,
    p.role,
    coalesce(au.email, ''),
    -- 余额剔除已过期但尚未触发作废的体验积分
    coalesce(c.balance, 0) - coalesce((
      select sum(l.remaining) from public.credit_lots l
       where l.user_id = p.id and l.remaining > 0
         and l.expires_at is not null and l.expires_at <= now()
    ), 0),
    m.plan_id,
    coalesce((
      select count(*) from public.generation_jobs g where g.user_id = p.id
    ), 0),
    p.created_at,
    (count(*) over())::bigint
  from public.profiles p
  left join public.credit_accounts c on c.user_id = p.id
  left join public.user_memberships m on m.user_id = p.id
  left join auth.users au on au.id = p.id
  where (p_q is null or p_q = '' or p.nickname ilike '%' || p_q || '%' or au.email ilike '%' || p_q || '%')
  order by p.created_at desc
  -- 分页上限收紧到每页 ≤ 50（防批量爬取）
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- 重新显式授权（create or replace 保留 ACL，这里幂等再授一次）
grant execute on function public.admin_list_users(text, integer, integer) to anon, authenticated, service_role;


-- =================== 0022_recharge_self.sql ===================
-- =============================================================================
-- 0022_recharge_self.sql
-- 自助充值：野马个人收款码 + 后台确认到账（无聚合支付、无商户资质、零费率）
--
-- 流程：
--   1) 老师在 RechargePage 看收款码 + 引导文案（system_config.payment）；
--   2) 扫码付款后，提交充值请求 → 写 recharge_requests（status='pending'）；
--   3) 野马在 AdminPage「待充值」Tab 点「确认到账」→ admin_approve_recharge：
--        - approved: 按 plan_id 查 membership_plans.credits，给该用户加积分（永久）；
--        - rejected: 仅置状态；
--   4) 积分走已有 apply_credit（reason='recharge_self', ref_type='recharge'），
--      留流水对账，ref_id=请求 uuid。
--
-- 安全约束：
--   - recharge_requests 启 RLS，客户端只能 insert / select 自己的行；
--   - 管理员读全部走 SECURITY DEFINER RPC（admin_list_recharge / admin_approve_recharge）；
--   - 公开读收款码配置走 get_system_config（SECURITY DEFINER）；
--   - 管理员写收款码配置走 admin_set_system_config（SECURITY DEFINER + role 校验）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 流水原因枚举增加 'recharge_self'（自助充值到账）
-- ---------------------------------------------------------------------------
alter type public.ledger_reason_enum add value if not exists 'recharge_self';

-- ---------------------------------------------------------------------------
-- 2. 充值请求表
-- ---------------------------------------------------------------------------
create table if not exists public.recharge_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  plan_id         text references public.membership_plans (id),
  amount_cny      numeric(10, 2) not null,
  pay_method      text not null check (pay_method in ('wechat', 'alipay')),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proof_text      text,
  proof_image_url text,
  created_at      timestamptz not null default now(),
  handled_by      uuid references public.profiles (id),
  handled_at      timestamptz
);

create index if not exists recharge_requests_user_idx
  on public.recharge_requests (user_id, created_at desc);
create index if not exists recharge_requests_status_idx
  on public.recharge_requests (status, created_at desc);

alter table public.recharge_requests enable row level security;

-- 用户可 insert 自己的、select 自己的
drop policy if exists recharge_requests_insert_self on public.recharge_requests;
create policy recharge_requests_insert_self on public.recharge_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists recharge_requests_select_self on public.recharge_requests;
create policy recharge_requests_select_self on public.recharge_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. 公开读 system_config 单条 key（供未登录老师也能看收款码 + 引导文案）
-- ---------------------------------------------------------------------------
create or replace function public.get_system_config(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_value jsonb;
begin
  select value into v_value from public.system_config where key = p_key;
  return coalesce(v_value, '{}'::jsonb);
end;
$$;

grant execute on function public.get_system_config(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 管理员写 system_config（SECURITY DEFINER + role 校验）
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_system_config(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可维护系统配置' using errcode = '42501';
  end if;

  insert into public.system_config (key, value, updated_at, updated_by)
  values (p_key, coalesce(p_value, '{}'::jsonb), now(), v_uid)
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return coalesce(p_value, '{}'::jsonb);
end;
$$;

grant execute on function public.admin_set_system_config(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. 管理员：确认 / 拒绝充值请求
--    - p_ok=true  时按 plan_id 查 membership_plans.credits 加积分（永久）；
--    - plan_id 为空 / 套餐不存在 / credits=0 时返回 ok=false（不修改状态）。
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_recharge(p_id uuid, p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     public.recharge_requests%rowtype;
  v_plan    public.membership_plans%rowtype;
  v_balance integer := 0;
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可确认充值' using errcode = '42501';
  end if;

  select * into v_req from public.recharge_requests where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', '充值请求不存在');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_HANDLED',
                              'message', format('该请求已处理（%s），无需重复操作', v_req.status));
  end if;

  if p_ok then
    if v_req.plan_id is null or v_req.plan_id = '' then
      return jsonb_build_object('ok', false, 'code', 'NO_PLAN',
                                'message', '该请求未选择套餐，无法到账');
    end if;

    select * into v_plan from public.membership_plans where id = v_req.plan_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND',
                                'message', '套餐不存在，无法到账');
    end if;
    if v_plan.credits <= 0 then
      return jsonb_build_object('ok', false, 'code', 'ZERO_CREDITS',
                                'message', '套餐积分为 0，无需到账');
    end if;

    v_balance := public.apply_credit(
      p_user_id   => v_req.user_id,
      p_delta     => v_plan.credits,
      p_reason    => 'recharge_self',
      p_ref_type  => 'recharge',
      p_ref_id    => p_id::text,
      p_memo      => format('自助充值到账：%s ¥%s（%s）',
                            v_plan.name, v_req.amount_cny, v_req.pay_method)
    );
  end if;

  update public.recharge_requests
     set status     = case when p_ok then 'approved' else 'rejected' end,
         handled_by = v_uid,
         handled_at = now()
   where id = p_id;

  return jsonb_build_object(
    'ok',      true,
    'status',  case when p_ok then 'approved' else 'rejected' end,
    'balance', coalesce(v_balance, 0),
    'message', case when p_ok then '已确认到账' else '已拒绝该请求' end
  );
end;
$$;

grant execute on function public.admin_approve_recharge(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. 管理员：分页列出充值请求（≤50，防批量爬取）
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_recharge(
  p_status text default 'pending',
  p_limit  integer default 50
)
returns table (
  id              uuid,
  user_id         uuid,
  nickname        text,
  plan_id         text,
  plan_name       text,
  amount_cny      numeric,
  pay_method      text,
  status          text,
  proof_text      text,
  proof_image_url text,
  created_at      timestamptz,
  handled_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看充值请求' using errcode = '42501';
  end if;

  return query
  select r.id, r.user_id, p.nickname, r.plan_id, mp.name, r.amount_cny, r.pay_method, r.status,
         r.proof_text, r.proof_image_url, r.created_at, r.handled_at
    from public.recharge_requests r
    left join public.profiles p on p.id = r.user_id
    left join public.membership_plans mp on mp.id = r.plan_id
   where (p_status is null or p_status = '' or r.status = p_status)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 50);
end;
$$;

grant execute on function public.admin_list_recharge(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. 种子：payment key 兜底（缺图仍可显示引导文案）
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description)
values (
  'payment',
  jsonb_build_object(
    'wechatQrUrl', '',
    'alipayQrUrl', '',
    'tip', '选套餐 → 扫下方码付款（备注你的账号名）→ 付款后点"我已付款"提交凭证 → 管理员核对后积分到账'
  ),
  '个人收款码 + 引导文案（自助充值）'
)
on conflict (key) do nothing;

-- =================== 0023_3d_scope.sql ===================
-- =============================================================================
-- 0023_3d_scope.sql
-- 3D 课件止血：把 `scene.type` 收缩到「真能渲染」的两类（geometry / molecule）
--
-- 背景（见 docs/QUALITY_BASELINE.md ① 确证结论）：
--   ThreeViewer 实际只实现了 geometry（基础几何体）与 molecule（球棍分子）两类真模型；
--   `function` 分支写死 sin·cos 曲面、完全不读 AI 给的表达式；
--   `globe` / `circuit` / `biology` / `physics` / `custom` 全部落到同一个
--   「蓝方块 + 4 个橙球」通用占位体。
--   → 结果是：老师点「3D 课件」（最贵的一档），拿到一个跟教学内容无关的假模型。
--
-- 处理原则（客户硬要求）：**宁可少一个功能，不能给一个假的。**
--   1. 提示词层面：只允许输出 geometry / molecule；
--   2. 兜底：若本节内容两者都不合适，允许用最贴近的简单几何体作**明确标注的示意模型**，
--      并在 verifyHints 里如实说明「当前 3D 仅支持几何体与分子结构」，不装作真模型；
--   3. 渲染层面（前端 ThreeViewer / Edge renderDoc）对不支持类型给诚实提示，不再画占位体。
--
-- 本文件只改配置表（prompt_templates），**不需要重新部署 Edge Function**即可生效。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 幂等 seed 助手（与 0011 / 0016 同实现；两文件末尾已 drop，这里 recreate 以便独立可重跑）
-- ---------------------------------------------------------------------------
create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- doc_type:courseware_3d —— 收缩到 geometry / molecule
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:courseware_3d', $pt$
# 文档类型：课件（3D 真 Three.js）（courseware_3d）

输出一节含可旋转 / 可拆解 3D 模型的课件。除 `blocks` 文字讲解外，必须提供 `scene`
（SceneDescriptor）结构化描述，供平台 ThreeViewer 渲染。

## ⚠️ 最重要的约束：scene.type 只有两个合法值

**你只能从这两个里面选，其它值一律不允许输出：**

| `scene.type` | 适用内容 | `scene.params` 约定 |
|---|---|---|
| `geometry` | 立体图形：正方体 / 长方体 / 球 / 圆柱 / 圆锥 / 棱锥 | `{ "shape": "box"\|"sphere"\|"cylinder"\|"cone"\|"pyramid" }` |
| `molecule` | 分子结构：水 / 二氧化碳 / 甲烷 / 氨 等 | `{ "atoms": [ { "element": "O"\|"H"\|"C"\|"N", "position": [x,y,z] } ] }` |

**严禁**输出 `function` / `globe` / `circuit` / `biology` / `physics` / `custom`
—— 平台目前渲染不了这些类型，输出它们等于给教师一个空壳。

## 如果本节内容既不是几何体、也不是分子

（例如：函数图像、物理原理、生物结构、电路连接等）

1. **照常输出高质量 `blocks` 文字讲解**——把知识点、步骤、易错点讲清楚，这是主体；
2. `scene` 仍要输出，但**只能用 `geometry`**，选一个最贴近的简单形状（如 box）；
3. **必须**在 `verifyHints` 中如实写明，例如：
   `建议教师核对：本平台 3D 目前仅支持「几何体」与「分子结构」两类模型，本节内容为函数图像，下方 3D 仅为示意模型，请以文字讲解为准。`
4. **绝对不要**假装输出了一个函数曲面或物理装置——宁可说明做不到，也不要给假的。

## 其它要求

- `scene.explodable`：是否支持点击拆解观察内部，默认 true；
- `scene.annotations`：部件 / 知识点标注文字列表（显示在模型旁），2~6 条；
- `scene.title`：场景标题；
- `blocks` 提供文字讲解（目标 / 知识点 / 操作步骤 / 小结），与 3D 模型呼应；
- 凡 3D 参数（尺寸、比例、原子坐标）由 AI 推断的，写入 `verifyHints`。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾：与 0011 / 0016 保持一致，删除幂等助手
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0024_doc_prompt_fix.sql ===================
-- =============================================================================
-- 0024_doc_prompt_fix.sql
-- 文档生成提示词「拆架」+ 放开输出上限
--
-- 背景（见 docs/QUALITY_BASELINE.md 提交 2）：
--   文档生成（category='doc'）此前复用了「生成 HTML 网页应用」的 system 段，其中三节
--   与「输出 DocModel JSON」的目标**直接冲突 / 完全无关**：
--     - `system_section:role`          → "把想法实现为单文件网页应用"（任务定位跑偏）
--     - `system_section:output_format` → "只输出一个 HTML 文件"（**与输出 JSON 冲突**）
--     - `system_section:code_quality`  → "use strict / addEventListener / innerHTML"（无关，白占 ~400 token）
--   后果：模型在「输出 HTML」与「输出 JSON」之间摇摆 → JSON 格式错误率升高 →
--         教师看到「这次没生成成功，已退还积分」。
--
-- 处理：
--   1. 新增文档专用两节 `system_section:doc_role` / `system_section:doc_output_format`；
--      配套把 `compose.ts` 的 DOC_SYSTEM_SECTIONS 三个 key 换掉（**本次需部署一次
--      Edge Function；之后所有提示词调整都是纯改表、不用再部署**）；
--   2. 输出上限 8000 → 16000 token（教案/PPT 才有空间写"血肉"而不只是骨架）；
--   3. `doc_type:lesson_plan` 补两条硬约束（时长之和 = 课堂总时长、必须 3 道带演算的例题）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 幂等 seed 助手（与 0011 / 0016 / 0023 同实现）
-- ---------------------------------------------------------------------------
create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- 一、文档专用「角色」（替换掉讲"单文件网页应用"的 role）
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:doc_role', $pt$
# 角色

你是深耕中小学一线、**常年参与市级教案评比与集体备课**的学科教研专家 + 教学设计专家。

你具备三种能力：
1. **学科教研**：准确把握课标要求、知识点梯度、与该年级学生的认知水平，知道哪些是易错点；
2. **教学设计**：能把一节课拆成"导入—探究—巩固—小结—作业"的完整闭环，并说清每一步**为什么这么做**；
3. **文书能力**：写出来的东西符合教研室规范，可直接打印、可直接投影、可交教务处检查。

你服务的对象是不懂技术的学科教师。他们要的不是"看起来像教案的文本"，
而是**明天早上第一节课就能照着上**的东西。

⚠️ 你产出的不是网页、不是代码，而是**结构化的教学文档内容**。
$pt$);

-- =============================================================================
-- 二、文档专用「输出格式」（替换掉讲"只输出 HTML"的 output_format）
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:doc_output_format', $pt$
# 输出格式（硬约束，违反即判定失败）

1. **只输出一个 ` ```json ` 代码块**，块内是一个完整的 DocModel 对象。
   代码块**外不得有任何文字**（不要说"好的""以下是…"，也不要在结尾追加说明）。
2. JSON 必须**合法且完整**：不得截断、不得出现注释、不得出现尾随逗号、不得残留 `TODO`，
   字符串内的双引号必须转义。
3. 顶层字段必须齐全：`kind` / `meta` / `blocks`（ppt 还需 `slides`，courseware_3d 还需 `scene`）/
   `verifyHints` / `version`。
4. 每个 `blocks` 元素必须有 `id`（唯一字符串）与 `type`；
   `type` 只能取 `heading` / `paragraph` / `list` / `table` / `image` / `callout`。
5. **不得输出 HTML、不得输出代码、不得输出 Markdown 文档**——内容一律用上面的块结构表达。
6. 一次只生成**一节课（1 课时）**的内容，详见下方「范围约束」。
$pt$);

-- =============================================================================
-- 三、教案：补两条硬约束（时长之和 / 例题链）+ 范围约束
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:lesson_plan', $pt$
# 文档类型：教案（lesson_plan）

输出一份结构完整、可直接打印使用的教案，必须包含以下板块，用 `blocks` 富文本块表达：

1. 教学基本信息（学科 / 年级 / 课时 / 教材版本）——heading + paragraph
2. 教学目标——heading + list（分 知识与技能 / 过程与方法 / 情感态度价值观）
3. 教学重难点——heading + list
4. 教学准备——heading + list（含教具、课件、学具）
5. 教学过程——heading + 多个子 heading（环节名），每环节用 list 或 paragraph 给出
   「教师活动 / 学生活动 / 设计意图 / 时间分配」四要素
6. 板书设计——heading + paragraph（用方框示意或等宽描述）
7. 作业设计——heading + list（分层：基础 / 拓展）
8. 教学反思——heading + paragraph（预留可填写区域，可写"（待课后填写）"）

## 两条硬约束（不遵守即判定失败）

**A. 时间分配必须自洽**：教学过程各环节的时间分配之和，**必须等于**教师填写的课堂时长
（教师未填写时按 45 分钟计）。写完后自己加一遍核对，不允许出现 5+10+15+12+10=52 这类错误。

**B. 必须给出例题链**：至少 **3 道**例题，每道都要有**完整的演算/解答过程**（分步写出，
不是只给答案），并体现**由易到难的梯度**（基础模仿 → 变式 → 综合应用）。
数学/物理/化学等演算型学科，例题用 `list` 或 `paragraph` 逐步写出步骤；
语文/英语/历史等学科，"例题"对应"样例分析 / 语段精读 / 材料解析"，同样要有完整分析过程。

## 范围约束

**只生成一节课（1 课时）的内容。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整；如涉及评分表等
结构化数据，可用 type=table 的 block 表达。凡 AI 推断的课时数、例题数据等不确定点，写入
`verifyHints`。
$pt$);

-- =============================================================================
-- 四、PPT / 课件2D / 办公文档：同样加「只生成一课时」的范围约束
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:ppt', $pt$
# 文档类型：PPT 课件（ppt）

输出一份幻灯片课件，用 `slides` 数组表达，每页 slide 含 `title` 与 `body`（DocBlock 列表）与
可选 `notes`（演讲者备注）与 `layout`（title|content|two_col|section）。

要求：
- 页数 ≥ 8 页（内容允许时做到 12~15 页更好），逻辑顺序：封面 → 目标 → 新知导入 → 2~4 个知识页 → 例题/活动 → 小结 → 作业；
- 每页 `body` 用 heading / list / paragraph / table 等块，避免大段纯文字；
- `notes` 给教师一句"怎么讲"：开场白、易错提醒、互动提问；
- 关键概念、公式、对比可用 table 或 callout 块突出；
- 涉及函数图像、数据对比、几何图形时，**用 table 块把关键取值/坐标列出来**，
  方便教师照着画到黑板上；若需要配图，image 块的 `src` 留空并 `caption` 注明"建议配图：XX"；
- 不确定处（如例题数据）写入 `verifyHints`。

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`
$pt$);

select public.seed_prompt('doc_type', 'doc_type:courseware_2d', $pt$
# 文档类型：课件（2D / 伪 3D）（courseware_2d）

输出一节以图文为主的互动式 2D 课件，用 `blocks` 富文本表达，强调"边看边学"的版式：

- 开场用 heading 说明本节目标；
- 每个知识点用 paragraph + image（caption 注明"建议配图/动画：XX"，src 留空）+ callout（提示/易错）组织；
- 关键对比、步骤、数据用 table 块；
- 每 2~3 个知识点插入一个 list 形式的"想一想/做一做"小活动；
- 结尾 heading"本节课小结"+ paragraph 总结；
- 不确定处写入 `verifyHints`。

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

（2D 课件的可视化由富文本编辑器 + 静态图形渲染；本批只需结构化 blocks。）
$pt$);

select public.seed_prompt('doc_type', 'doc_type:office_doc', $pt$
# 文档类型：办公文档（office_doc）

输出一份教师日常办公文档（如：通知、计划、总结、发言稿、家长会文案、活动方案、阅卷说明等），
用 `blocks` 富文本表达，结构清晰、用语正式得体：

- 文档标题用 heading(level=1)；
- 正文分段用 paragraph；
- 要点、步骤、名单用 list（有序/无序按内容）；
- 涉及排期、分工、名单等可用 table；
- 如引用文件/模板，callout 注明"依据：XX 文件"；
- 落款、日期等用 paragraph 或 caption；
- 缺失的具体信息（如学校名、日期、人名）用占位并写入 `verifyHints`，**不要编造真实机构名**。

排版要求：层级分明、便于直接复制进 Word/WPS 使用。
正文写充分一些（通知类 500~800 字，方案/总结类 1000~1500 字），不要只给提纲。
$pt$);

-- ---------------------------------------------------------------------------
-- 五、放开输出上限 8000 → 16000（教案/PPT 才有空间写"血肉"）
--    成本影响：单次约翻倍到 ¥0.05，按定价毛利仍有 ~50%，值得。
-- ---------------------------------------------------------------------------
update public.system_config
   set value = jsonb_set(value, '{maxOutputTokens}', '16000'::jsonb, true),
       updated_at = now()
 where key = 'limit';

update public.model_profiles
   set max_output_tokens = 16000,
       updated_at = now()
 where max_output_tokens < 16000;

-- ---------------------------------------------------------------------------
-- 收尾：删除幂等助手
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0025_generation_guardrails.sql ===================
-- =============================================================================
-- 0025_generation_guardrails.sql
-- 生成护栏：抬高月度支出阀 + 范围护栏提示词兜底
--
-- 背景（见 docs/QUALITY_BASELINE.md ③ 问题 1 / 问题 2-4）：
--   1. `limit.monthlySpendCny` 原本只有 **100 元/月**。按高峰均价约 ¥0.03/次算，
--      **约 3300 次生成就会全站停服**（页面提示"平台本月额度已用完"）。
--      换算：1 个教研组 20 位老师 × 每人每月 20 次 = 400 次，**8 个教研组就用完**。
--      这会在推广最猛的时候全站报错——最伤口碑、且完全可以提前避免。
--      → 抬到 **1000 元/月**（约 3.3 万次生成，够支撑上千名老师试用）。
--   2. 「一次生成整学期」的范围护栏：Edge Function 侧已做关键词拦截（不扣积分秒回），
--      这里同步把提示词侧的范围约束补齐（双保险，拦截规则调整时不至于裸奔）。
--
-- ⚠️ 月度阀读取位置（以后要调就改这里）：
--   - `system_config` 表 `key='limit'` 的 `value->>'monthlySpendCny'`
--   - 消费方有两处，都读同一份配置，改一次即可：
--       a) Edge Function `supabase/functions/_shared/cost.ts` 的 `assertUnderMonthlyCap()`
--       b) 数据库 RPC `public.check_generation_allowed()`（迁移 0008）
--   - 后台看板：`monthly_spend` 表（period 为 YYYY-MM，按 period 聚合）
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 一、月度支出阀 100 → 1000（改配置表，立即生效，不需要重新部署）
-- ---------------------------------------------------------------------------
update public.system_config
   set value = jsonb_set(
         coalesce(value, '{}'::jsonb),
         '{monthlySpendCny}',
         '1000'::jsonb,
         true
       ),
       updated_at = now()
 where key = 'limit';

-- 兜底：若历史上没插过 'limit' 这一行（例如库被清空重来），补一行完整默认值
insert into public.system_config (key, value, description)
values (
  'limit',
  jsonb_build_object(
    'monthlySpendCny', 1000,
    'maxInputTokens', 8000,
    'maxOutputTokens', 16000,
    'maxHtmlBytes', 204800,
    'serveFallbackPerDay', 500,
    'squarePageSize', 24
  ),
  '平台侧成本护栏与全局上限'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 二、提示词侧范围约束
--    `doc_type:lesson_plan` / `doc_type:ppt` / `doc_type:courseware_2d` 三份的
--    「范围约束（只生成一课时）」已在 0024 写入，这里不再重复 seed。
--    `courseware_3d`（单个 3D 场景）与 `office_doc`（单份文书）本身天然是一课时/一份，
--    不存在"整学期"风险，无需额外约束。
-- ---------------------------------------------------------------------------


-- =================== 0026_chart_block.sql ===================
-- =============================================================================
-- 0026_chart_block.sql
-- 新增 `chart` 图表块：让数学/物理课件里**真的有函数图像**
--
-- 背景（docs/QUALITY_BASELINE.md 提交 4）：
--   此前提示词要求"需要配图时 `image.src` 留空、只写一句『建议配图：XX』"，
--   结果生成的 PPT / 课件**一张真图都没有**——一节讲「二次函数图像」的数学课，
--   课件里没有函数图像。这是当时把 PPT 判为 ❌ 的**唯一致命伤**。
--
-- 解法：新增 `chart` 块类型，AI 只需输出**结构化数据**（函数采样点 / 分类数值），
--   平台用**纯内联 SVG** 画出来（不引 echarts / chart.js，不再重蹈 three 747KB 拖垮首屏的覆辙）。
--   前端 `DocRenderer` 与 Edge `renderDoc` 各自渲染，导出 docx/pptx 时降级为
--   「表达式 + 关键取值」文本，保证教师离线也能照着画到黑板上。
--
-- 本文件只改配置表（prompt_templates），**不需要重新部署 Edge Function**。
-- =============================================================================

create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- 一、教案：函数/数据型内容必须配 chart 块
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:lesson_plan', $pt$
# 文档类型：教案（lesson_plan）

输出一份结构完整、可直接打印使用的教案，必须包含以下板块，用 `blocks` 富文本块表达：

1. 教学基本信息（学科 / 年级 / 课时 / 教材版本）——heading + paragraph
2. 教学目标——heading + list（分 知识与技能 / 过程与方法 / 情感态度价值观）
3. 教学重难点——heading + list
4. 教学准备——heading + list（含教具、课件、学具）
5. 教学过程——heading + 多个子 heading（环节名），每环节用 list 或 paragraph 给出
   「教师活动 / 学生活动 / 设计意图 / 时间分配」四要素
6. 板书设计——heading + paragraph（用方框示意或等宽描述）
7. 作业设计——heading + list（分层：基础 / 拓展）
8. 教学反思——heading + paragraph（预留可填写区域，可写"（待课后填写）"）

## 两条硬约束（不遵守即判定失败）

**A. 时间分配必须自洽**：教学过程各环节的时间分配之和，**必须等于**教师填写的课堂时长
（教师未填写时按 45 分钟计）。写完后自己加一遍核对，不允许出现 5+10+15+12+10=52 这类错误。

**B. 必须给出例题链**：至少 **3 道**例题，每道都要有**完整的演算/解答过程**（分步写出，
不是只给答案），并体现**由易到难的梯度**（基础模仿 → 变式 → 综合应用）。
数学/物理/化学等演算型学科，例题用 `list` 或 `paragraph` 逐步写出步骤；
语文/英语/历史等学科，"例题"对应"样例分析 / 语段精读 / 材料解析"，同样要有完整分析过程。

## 函数 / 数据型内容：必须用 chart 块出图

数学（函数图像、几何图形）、物理（图像、图表）、化学（曲线）、地理（统计图）等学科，
**只要涉及函数或数据，就必须至少输出 1 个 `chart` 块**，让教案里真的有图。

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",              // function | line | bar
    "expression": "y = x^2 - 2x - 3", // function 时必填，展示在图上
    "xLabel": "x",
    "yLabel": "y",
    "points": [[-2,5],[-1,0],[0,-3],[1,-4],[2,-3],[3,0],[4,5]]  // 12~25 个采样点
  },
  "caption": "图1 二次函数 y=x²-2x-3 的图像"
}
```

- `kind='function'`：给 `expression` + `points`（自己按表达式算好 12~25 个 [x,y] 采样点，
  覆盖顶点与零点附近，范围要能看出图像特征）。
- `kind='bar'`：给 `categories`（分类名数组）+ `values`（数值数组）。
- `kind='line'`：给 `points`。
- **不要**用 image 块的"建议配图：XX"来糊弄——那个渲染出来只有一行字。

## 范围约束

**只生成一节课（1 课时）的内容。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整。
凡 AI 推断的课时数、例题数据等不确定点，写入 `verifyHints`。
$pt$);

-- =============================================================================
-- 二、PPT 课件：必须有图（chart 块）
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:ppt', $pt$
# 文档类型：PPT 课件（ppt）

输出一份幻灯片课件，用 `slides` 数组表达，每页 slide 含 `title` 与 `body`（DocBlock 列表）与
可选 `notes`（演讲者备注）与 `layout`（title|content|two_col|section）。

要求：
- 页数 ≥ 8 页（内容允许时做到 12~15 页更好），逻辑顺序：封面 → 目标 → 新知导入 → 2~4 个知识页 → 例题/活动 → 小结 → 作业；
- 每页 `body` 用 heading / list / paragraph / table / **chart** 等块，避免大段纯文字；
- `notes` 给教师一句"怎么讲"：开场白、易错提醒、互动提问；
- 关键概念、公式、对比可用 table 或 callout 块突出；
- 不确定处（如例题数据）写入 `verifyHints`。

## ⚠️ 每份 PPT 至少要有 1 个 chart 块（这是"课件里有图"的关键）

数学（函数图像、几何）、物理（运动/电学图像）、化学（曲线）、地理/生物（统计）等，
**必须**用 `chart` 块把图画出来，而不是写一句"建议配图：XX"（那样导出的 PPT 里一张图都没有）。

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",                 // function | line | bar
    "expression": "y = x^2 - 2x - 3",   // function 时必填
    "xLabel": "x",
    "yLabel": "y",
    "points": [[-2,5],[-1,0],[0,-3],[1,-4],[2,-3],[3,0],[4,5]]
  },
  "caption": "图1 二次函数图像：开口向上，对称轴 x=1，顶点 (1,-4)"
}
```

- `kind='function'`：给 `expression` + 12~25 个 `[x,y]` 采样点（覆盖顶点、零点、与坐标轴交点）；
- `kind='bar'`：给 `categories` + `values`；
- `kind='line'`：给 `points`。
- 关键取值（顶点坐标、零点、截距）另外用 `table` 或 `list` 列一份，方便教师板书。

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`
$pt$);

-- =============================================================================
-- 三、课件 2D：同样要求 chart 块
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:courseware_2d', $pt$
# 文档类型：课件（2D / 伪 3D）（courseware_2d）

输出一节以图文为主的互动式 2D 课件，用 `blocks` 富文本表达，强调"边看边学"的版式：

- 开场用 heading 说明本节目标；
- 每个知识点用 paragraph + **chart**（函数/数据型内容必须出图）+ callout（提示/易错）组织；
- 关键对比、步骤、数据用 table 块或 `kind='bar'` 的 chart 块；
- 每 2~3 个知识点插入一个 list 形式的"想一想/做一做"小活动；
- 结尾 heading"本节课小结"+ paragraph 总结；
- 不确定处写入 `verifyHints`。

## chart 块用法（**不要用"建议配图：XX"糊弄**）

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",
    "expression": "s = 5t^2",
    "xLabel": "t/s",
    "yLabel": "s/m",
    "points": [[0,0],[1,5],[2,20],[3,45]]
  },
  "caption": "图1 自由落体位移—时间图像"
}
```

`kind` 取 `function`（给 expression + points）/ `line`（给 points）/ `bar`（给 categories + values）。

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0027_geometry_kernel.sql ===================
-- =============================================================================
-- 0027_geometry_kernel.sql
-- 3D 几何体：数值标注改由**平台确定性计算**，不再采信 AI 直接给的数值
--
-- 背景（客户硬要求，追加 A）：
--   `scene.params` 与 `scene.annotations` 都是模型直接输出的。AI 写"底面边长 2"就标 2，
--   但画出来的比例可能根本不是 2。数学/物理老师一眼看穿——**这不是体验问题，是教学事故**。
--   客户要本人出镜讲这个功能，产物里出一个错的标注就是公开处刑。
--
-- 平台侧（已随本次代码上线）：
--   1. `params → resolveDims → computeFacts`：按几何公式确定性算出棱长/半径/高/表面积/体积/母线；
--   2. AI 原标注**只要含数字就剔除**，只保留"六个面""顶点与棱长"这类定性描述；
--   3. 三重自检：正文里若出现同一量的不同数值 → **剔除该标注**（题干 = 推导末步 = 模型标注）；
--   4. 形状无法识别 → 明确降级为「不标注数值」，不硬标；
--   5. 前端 / Edge 两端都用同一套内核，界面明确提示"标注已按几何关系自动校正"。
--
-- 本迁移做的事：改提示词，让 AI **配合**这套机制——
--   - 老老实实给尺寸参数（这是它真正该做的）；
--   - **不要再自己编数值标注**（编了也会被剔除，还浪费 token）；
--   - 定性描述照常给（会被保留）。
--
-- 纯改配置表，**不需要重新部署 Edge Function**。
-- =============================================================================

create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

select public.seed_prompt('doc_type', 'doc_type:courseware_3d', $pt$
# 文档类型：课件（3D 真 Three.js）（courseware_3d）

输出一节含可旋转 / 可拆解 3D 模型的课件。除 `blocks` 文字讲解外，必须提供 `scene`
（SceneDescriptor）结构化描述，供平台 ThreeViewer 渲染。

## ⚠️ 最重要的约束：scene.type 只有两个合法值

**你只能从这两个里面选，其它值一律不允许输出：**

| `scene.type` | 适用内容 | `scene.params` 约定 |
|---|---|---|
| `geometry` | 立体图形：正方体 / 长方体 / 球 / 圆柱 / 圆锥 / 正四棱锥 | 见下方「尺寸参数」 |
| `molecule` | 分子结构：水 / 二氧化碳 / 甲烷 / 氨 等 | `{ "atoms": [ { "element": "O"\|"H"\|"C"\|"N", "position": [x,y,z] } ] }` |

**严禁**输出 `function` / `globe` / `circuit` / `biology` / `physics` / `custom`
—— 平台目前渲染不了这些类型，输出它们等于给教师一个空壳。

## 📐 geometry 的尺寸参数（**这是你唯一需要给准的数字**）

平台的确定性内核会按几何公式自己算出棱长、半径、高、表面积、体积、母线，
**并把这些计算结果作为模型上的标注显示给老师**。所以你**必须**把尺寸参数给准：

| 形状 `shape` | 必给参数 |
|---|---|
| `box`（正方体 / 长方体） | `a`（长/棱长）；长方体另给 `b`（宽）、`c`（高） |
| `sphere`（球） | `r`（半径），或 `a`（直径） |
| `cylinder`（圆柱） | `r`（底面半径）、`h`（高） |
| `cone`（圆锥） | `r`（底面半径）、`h`（高） |
| `pyramid`（正四棱锥） | `a`（底面边长）、`h`（高） |

示例：`{ "shape": "cylinder", "r": 3, "h": 5 }`、`{ "shape": "box", "a": 2 }`（正方体棱长 2）。

**参数缺失时**平台会按单位尺寸计算并提示老师"AI 未给出尺寸参数"——所以尽量给全。

## 🚫 不要在 annotations 里写数值

`scene.annotations` **只写定性描述**（会被保留），例如：
`"六个面"`、`"顶点与棱长"`、`"底面与侧面"`、`"顶点、底面圆心"`。

**不要**写 `"棱长为 2"`、`"体积 8"`、`"表面积 24"` 这类带数字的标注：
平台不会采用 AI 给的数值（避免"AI 说 2、画出来不是 2"的教学事故），
带数字的标注会被直接剔除，**你写了也白写，还浪费篇幅**。

数值由平台算好后自动显示，并且会连公式一起给出（如 `体积 V = πr²h ≈ 141.37`），
老师能一眼看到"推导最后一步"。

## 如果本节内容既不是几何体、也不是分子

（例如：函数图像、物理原理、生物结构、电路连接等）

1. **照常输出高质量 `blocks` 文字讲解**——把知识点、步骤、易错点讲清楚，这是主体；
2. `scene` 仍要输出，但**只能用 `geometry`**，选一个最贴近的简单形状（如 box）；
3. **必须**在 `verifyHints` 中如实写明，例如：
   `建议教师核对：本平台 3D 目前仅支持「几何体」与「分子结构」两类模型，本节内容为函数图像，下方 3D 仅为示意模型，请以文字讲解为准。`
4. **绝对不要**假装输出了一个函数曲面或物理装置——宁可说明做不到，也不要给假的。

## 其它要求

- `scene.explodable`：是否支持点击拆解观察内部，默认 true；
- `scene.title`：场景标题，如「底面半径 3、高 5 的圆柱」；
- `blocks` 提供文字讲解（目标 / 知识点 / 操作步骤 / 小结），与 3D 模型呼应；
- `blocks` 里若要求解某道题，**算出来的结果必须与你给的 `params` 一致**
  （平台会做交叉校验，不一致的标注会被隐藏）；
- 凡 3D 参数由 AI 推断的，写入 `verifyHints`。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0028_lesson_plan_higher_order.sql ===================
-- =============================================================================
-- 0028_lesson_plan_higher_order.sql
-- 教案：强制标注**认知层级** + 高阶活动占比 + 课堂互动设计
--
-- 背景依据（学术背书，也是我们要拿来做抖音第一张牌的点）：
--   马萨诸塞大学 Amherst 2025 年研究分析了 **311 份教案 / 2230 个课堂活动**，
--   **约 90% 的课堂活动只停留在「记忆、背诵、复述」这类低阶认知层级**。
--   这是全行业公认的弱点，也是本平台教案最容易做出差异化的地方。
--
-- 要求（写进提示词，AI 生成时即被约束）：
--   1. 教学过程的**每个环节**必须标注布鲁姆六层认知层级（记忆/理解/应用/分析/评价/创造）；
--   2. 高阶（分析及以上）环节占比**不得低于 1/3**——不能整堂都是"朗读并背诵"；
--   3. **每个环节**必须有明确的课堂互动设计（提问链 / 小组讨论 / 动手任务 / 同伴互评…），
--      不能只是"教师讲授、学生听"；
--   4. 输出 `pedagogy` 汇总字段（bloomDistribution / higherOrderRatio / interactionTypes），
--      数据结构先行——前端展示层可以缓，但字段必须先有。
--
-- 纯改配置表（prompt_templates），**不需要重新部署 Edge Function**。
-- =============================================================================

create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- 一、教案主模板：加认知层级 / 高阶占比 / 互动设计三条硬约束
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:lesson_plan', $pt$
# 文档类型：教案（lesson_plan）

输出一份结构完整、可直接打印使用的教案，必须包含以下板块，用 `blocks` 富文本块表达：

1. 教学基本信息（学科 / 年级 / 课时 / 教材版本）——heading + paragraph
2. 教学目标——heading + list（分 知识与技能 / 过程与方法 / 情感态度价值观）
3. 教学重难点——heading + list
4. 教学准备——heading + list（含教具、课件、学具）
5. 教学过程——heading + 多个子 heading（环节名），每环节用 list 或 paragraph 给出
   「教师活动 / 学生活动 / 设计意图 / 时间分配」四要素
6. 板书设计——heading + paragraph（用方框示意或等宽描述）
7. 作业设计——heading + list（分层：基础 / 拓展）
8. 教学反思——heading + paragraph（预留可填写区域，可写"（待课后填写）"）

---

## 🧠 三条硬约束（不遵守即判定失败）

### A. 时间分配必须自洽
教学过程各环节的时间分配之和，**必须等于**教师填写的课堂时长
（教师未填写时按 45 分钟计）。写完后自己加一遍核对，不允许出现 5+10+15+12+10=52 这类错误。

### B. 必须给出例题链
至少 **3 道**例题，每道都要有**完整的演算/解答过程**（分步写出，不是只给答案），
并体现**由易到难的梯度**（基础模仿 → 变式 → 综合应用）。
数学/物理/化学等演算型学科，例题用 `list` 或 `paragraph` 逐步写出步骤；
语文/英语/历史等学科，"例题"对应"样例分析 / 语段精读 / 材料解析"，同样要有完整分析过程。

### C. 认知层级 + 课堂互动（**本平台教案的核心差异点**）

研究显示约 90% 的课堂活动只停留在"记忆、背诵、复述"这类低阶认知层级。
本平台要求**每一节教案都必须有实质性的高阶思维活动**。

**C1. 每个教学环节都要标 `bloom`（布鲁姆六层）**

教学过程的每个环节块上写 `bloom` 字段，取值只能是：

| 值 | 层级 | 典型活动 |
|---|---|---|
| `remember` | 记忆 | 背诵、复述、识别、回忆定义 |
| `understand` | 理解 | 解释、举例、归纳、用自己的话说 |
| `apply` | 应用 | 用公式解题、套用方法做新题 |
| `analyze` | 分析 | 比较异同、找因果、拆解结构、辨析易错（**高阶**） |
| `evaluate` | 评价 | 判断方案优劣、论证合理性、互评（**高阶**） |
| `create` | 创造 | 自编题目、设计实验、改编情境、综合建模（**高阶**） |

**C2. 高阶环节占比不得低于 1/3**

`analyze` / `evaluate` / `create` 三类环节的数量，**必须 ≥ 全部环节的 1/3**
（如 6 个环节至少 2 个、5 个环节至少 2 个）。
**不能整堂课都是"教师讲、学生听、然后朗读背诵"。**

**C3. 每个环节都要有 `interaction`（明确的课堂互动设计）**

不能只写"教师讲授"。每个环节必须给出**可执行的互动形式**，例如：
- 提问链：3~4 个层层递进的问题（从"是什么"到"为什么"到"如果…会怎样"）；
- 小组讨论：分组任务 + 明确的分工与汇报方式 + 时长；
- 动手任务：画图 / 测量 / 拼搭 / 实验 / 用数据验证猜想；
- 同伴互评：交换作业按给定量规互评；
- 错例辨析：给出典型错解，让学生找出错在哪、为什么错。

**C4. 输出 `pedagogy` 汇总字段**

```
"pedagogy": {
  "bloomDistribution": { "remember": 1, "understand": 1, "apply": 1, "analyze": 2, "create": 1 },
  "higherOrderRatio": 0.5,
  "interactionTypes": ["提问链", "小组讨论", "动手任务", "错例辨析"]
}
```

`higherOrderRatio` = 高阶环节数 / 全部环节数（保留两位小数），**必须 ≥ 0.34**。

---

## 函数 / 数据型内容：必须用 chart 块出图

数学（函数图像、几何图形）、物理（图像、图表）等学科，**只要涉及函数或数据，
就必须至少输出 1 个 `chart` 块**，让教案里真的有图。

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",
    "expression": "y = x^2 - 2x - 3",
    "xLabel": "x",
    "yLabel": "y",
    "points": [[-2,5],[-1,0],[0,-3],[1,-4],[2,-3],[3,0],[4,5]]
  },
  "caption": "图1 二次函数 y=x²-2x-3 的图像"
}
```

`kind` 取 `function`（给 expression + 12~25 个采样点）/ `line`（给 points）/ `bar`（给 categories + values）。
**不要**用 image 块的"建议配图：XX"来糊弄。

---

## 范围约束

**只生成一节课（1 课时）的内容。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整。
凡 AI 推断的课时数、例题数据等不确定点，写入 `verifyHints`。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);


-- =================== 0029_credit_cost_double.sql ===================
-- =============================================================================
-- 0029_credit_cost_double.sql
-- 全站积分成本 ×2（客户拍板）
--
-- 变更（app_type_profiles.credit_cost，唯一真相源）：
--
--   文档类：
--     lesson_plan    教案        2  →  4
--     office_doc     办公文档    2  →  4
--     ppt            PPT 课件    3  →  6
--     courseware_2d  课件（2D）  3  →  6
--     courseware_3d  课件（3D）  4  →  8
--
--   应用类（8 类 + 自动判断）：
--     auto                  自动判断       1 → 2
--     teaching_animation    教学动画       3 → 6
--     edu_tool              教育应用       2 → 4
--     teaching_game         教学游戏       3 → 6
--     interactive_courseware互动课件       2 → 4
--     data_collection       数据回收       2 → 4
--     ai_item_generation    AI命题         1 → 2
--     ai_paper_composition  AI组题         1 → 2
--     ai_lesson_plan        AI教案·大单元  1 → 2
--
-- ⚠️ 红线：积分数值只能走配置表（app_type_profiles.credit_cost），
--    代码不写死。本迁移是**真实来源**；`src/config/constants.ts` 的
--    APP_TYPES / DOC_TYPES.creditCost 与 Edge 侧 `DOC_TYPE_COST` 只是
--    「网络异常 / mock 模式」下的兜底展示值，已同步为同一套数字。
--
-- 幂等：`on conflict (app_type) do update`，可重复执行。
-- 部署：**改表即生效，不需要重新部署 Edge Function**。
-- =============================================================================

insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  -- ---- 文档类（原值来自 0019，本次 ×2）----
  ('lesson_plan',   '教案',        4, 'doc_type:lesson_plan',   20),
  ('office_doc',    '办公文档',    4, 'doc_type:office_doc',    24),
  ('ppt',           'PPT 课件',    6, 'doc_type:ppt',           21),
  ('courseware_2d', '课件（2D）',  6, 'doc_type:courseware_2d', 22),
  ('courseware_3d', '课件（3D）',  8, 'doc_type:courseware_3d', 23),
  -- ---- 应用类（原值来自 0005，本次 ×2）----
  ('auto',                   '自动判断',      2, '',                             0),
  ('teaching_animation',     '教学动画',      6, 'app_type:teaching_animation',    1),
  ('edu_tool',               '教育应用',      4, 'app_type:edu_tool',              2),
  ('teaching_game',          '教学游戏',      6, 'app_type:teaching_game',         3),
  ('interactive_courseware', '互动课件',      4, 'app_type:interactive_courseware',4),
  ('data_collection',        '数据回收',      4, 'app_type:data_collection',       5),
  ('ai_item_generation',     'AI命题',        2, 'app_type:ai_item_generation',    6),
  ('ai_paper_composition',   'AI组题',        2, 'app_type:ai_paper_composition',  7),
  ('ai_lesson_plan',         'AI教案·大单元', 2, 'app_type:ai_lesson_plan',        8)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 说明：真实计费一律由 `estimate_cost` / `reserve_credits` 读本表计算；
--       前端正常展示也走 `estimate_cost` RPC，因此**本迁移执行完立即生效**，
--       无需重新部署 Edge Function、也无需重新发布前端。
-- ---------------------------------------------------------------------------


-- =================== 0030_siliconflow_provider.sql ===================
-- =============================================================================
-- 0030_siliconflow_provider.sql
-- 新增硅基流动（SiliconFlow）供应商：OpenAI 兼容网关，一个 key 调 DeepSeek/Qwen/GLM 等。
-- 用途：客户先用硅基流动额度，余额用完再切回 DeepSeek。
--   现在：跑本迁移（硅基流动设为默认）+ 设 SILICONFLOW_API_KEY
--   以后切回 DeepSeek：设 DEEPSEEK_API_KEY + 跑本文件底部的「切回 DeepSeek」两段 UPDATE
-- 适配器已在 supabase/functions/_shared/llm/siliconflow.ts 实现（读 SILICONFLOW_API_KEY）。
-- =============================================================================

-- 1) 取消现有默认（partial unique index 保证只有一个 is_default=true）
update public.model_profiles set is_default = false where is_default;

-- 2) 插入/更新硅基流动默认模型行，并设为默认
--    model_id 用硅基流动托管的 DeepSeek 聊天模型 'deepseek-chat'（硅基流动不认 deepseek-v4-flash）
insert into public.model_profiles (
  id, provider, model_id, display_name, api_base, pricing,
  max_output_tokens, credits_per_call, is_default, enabled, sort_order
) values (
  'siliconflow-deepseek', 'siliconflow', 'deepseek-chat', '硅基流动·DeepSeek', '',
  '{"input":1.5,"cachedInput":0.05,"output":4.5,"peakMultiplier":2}'::jsonb,
  16000, 1, true, true, 10
)
on conflict (id) do update
  set provider          = excluded.provider,
      model_id          = excluded.model_id,
      display_name      = excluded.display_name,
      api_base          = excluded.api_base,
      pricing           = excluded.pricing,
      max_output_tokens  = excluded.max_output_tokens,
      credits_per_call  = excluded.credits_per_call,
      is_default        = excluded.is_default,
      enabled           = excluded.enabled,
      sort_order        = excluded.sort_order;

-- =============================================================================
-- 切回 DeepSeek（余额用完时执行）：取消硅基流动默认，恢复 deepseek-v4-flash 默认
-- 同时别忘了在 Supabase Secrets 设 DEEPSEEK_API_KEY。
-- =============================================================================
-- update public.model_profiles set is_default = false where is_default;
-- update public.model_profiles set is_default = true  where id = 'deepseek-v4-flash';


