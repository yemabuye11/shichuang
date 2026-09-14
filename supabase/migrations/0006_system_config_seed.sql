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
    'register_gift', 100,
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
