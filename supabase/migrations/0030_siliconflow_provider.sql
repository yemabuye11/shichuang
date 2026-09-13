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
