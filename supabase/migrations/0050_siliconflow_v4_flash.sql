-- 0050_siliconflow_v4_flash.sql
-- 目的：将 SiliconFlow 默认模型切到官方当前的 DeepSeek V4 Flash，
--       在保持 DeepSeek 级别质量的同时缩短长 JSON 课件的生成等待。
-- 幂等：只更新模型配置，不修改用户数据、积分或历史产物。

update public.model_profiles
   set is_default = false
 where is_default = true;

update public.model_profiles
   set provider          = 'siliconflow',
       model_id         = 'deepseek-ai/DeepSeek-V4-Flash',
       display_name     = '硅基流动·DeepSeek V4 Flash',
       api_base         = '',
       max_output_tokens = 16000,
       enabled          = true,
       is_default       = true,
       sort_order       = 10
 where id = 'siliconflow-deepseek';
