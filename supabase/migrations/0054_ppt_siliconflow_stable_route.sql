-- =============================================================================
-- 0054_ppt_siliconflow_stable_route.sql
-- 修正 PPT 在只有 SILICONFLOW_API_KEY 时的模型路由。
--
-- 背景：
--   0052 将 ppt.model_override 设置为 deepseek-v4-flash，但线上未配置
--   DEEPSEEK_API_KEY，函数会回落到 SiliconFlow。SiliconFlow 不认
--   DeepSeek 官方的模型 ID，长 JSON 请求因此无增量或直接参数报错。
--
-- 修正：
--   1. PPT 直接覆盖到已存在的 siliconflow-deepseek 配置行；
--   2. 该行模型改为 SiliconFlow 实际支持、长 JSON 吞吐更稳定的
--      Qwen/Qwen3-30B-A3B-Instruct-2507；
--   3. 不修改其他文档类型的模型路由。
-- =============================================================================

update public.model_profiles
   set model_id = 'Qwen/Qwen3-30B-A3B-Instruct-2507',
       display_name = '硅基流动·Qwen3 30B 快速版',
       api_base = '',
       enabled = true
 where id = 'siliconflow-deepseek';

update public.app_type_profiles
   set model_override = 'siliconflow-deepseek'
 where app_type = 'ppt';
