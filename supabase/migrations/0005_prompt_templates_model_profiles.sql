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
