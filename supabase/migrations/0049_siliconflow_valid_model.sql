-- 0049_siliconflow_valid_model.sql
-- 目的：线上只有 SILICONFLOW_API_KEY 时，默认模型必须使用 SiliconFlow
--       支持的模型 ID；deepseek-chat 是 DeepSeek 官方兼容名，不是该平台模型名。
-- 幂等：可重复执行，不修改任何用户数据或积分流水。

update public.model_profiles
   set is_default = false
 where is_default = true;

insert into public.model_profiles (
  id, provider, model_id, display_name, api_base, pricing,
  max_output_tokens, credits_per_call, is_default, enabled, sort_order
) values (
  'siliconflow-deepseek',
  'siliconflow',
  'deepseek-ai/DeepSeek-V3.2',
  '硅基流动·DeepSeek V3.2',
  '',
  '{"input":1.5,"cachedInput":0.05,"output":4.5,"peakMultiplier":2}'::jsonb,
  16000,
  1,
  true,
  true,
  10
)
on conflict (id) do update
  set provider          = excluded.provider,
      model_id          = excluded.model_id,
      display_name      = excluded.display_name,
      api_base          = excluded.api_base,
      pricing           = excluded.pricing,
      max_output_tokens = excluded.max_output_tokens,
      credits_per_call  = excluded.credits_per_call,
      is_default        = excluded.is_default,
      enabled           = excluded.enabled,
      sort_order        = excluded.sort_order;
