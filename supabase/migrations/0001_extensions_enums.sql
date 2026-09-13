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
