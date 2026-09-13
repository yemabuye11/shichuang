-- =============================================================================
-- 0029_credit_cost_double.sql
-- 全站积分成本 ×2（客户拍板）
--
-- 变更（app_type_profiles.credit_cost，唯一真相源）：
--
--   文档类：
--     lesson_plan    教案        2  →  4
--     office_doc     办公文档    2  →  4
--     ppt            PPT 课件    3  →  6
--     courseware_2d  课件（2D）  3  →  6
--     courseware_3d  课件（3D）  4  →  8
--
--   应用类（8 类 + 自动判断）：
--     auto                  自动判断       1 → 2
--     teaching_animation    教学动画       3 → 6
--     edu_tool              教育应用       2 → 4
--     teaching_game         教学游戏       3 → 6
--     interactive_courseware互动课件       2 → 4
--     data_collection       数据回收       2 → 4
--     ai_item_generation    AI命题         1 → 2
--     ai_paper_composition  AI组题         1 → 2
--     ai_lesson_plan        AI教案·大单元  1 → 2
--
-- ⚠️ 红线：积分数值只能走配置表（app_type_profiles.credit_cost），
--    代码不写死。本迁移是**真实来源**；`src/config/constants.ts` 的
--    APP_TYPES / DOC_TYPES.creditCost 与 Edge 侧 `DOC_TYPE_COST` 只是
--    「网络异常 / mock 模式」下的兜底展示值，已同步为同一套数字。
--
-- 幂等：`on conflict (app_type) do update`，可重复执行。
-- 部署：**改表即生效，不需要重新部署 Edge Function**。
-- =============================================================================

insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  -- ---- 文档类（原值来自 0019，本次 ×2）----
  ('lesson_plan',   '教案',        4, 'doc_type:lesson_plan',   20),
  ('office_doc',    '办公文档',    4, 'doc_type:office_doc',    24),
  ('ppt',           'PPT 课件',    6, 'doc_type:ppt',           21),
  ('courseware_2d', '课件（2D）',  6, 'doc_type:courseware_2d', 22),
  ('courseware_3d', '课件（3D）',  8, 'doc_type:courseware_3d', 23),
  -- ---- 应用类（原值来自 0005，本次 ×2）----
  ('auto',                   '自动判断',      2, '',                             0),
  ('teaching_animation',     '教学动画',      6, 'app_type:teaching_animation',    1),
  ('edu_tool',               '教育应用',      4, 'app_type:edu_tool',              2),
  ('teaching_game',          '教学游戏',      6, 'app_type:teaching_game',         3),
  ('interactive_courseware', '互动课件',      4, 'app_type:interactive_courseware',4),
  ('data_collection',        '数据回收',      4, 'app_type:data_collection',       5),
  ('ai_item_generation',     'AI命题',        2, 'app_type:ai_item_generation',    6),
  ('ai_paper_composition',   'AI组题',        2, 'app_type:ai_paper_composition',  7),
  ('ai_lesson_plan',         'AI教案·大单元', 2, 'app_type:ai_lesson_plan',        8)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 说明：真实计费一律由 `estimate_cost` / `reserve_credits` 读本表计算；
--       前端正常展示也走 `estimate_cost` RPC，因此**本迁移执行完立即生效**，
--       无需重新部署 Edge Function、也无需重新发布前端。
-- ---------------------------------------------------------------------------
