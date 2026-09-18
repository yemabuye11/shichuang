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
--   2. 该行模型改为 SiliconFlow 实际支持的 deepseek-ai/DeepSeek-V3.2；
--   3. 不修改其他文档类型的模型路由。
-- =============================================================================

update public.model_profiles
   set model_id = 'deepseek-ai/DeepSeek-V3.2',
       display_name = '硅基流动·DeepSeek V3.2',
       api_base = '',
       enabled = true
 where id = 'siliconflow-deepseek';

update public.app_type_profiles
   set model_override = 'siliconflow-deepseek'
 where app_type = 'ppt';
