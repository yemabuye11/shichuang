-- =============================================================================
-- 0044_credit_cost_quality_v2.sql
-- 「高质量生成」后的积分重定价 + 代充值 RPC 小数化修复
--
-- 背景（见 docs/CREDIT_AND_QUALITY_REVIEW.md，客户已拍板「按建议执行」）：
--   旧价是按「低质量、短输出」定的，提质后输出量 ×1.6~3，原价位撑不住。
--   本次按评审建议上调，覆盖提质后的真实成本（每积分成本约 ¥0.019，
--   教师年卡毛利仍 71%，最坏 53%，不亏）。
--
-- ⚠️ 客户最新指示（2026-09-15）：「3D 的先放一放」→ 3D 一律不动。
--    因此 courseware_3d **维持 8 分**（原建议是 8→10，暂不执行）。
--    3D 质量未达标前不建议收费，若想直接下架见文末「可选：下架 3D」的注释块。
--
-- 变更（app_type_profiles.credit_cost，唯一真相源）：
--
--   文档类：
--     lesson_plan    教案        4  →  6
--     ppt            PPT 课件    6  →  8
--     courseware_2d  课件（2D）  6  →  8
--     office_doc     办公文档    4  →  4   （不动，成本本就可控）
--     courseware_3d  课件（3D）  8  →  8   （不动，3D 搁置）
--
--   应用类：
--     auto                    自动判断       2 → 4
--     ai_lesson_plan          AI教案·大单元  2 → 6   （原先 2 分出 12k token，唯一亏损项）
--     ai_paper_composition    AI组题         2 → 4
--     interactive_courseware  互动课件       4 → 5
--     teaching_game           教学游戏       6 → 7
--     teaching_animation      教学动画       6 → 6   （评审未提，不动）
--     edu_tool                教育应用       4 → 4   （评审未提，不动）
--     data_collection         数据回收       4 → 4   （评审未提，不动）
--     ai_item_generation      AI命题         2 → 2   （评审未提，不动）
--
--   不在此次范围：daily_practice（每日一练）、exam_paper（组卷）
--     —— 两者各有自己的 system_config 计价表（practice / exam），改那里，别改这里。
--
-- 另附两件必须一起做的事：
--   二、月度支出阀兜底：确保 system_config.'limit'.monthlySpendCny >= 1000。
--      （0025 已从 100 抬到 1000；本次只做「不低于 1000」的兜底，不再往上动。
--        客户曾口头选「调到 500」，但 500 < 现网 1000，属于把停服阈值砍半，
--        与其「别轻易停服」的本意相反，故不执行。若坚持 500，把下面的 1000 改 500 即可。）
--   三、admin_adjust_credits 改 numeric：
--      原版（0009/0042）第二参是 integer，走的是 apply_credit 的 **integer 重载**，
--      该重载不写 credit_lots（积分批次），导致「后台代充值加的积分」在 FIFO 扣减时
--      没有批次可扣；且返回余额被截成整数。
--      0039 之后余额已是 numeric(10,2)，代充值必须走 numeric 重载才正确。
--
-- ⚠️ 红线：积分数值只能走配置表，代码不写死。
--    `src/config/constants.ts` 的 APP_TYPES / DOC_TYPES.creditCost 与 Edge 侧
--    DOC_TYPE_COST 只是「网络异常 / mock」下的兜底展示值 —— 需同步为同一套数字
--    （见文末「前端兜底值同步清单」，改代码不算本迁移范围，但要一起改）。
--
-- 幂等：`on conflict (app_type) do update`，可反复粘贴执行。
-- 生效：改表即生效，不需要重新部署 Edge Function、不需要重新发布前端。
-- 运行顺序：必须在 0042 之后（否则 0042 会把 integer 版的 admin_adjust_credits 建回来）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 一、积分重定价（app_type_profiles.credit_cost）
-- ---------------------------------------------------------------------------
insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  -- ---- 文档类 ----
  ('lesson_plan',   '教案',        6, 'doc_type:lesson_plan',   20),
  ('office_doc',    '办公文档',    4, 'doc_type:office_doc',    24),
  ('ppt',           'PPT 课件',    8, 'doc_type:ppt',           21),
  ('courseware_2d', '课件（2D）',  8, 'doc_type:courseware_2d', 22),
  ('courseware_3d', '课件（3D）',  8, 'doc_type:courseware_3d', 23),  -- 3D 搁置，维持 8
  -- ---- 应用类 ----
  ('auto',                   '自动判断',      4, '',                             0),
  ('teaching_animation',     '教学动画',      6, 'app_type:teaching_animation',    1),
  ('edu_tool',               '教育应用',      4, 'app_type:edu_tool',              2),
  ('teaching_game',          '教学游戏',      7, 'app_type:teaching_game',         3),
  ('interactive_courseware', '互动课件',      5, 'app_type:interactive_courseware',4),
  ('data_collection',        '数据回收',      4, 'app_type:data_collection',       5),
  ('ai_item_generation',     'AI命题',        2, 'app_type:ai_item_generation',    6),
  ('ai_paper_composition',   'AI组题',        4, 'app_type:ai_paper_composition',  7),
  ('ai_lesson_plan',         'AI教案·大单元', 6, 'app_type:ai_lesson_plan',        8)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 二、月度支出阀兜底（不低于 1000）
--     消费方：Edge `supabase/functions/_shared/cost.ts` 的 assertUnderMonthlyCap()
--             与数据库 RPC public.check_generation_allowed()（迁移 0008）
-- ---------------------------------------------------------------------------
update public.system_config
   set value = jsonb_set(
         coalesce(value, '{}'::jsonb),
         '{monthlySpendCny}',
         to_jsonb(greatest(coalesce((value ->> 'monthlySpendCny')::numeric, 1000), 1000)),
         true
       ),
       updated_at = now()
 where key = 'limit';

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
-- 三、admin_adjust_credits 改 numeric（后台代充值 / 手工补积分走正确链路）
--     1) drop 掉 integer 重载，避免「精确匹配 integer」抢在 numeric 前面被选中；
--     2) 建 numeric 重载，内部调 apply_credit(numeric) → 会正确写 credit_lots；
--     3) 返回值 / 内部变量全 numeric，小数余额不再被截断。
-- ---------------------------------------------------------------------------
drop function if exists public.admin_adjust_credits(uuid, integer, text);

create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_delta   numeric,
  p_memo    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance numeric;
begin
  if not exists (
    select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin'
  ) then
    raise exception '仅管理员可调整积分' using errcode = '42501';
  end if;

  if coalesce(p_delta, 0) = 0 then
    return jsonb_build_object('ok', false, 'balance', 0, 'message', '调整数量不能为 0');
  end if;

  begin
    v_balance := public.apply_credit(
      p_user_id     => p_user_id,
      p_delta       => p_delta,
      p_reason      => 'admin_adjust',
      p_ref_type    => 'admin',
      p_ref_id      => v_uid::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
      p_memo        => coalesce(nullif(trim(p_memo), ''), '管理员手动调整'),
      p_operator_id => v_uid
    );
  exception when others then
    return jsonb_build_object('ok', false, 'balance', 0, 'message', '调整失败：余额不足');
  end;

  return jsonb_build_object('ok', true, 'balance', v_balance, 'message', '已调整');
end;
$$;

grant execute on function public.admin_adjust_credits(uuid, numeric, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 四、可选：下架 3D（客户暂未拍板，先注释，需要时单独跑这两行）
--     3D 目前是「假 3D」，质量不达标却收 8 分，评审建议下架或暂停收费。
--     取消注释即可让 3D 从首页/生成页入口消失（数据不删，随时可开回来）。
-- ---------------------------------------------------------------------------
-- update public.app_type_profiles set enabled = false where app_type = 'courseware_3d';

-- =============================================================================
-- 自测说明（无 psql 实例，已人工逐条核对；客户在 SQL Editor 跑完按此复查）
--   1. 跑完查价格是否生效：
--        select app_type, label, credit_cost from public.app_type_profiles order by sort_order;
--      期望：教案 6 / PPT 8 / 2D 8 / 3D 8 / 办公 4 / 自动 4 / AI教案大单元 6 / AI组题 4 /
--            互动课件 5 / 教学游戏 7 / 其余不变。
--   2. 查月度阀：
--        select value ->> 'monthlySpendCny' from public.system_config where key = 'limit';
--      期望：>= 1000。
--   3. 查代充值函数签名（应只剩 numeric 版一个）：
--        select pg_get_function_identity_arguments(oid) from pg_proc
--         where proname = 'admin_adjust_credits';
--      期望：只有一行 p_user_id uuid, p_delta numeric, p_memo text。
--   4. 幂等：整段反复粘贴执行不报错（on conflict do update / do nothing / drop if exists）。
--   5. 生效范围：改表即生效，无需重新部署 Edge Function、无需重新发布前端。
-- =============================================================================
-- ---------------------------------------------------------------------------
-- 前端兜底值同步清单（改代码，不算本迁移，但必须一起改，否则断网/mock 时显示旧价）
--   文件：src/config/constants.ts
--     APP_TYPES 里 auto / teaching_animation / edu_tool / teaching_game /
--              interactive_courseware / data_collection / ai_item_generation /
--              ai_paper_composition / ai_lesson_plan 的 creditCost
--     DOC_TYPES 里 lesson_plan / office_doc / ppt / courseware_2d / courseware_3d 的 creditCost
--   文件：supabase/functions/_shared/cost.ts 的 DOC_TYPE_COST（若存在写死值）
--   改完跑：npx tsc --noEmit && npm run build
-- ---------------------------------------------------------------------------
