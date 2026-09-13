-- =============================================================================
-- 0023_3d_scope.sql
-- 3D 课件止血：把 `scene.type` 收缩到「真能渲染」的两类（geometry / molecule）
--
-- 背景（见 docs/QUALITY_BASELINE.md ① 确证结论）：
--   ThreeViewer 实际只实现了 geometry（基础几何体）与 molecule（球棍分子）两类真模型；
--   `function` 分支写死 sin·cos 曲面、完全不读 AI 给的表达式；
--   `globe` / `circuit` / `biology` / `physics` / `custom` 全部落到同一个
--   「蓝方块 + 4 个橙球」通用占位体。
--   → 结果是：老师点「3D 课件」（最贵的一档），拿到一个跟教学内容无关的假模型。
--
-- 处理原则（客户硬要求）：**宁可少一个功能，不能给一个假的。**
--   1. 提示词层面：只允许输出 geometry / molecule；
--   2. 兜底：若本节内容两者都不合适，允许用最贴近的简单几何体作**明确标注的示意模型**，
--      并在 verifyHints 里如实说明「当前 3D 仅支持几何体与分子结构」，不装作真模型；
--   3. 渲染层面（前端 ThreeViewer / Edge renderDoc）对不支持类型给诚实提示，不再画占位体。
--
-- 本文件只改配置表（prompt_templates），**不需要重新部署 Edge Function**即可生效。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 幂等 seed 助手（与 0011 / 0016 同实现；两文件末尾已 drop，这里 recreate 以便独立可重跑）
-- ---------------------------------------------------------------------------
create or replace function public.seed_prompt(
  p_kind    text,
  p_key     text,
  p_content text,
  p_by      uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version integer := 1;
begin
  select coalesce(max(version), 0) into v_version
    from public.prompt_templates
   where key = p_key;

  if v_version > 0 then
    v_version := v_version + 1;
  end if;

  update public.prompt_templates set is_active = false where key = p_key;

  insert into public.prompt_templates (kind, key, version, content, is_active, created_by)
  values (p_kind, p_key, v_version, p_content, true, p_by)
  on conflict do nothing;
end;
$$;

-- =============================================================================
-- doc_type:courseware_3d —— 收缩到 geometry / molecule
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:courseware_3d', $pt$
# 文档类型：课件（3D 真 Three.js）（courseware_3d）

输出一节含可旋转 / 可拆解 3D 模型的课件。除 `blocks` 文字讲解外，必须提供 `scene`
（SceneDescriptor）结构化描述，供平台 ThreeViewer 渲染。

## ⚠️ 最重要的约束：scene.type 只有两个合法值

**你只能从这两个里面选，其它值一律不允许输出：**

| `scene.type` | 适用内容 | `scene.params` 约定 |
|---|---|---|
| `geometry` | 立体图形：正方体 / 长方体 / 球 / 圆柱 / 圆锥 / 棱锥 | `{ "shape": "box"\|"sphere"\|"cylinder"\|"cone"\|"pyramid" }` |
| `molecule` | 分子结构：水 / 二氧化碳 / 甲烷 / 氨 等 | `{ "atoms": [ { "element": "O"\|"H"\|"C"\|"N", "position": [x,y,z] } ] }` |

**严禁**输出 `function` / `globe` / `circuit` / `biology` / `physics` / `custom`
—— 平台目前渲染不了这些类型，输出它们等于给教师一个空壳。

## 如果本节内容既不是几何体、也不是分子

（例如：函数图像、物理原理、生物结构、电路连接等）

1. **照常输出高质量 `blocks` 文字讲解**——把知识点、步骤、易错点讲清楚，这是主体；
2. `scene` 仍要输出，但**只能用 `geometry`**，选一个最贴近的简单形状（如 box）；
3. **必须**在 `verifyHints` 中如实写明，例如：
   `建议教师核对：本平台 3D 目前仅支持「几何体」与「分子结构」两类模型，本节内容为函数图像，下方 3D 仅为示意模型，请以文字讲解为准。`
4. **绝对不要**假装输出了一个函数曲面或物理装置——宁可说明做不到，也不要给假的。

## 其它要求

- `scene.explodable`：是否支持点击拆解观察内部，默认 true；
- `scene.annotations`：部件 / 知识点标注文字列表（显示在模型旁），2~6 条；
- `scene.title`：场景标题；
- `blocks` 提供文字讲解（目标 / 知识点 / 操作步骤 / 小结），与 3D 模型呼应；
- 凡 3D 参数（尺寸、比例、原子坐标）由 AI 推断的，写入 `verifyHints`。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾：与 0011 / 0016 保持一致，删除幂等助手
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);
