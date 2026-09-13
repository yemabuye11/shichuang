-- =============================================================================
-- 0027_geometry_kernel.sql
-- 3D 几何体：数值标注改由**平台确定性计算**，不再采信 AI 直接给的数值
--
-- 背景（客户硬要求，追加 A）：
--   `scene.params` 与 `scene.annotations` 都是模型直接输出的。AI 写"底面边长 2"就标 2，
--   但画出来的比例可能根本不是 2。数学/物理老师一眼看穿——**这不是体验问题，是教学事故**。
--   客户要本人出镜讲这个功能，产物里出一个错的标注就是公开处刑。
--
-- 平台侧（已随本次代码上线）：
--   1. `params → resolveDims → computeFacts`：按几何公式确定性算出棱长/半径/高/表面积/体积/母线；
--   2. AI 原标注**只要含数字就剔除**，只保留"六个面""顶点与棱长"这类定性描述；
--   3. 三重自检：正文里若出现同一量的不同数值 → **剔除该标注**（题干 = 推导末步 = 模型标注）；
--   4. 形状无法识别 → 明确降级为「不标注数值」，不硬标；
--   5. 前端 / Edge 两端都用同一套内核，界面明确提示"标注已按几何关系自动校正"。
--
-- 本迁移做的事：改提示词，让 AI **配合**这套机制——
--   - 老老实实给尺寸参数（这是它真正该做的）；
--   - **不要再自己编数值标注**（编了也会被剔除，还浪费 token）；
--   - 定性描述照常给（会被保留）。
--
-- 纯改配置表，**不需要重新部署 Edge Function**。
-- =============================================================================

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

select public.seed_prompt('doc_type', 'doc_type:courseware_3d', $pt$
# 文档类型：课件（3D 真 Three.js）（courseware_3d）

输出一节含可旋转 / 可拆解 3D 模型的课件。除 `blocks` 文字讲解外，必须提供 `scene`
（SceneDescriptor）结构化描述，供平台 ThreeViewer 渲染。

## ⚠️ 最重要的约束：scene.type 只有两个合法值

**你只能从这两个里面选，其它值一律不允许输出：**

| `scene.type` | 适用内容 | `scene.params` 约定 |
|---|---|---|
| `geometry` | 立体图形：正方体 / 长方体 / 球 / 圆柱 / 圆锥 / 正四棱锥 | 见下方「尺寸参数」 |
| `molecule` | 分子结构：水 / 二氧化碳 / 甲烷 / 氨 等 | `{ "atoms": [ { "element": "O"\|"H"\|"C"\|"N", "position": [x,y,z] } ] }` |

**严禁**输出 `function` / `globe` / `circuit` / `biology` / `physics` / `custom`
—— 平台目前渲染不了这些类型，输出它们等于给教师一个空壳。

## 📐 geometry 的尺寸参数（**这是你唯一需要给准的数字**）

平台的确定性内核会按几何公式自己算出棱长、半径、高、表面积、体积、母线，
**并把这些计算结果作为模型上的标注显示给老师**。所以你**必须**把尺寸参数给准：

| 形状 `shape` | 必给参数 |
|---|---|
| `box`（正方体 / 长方体） | `a`（长/棱长）；长方体另给 `b`（宽）、`c`（高） |
| `sphere`（球） | `r`（半径），或 `a`（直径） |
| `cylinder`（圆柱） | `r`（底面半径）、`h`（高） |
| `cone`（圆锥） | `r`（底面半径）、`h`（高） |
| `pyramid`（正四棱锥） | `a`（底面边长）、`h`（高） |

示例：`{ "shape": "cylinder", "r": 3, "h": 5 }`、`{ "shape": "box", "a": 2 }`（正方体棱长 2）。

**参数缺失时**平台会按单位尺寸计算并提示老师"AI 未给出尺寸参数"——所以尽量给全。

## 🚫 不要在 annotations 里写数值

`scene.annotations` **只写定性描述**（会被保留），例如：
`"六个面"`、`"顶点与棱长"`、`"底面与侧面"`、`"顶点、底面圆心"`。

**不要**写 `"棱长为 2"`、`"体积 8"`、`"表面积 24"` 这类带数字的标注：
平台不会采用 AI 给的数值（避免"AI 说 2、画出来不是 2"的教学事故），
带数字的标注会被直接剔除，**你写了也白写，还浪费篇幅**。

数值由平台算好后自动显示，并且会连公式一起给出（如 `体积 V = πr²h ≈ 141.37`），
老师能一眼看到"推导最后一步"。

## 如果本节内容既不是几何体、也不是分子

（例如：函数图像、物理原理、生物结构、电路连接等）

1. **照常输出高质量 `blocks` 文字讲解**——把知识点、步骤、易错点讲清楚，这是主体；
2. `scene` 仍要输出，但**只能用 `geometry`**，选一个最贴近的简单形状（如 box）；
3. **必须**在 `verifyHints` 中如实写明，例如：
   `建议教师核对：本平台 3D 目前仅支持「几何体」与「分子结构」两类模型，本节内容为函数图像，下方 3D 仅为示意模型，请以文字讲解为准。`
4. **绝对不要**假装输出了一个函数曲面或物理装置——宁可说明做不到，也不要给假的。

## 其它要求

- `scene.explodable`：是否支持点击拆解观察内部，默认 true；
- `scene.title`：场景标题，如「底面半径 3、高 5 的圆柱」；
- `blocks` 提供文字讲解（目标 / 知识点 / 操作步骤 / 小结），与 3D 模型呼应；
- `blocks` 里若要求解某道题，**算出来的结果必须与你给的 `params` 一致**
  （平台会做交叉校验，不一致的标注会被隐藏）；
- 凡 3D 参数由 AI 推断的，写入 `verifyHints`。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);
