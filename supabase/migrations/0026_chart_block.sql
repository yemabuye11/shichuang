-- =============================================================================
-- 0026_chart_block.sql
-- 新增 `chart` 图表块：让数学/物理课件里**真的有函数图像**
--
-- 背景（docs/QUALITY_BASELINE.md 提交 4）：
--   此前提示词要求"需要配图时 `image.src` 留空、只写一句『建议配图：XX』"，
--   结果生成的 PPT / 课件**一张真图都没有**——一节讲「二次函数图像」的数学课，
--   课件里没有函数图像。这是当时把 PPT 判为 ❌ 的**唯一致命伤**。
--
-- 解法：新增 `chart` 块类型，AI 只需输出**结构化数据**（函数采样点 / 分类数值），
--   平台用**纯内联 SVG** 画出来（不引 echarts / chart.js，不再重蹈 three 747KB 拖垮首屏的覆辙）。
--   前端 `DocRenderer` 与 Edge `renderDoc` 各自渲染，导出 docx/pptx 时降级为
--   「表达式 + 关键取值」文本，保证教师离线也能照着画到黑板上。
--
-- 本文件只改配置表（prompt_templates），**不需要重新部署 Edge Function**。
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

-- =============================================================================
-- 一、教案：函数/数据型内容必须配 chart 块
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:lesson_plan', $pt$
# 文档类型：教案（lesson_plan）

输出一份结构完整、可直接打印使用的教案，必须包含以下板块，用 `blocks` 富文本块表达：

1. 教学基本信息（学科 / 年级 / 课时 / 教材版本）——heading + paragraph
2. 教学目标——heading + list（分 知识与技能 / 过程与方法 / 情感态度价值观）
3. 教学重难点——heading + list
4. 教学准备——heading + list（含教具、课件、学具）
5. 教学过程——heading + 多个子 heading（环节名），每环节用 list 或 paragraph 给出
   「教师活动 / 学生活动 / 设计意图 / 时间分配」四要素
6. 板书设计——heading + paragraph（用方框示意或等宽描述）
7. 作业设计——heading + list（分层：基础 / 拓展）
8. 教学反思——heading + paragraph（预留可填写区域，可写"（待课后填写）"）

## 两条硬约束（不遵守即判定失败）

**A. 时间分配必须自洽**：教学过程各环节的时间分配之和，**必须等于**教师填写的课堂时长
（教师未填写时按 45 分钟计）。写完后自己加一遍核对，不允许出现 5+10+15+12+10=52 这类错误。

**B. 必须给出例题链**：至少 **3 道**例题，每道都要有**完整的演算/解答过程**（分步写出，
不是只给答案），并体现**由易到难的梯度**（基础模仿 → 变式 → 综合应用）。
数学/物理/化学等演算型学科，例题用 `list` 或 `paragraph` 逐步写出步骤；
语文/英语/历史等学科，"例题"对应"样例分析 / 语段精读 / 材料解析"，同样要有完整分析过程。

## 函数 / 数据型内容：必须用 chart 块出图

数学（函数图像、几何图形）、物理（图像、图表）、化学（曲线）、地理（统计图）等学科，
**只要涉及函数或数据，就必须至少输出 1 个 `chart` 块**，让教案里真的有图。

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",              // function | line | bar
    "expression": "y = x^2 - 2x - 3", // function 时必填，展示在图上
    "xLabel": "x",
    "yLabel": "y",
    "points": [[-2,5],[-1,0],[0,-3],[1,-4],[2,-3],[3,0],[4,5]]  // 12~25 个采样点
  },
  "caption": "图1 二次函数 y=x²-2x-3 的图像"
}
```

- `kind='function'`：给 `expression` + `points`（自己按表达式算好 12~25 个 [x,y] 采样点，
  覆盖顶点与零点附近，范围要能看出图像特征）。
- `kind='bar'`：给 `categories`（分类名数组）+ `values`（数值数组）。
- `kind='line'`：给 `points`。
- **不要**用 image 块的"建议配图：XX"来糊弄——那个渲染出来只有一行字。

## 范围约束

**只生成一节课（1 课时）的内容。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整。
凡 AI 推断的课时数、例题数据等不确定点，写入 `verifyHints`。
$pt$);

-- =============================================================================
-- 二、PPT 课件：必须有图（chart 块）
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:ppt', $pt$
# 文档类型：PPT 课件（ppt）

输出一份幻灯片课件，用 `slides` 数组表达，每页 slide 含 `title` 与 `body`（DocBlock 列表）与
可选 `notes`（演讲者备注）与 `layout`（title|content|two_col|section）。

要求：
- 页数 ≥ 8 页（内容允许时做到 12~15 页更好），逻辑顺序：封面 → 目标 → 新知导入 → 2~4 个知识页 → 例题/活动 → 小结 → 作业；
- 每页 `body` 用 heading / list / paragraph / table / **chart** 等块，避免大段纯文字；
- `notes` 给教师一句"怎么讲"：开场白、易错提醒、互动提问；
- 关键概念、公式、对比可用 table 或 callout 块突出；
- 不确定处（如例题数据）写入 `verifyHints`。

## ⚠️ 每份 PPT 至少要有 1 个 chart 块（这是"课件里有图"的关键）

数学（函数图像、几何）、物理（运动/电学图像）、化学（曲线）、地理/生物（统计）等，
**必须**用 `chart` 块把图画出来，而不是写一句"建议配图：XX"（那样导出的 PPT 里一张图都没有）。

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",                 // function | line | bar
    "expression": "y = x^2 - 2x - 3",   // function 时必填
    "xLabel": "x",
    "yLabel": "y",
    "points": [[-2,5],[-1,0],[0,-3],[1,-4],[2,-3],[3,0],[4,5]]
  },
  "caption": "图1 二次函数图像：开口向上，对称轴 x=1，顶点 (1,-4)"
}
```

- `kind='function'`：给 `expression` + 12~25 个 `[x,y]` 采样点（覆盖顶点、零点、与坐标轴交点）；
- `kind='bar'`：给 `categories` + `values`；
- `kind='line'`：给 `points`。
- 关键取值（顶点坐标、零点、截距）另外用 `table` 或 `list` 列一份，方便教师板书。

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`
$pt$);

-- =============================================================================
-- 三、课件 2D：同样要求 chart 块
-- =============================================================================
select public.seed_prompt('doc_type', 'doc_type:courseware_2d', $pt$
# 文档类型：课件（2D / 伪 3D）（courseware_2d）

输出一节以图文为主的互动式 2D 课件，用 `blocks` 富文本表达，强调"边看边学"的版式：

- 开场用 heading 说明本节目标；
- 每个知识点用 paragraph + **chart**（函数/数据型内容必须出图）+ callout（提示/易错）组织；
- 关键对比、步骤、数据用 table 块或 `kind='bar'` 的 chart 块；
- 每 2~3 个知识点插入一个 list 形式的"想一想/做一做"小活动；
- 结尾 heading"本节课小结"+ paragraph 总结；
- 不确定处写入 `verifyHints`。

## chart 块用法（**不要用"建议配图：XX"糊弄**）

```
{
  "id": "c1",
  "type": "chart",
  "chart": {
    "kind": "function",
    "expression": "s = 5t^2",
    "xLabel": "t/s",
    "yLabel": "s/m",
    "points": [[0,0],[1,5],[2,20],[3,45]]
  },
  "caption": "图1 自由落体位移—时间图像"
}
```

`kind` 取 `function`（给 expression + points）/ `line`（给 points）/ `bar`（给 categories + values）。

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);
