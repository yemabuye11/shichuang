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
