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
