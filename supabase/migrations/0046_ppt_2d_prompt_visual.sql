-- =============================================================================
-- 0046_ppt_2d_prompt_visual.sql
-- PPT / 2D 课件提示词改为「必须出图」口径
--
-- 背景（客户原话「课件生成质量太简陋，要提升到可直接对外展示的水准」）：
--   0024 的 `doc_type:ppt` / `doc_type:courseware_2d` 曾明文要求
--   「image 的 src 留空，注明建议配图：XX」，等于**提示词自己把图关掉了**。
--   0026 把这两份重写成「必须用 chart 块出图」，0043 又解开了
--   `system_section:doc_output_format` 里漏掉 `chart` 的封印并补了内容下限。
--   本次是**最后一公里**：把图的要求从「整份至少 1 张」升级到
--   **「每一页 / 每一章都必须有图，纯文字页算不合格」**，并把 image 块的
--   内联 SVG data URI 写法写全（此前只在 doc_output_format 里提了一句，
--   ppt / 2d 两份自身没有可照抄的模板）。
--
-- ⚠️ 权威版本链（已逐份读过，确认 0030 没有覆盖这两份）：
--     `doc_type:ppt`           0016 → 0024 → 0026 → 0043 → **0046（本次）**
--     `doc_type:courseware_2d` 0016 → 0024 → 0026 → 0043 → **0046（本次）**
--   0030_siliconflow_provider.sql 全文**不含** prompt_templates / seed_prompt，
--   与本次无关，不存在"以 0030 为准"的情况。
--
-- ⚠️ 块类型口径以 0043 的 `system_section:doc_output_format` 为准（本次不改）：
--     `type` 只能取 heading / paragraph / list / table / image / callout / **chart**
--   chart 结构：`chart.kind` ∈ {function, line, bar}
--               function → `expression` + `points`([[x,y],...])
--               bar      → `categories`(string[]) + `values`(number[])
--               line     → `points`
--               `title`（图名，可选）/ `caption`（渲染在图下方）
--   渲染：`_shared/doc/render.ts` renderChartSvg() 出内联 SVG；
--         `image` 有 src 时渲染 <img>，无 src 时只渲染一个"建议配图"虚线框（等于没图）。
--
-- 本次改动（只动这两个 key）：
--   1. 每页 / 每章必须有图：除封面、目录外，每一页 slide 的 body 至少 1 个 chart 或 image；
--      2D 课件每一章至少 1 个 chart 或 image。纯文字页 / 无图章节判定不合格。
--   2. 图表优先：能用图表表达的数据与关系（函数、趋势、占比、分类对比、多组比较）
--      **必须**用 chart 块；**不许**把图表退化成文字表格。
--   3. 放开 image 块：src 允许且只允���内联 SVG 的 data URI（给出可照抄模板 + 编码规则）；
--      **禁止外链**（教室常断网必挂，也会被浏览器安全策略拦截）；
--      **禁止 src 留空**（渲染出来只有虚线框）。
--   4. 质量下限：PPT **≥ 12 页**、2D 课件 **≥ 6 个章节**；每页 / 每章必须有实质内容；
--      明确禁止「此处可展开」「教师可自行补充」这类占位句。
--
-- 红线（本次明确不碰）：
--   - 不动积分 / 价格（app_type_profiles.credit_cost、system_config 计价项）；
--   - 不动 3D：`doc_type:courseware_3d` 保持 0027 版本（客户指示「3D 一律搁置」）；
--   - 不动 daily_practice / exam_paper 的提示词；
--   - 不动 `system_section:*` 任何一节（0043 刚改过 doc_output_format，本次不重复改）；
--   - 不动前端 src/ 与 Edge 侧代码。
--
-- ⚠️ 三反引号（三个连续反引号）：本文件的**提示词正文**中没有出现三反引号。
--   原因：这些提示词将来若被搬进 TS 模板字符串（如 validate.ts / compose.ts 里
--   `fenceHint` 那种用单引号常量拼接的写法），三反引号会提前终止模板字符串。
--   本文件是纯 SQL（dollar-quote），本不受此限，但为保持一致与安全，
--   JSON 示例一律用 4 空格缩进表示，不写三个连续反引号组成的围栏。
--   提示词里要求模型输出 json 代码块的规则写在 `system_section:doc_output_format`，
--   由 0043 维护，本次不重复。
--
-- 幂等：DO 块内先 `update ... where key = ... and is_active`，
--       若该 key 一行都没有再 insert。可反复粘贴执行，不报错、不产生重复行。
-- 生效：改表即生效，不需要重新部署 Edge Function（60s 缓存后生效）。
-- =============================================================================

-- =============================================================================
-- 一、PPT 课件（doc_type:ppt）
-- =============================================================================
do $$
declare
  v_content text := $pt$
# 文档类型：PPT 课件（ppt）

输出一份幻灯片课件，用 `slides` 数组表达，每页 slide 含 `title` 与 `body`（DocBlock 列表）与
可选 `notes`（演讲者备注）与 `layout`（title|content|two_col|section）。

---

## 🖼 一、每页必须有图（本次最重要的要求）

**除封面页与目录页外，每一页 `body` 里都必须至少有一个「图」——一个 `chart` 块或
一个 `image` 块。全是文字块的页面判定为不合格页。**

- 一份 12 页的课件，至少 **10 页**带图（只有封面 + 目录允许无图）。
- 教师把课件投到教室大屏上时，**不允许出现连续 3 页纯文字**。
- 「图」只认 `chart` 和 `image` 两种块。写"建议配图：XX"、或把 `src` 留空，
  **都等于没有图**（渲染出来只是一个虚线框）。

### 图表优先原则：能用图表达的，不许退化成表格

凡是可以画成图表的数据或关系——函数图像、变化趋势、占比构成、分类对比、
多组数据比较、实验数据——**必须**用 `chart` 块画出来。

`table` 只留给两类场景：① 图表之外的关键取值补充（顶点坐标、零点、截距）；
② 纯结构化的文字对比（概念辨析、步骤清单）。
**不得**因为"画图麻烦"就把本该是图表的内容写成一张文字表格。

### `chart` 块（首选，平台会真的画出来）

    {
      "id": "c1",
      "type": "chart",
      "chart": {
        "kind": "function",
        "expression": "y = x^2 - 2x - 3",
        "xLabel": "x",
        "yLabel": "y",
        "points": [[-2,5],[-1,0],[0,-3],[1,-4],[2,-3],[3,0],[4,5]]
      },
      "caption": "图1 二次函数图像：开口向上，对称轴 x=1，顶点 (1,-4)"
    }

`kind` 三种取值：
- `function`（函数图像、几何描点）：给 `expression` + **12~25 个** `[x,y]` 采样点，
  取值范围要能看出图像特征（含顶点、零点、与坐标轴交点）；
- `bar`（分类对比、占比、统计）：给 `categories`（分类名数组）+ `values`（数值数组）；
- `line`（变化趋势）：给 `points`。

`chart.title` 可写图名；`caption` **必须**写清"这张图说明了什么"，不能只写"如图所示"。

### `image` 块（示意图，`src` 必须是内联 SVG 的 data URI）

无法用 `chart` 表达的示意图（实验装置、地理示意、生物结构、流程示意、小图标），
用 `image` 块，`src` 写一段**自己写出来的内联 SVG**（data URI 形式）：

    {
      "id": "i1",
      "type": "image",
      "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 200'%3E%3Crect width='320' height='200' fill='%23F7F9FC'/%3E%3Ccircle cx='160' cy='100' r='55' fill='none' stroke='%232F6BFF' stroke-width='3'/%3E%3Ctext x='160' y='106' text-anchor='middle' font-size='14' fill='%231B1F27'%3EA%3C/text%3E%3C/svg%3E",
      "caption": "图2 圆的对称性示意图：任意一条直径所在直线都是对称轴"
    }

编码与写法规则（不遵守图就显示不出来）：
- `<` → `%3C`，`>` → `%3E`，`#` → `%23`；属性引号一律用单引号 `'`，不要出现双引号；
- SVG 里**不要写中文**（编码容易出错），只用图形 + 数字 / 字母标注，说明写进 `caption`；
- 图形保持简单（矩形 / 圆 / 线段 / 箭头 / 少量标注），不要把整页板书塞进一张 SVG；
- **禁止外链**（`http://...` / `https://...`）：教室经常断网，外链必定加载失败，
  也会被浏览器安全策略拦掉；
- **禁止 `src` 留空**，也禁止写"待补 / 建议配图 / 略"：那渲染出来只是一个虚线框。

---

## 📏 二、质量下限（达不到即判定失败）

| 项目 | 最低要求 |
|---|---|
| 页数 | **≥ 12 页**（做到 15~18 页更好），**不超过 22 页** |
| 带图页 | 除封面 / 目录外，**每一页**都至少有 1 个 `chart` 或 `image` 块 |
| `chart` 总数 | **≥ 2 个**；数学 / 物理 / 化学 / 地理 / 生物等数据型学科 **≥ 3 个** |
| 每页正文 | 除封面外，每页 `body` **≥ 2 个块**，正文合计 **≥ 60 字** |
| 每页 notes | 每页都要有 `notes`，**≥ 30 字** |
| 表格 | 至少 **1 个 `table` 块**（关键取值 / 概念辨析 / 步骤清单） |
| 例题 / 活动 | 至少 **2 页**，不能整份只有概念页 |

**页面顺序（不得缺项）**：
封面 → 学习目标 → 情境导入 → 2~4 个知识讲解页 → 例题 / 活动页（≥2） → 易错提醒 → 课堂小结 → 作业布置。
其中**每个知识讲解页、每个例题页都必须带图**。

**每页都要"能直接投屏"**：
- 不要把一句话拆成一整页；每页要么讲清一个知识点，要么做完一道例题；
- `notes` 要给出教师**可以直接照着说的原话**：开场白怎么说、这一步要问什么、
  学生可能答错什么、怎么接话。

---

## 🚫 三、禁止出现

- **纯文字页**（封面 / 目录除外）；
- 「略」「同上」「……」「见课件」「此处插入图片 / 表格 / 视频」「此处可展开」
  「教师可自行补充」「学生自行阅读课本」等占位与施工标记；
- 把本该是图表的内容写成文字表格；
- `src` 为空或指向外链的 `image` 块；
- 整页只有一句标题、没有实质内容；把同一页内容换个说法复制成多页充数。

---

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

不确定处（如例题数据、教材页码）写入 `verifyHints`。
$pt$;
begin
  update public.prompt_templates
     set content = v_content
   where key = 'doc_type:ppt'
     and is_active;

  -- 兜底：该 key 一行都没有时（例如库被清空重建）插入初始版本
  if not exists (select 1 from public.prompt_templates where key = 'doc_type:ppt') then
    insert into public.prompt_templates (kind, key, version, content, is_active)
    values ('doc_type', 'doc_type:ppt', 1, v_content, true);
  end if;
end $$;

-- =============================================================================
-- 二、课件 2D（doc_type:courseware_2d）
-- =============================================================================
do $$
declare
  v_content text := $pt$
# 文档类型：课件（2D / 伪 3D）（courseware_2d）

输出一节以图文为主的互动式 2D 课件，用 `blocks` 富文本表达，强调"边看边学"的版式。

---

## 🖼 一、每个章节必须有图（本次最重要的要求）

**每一个章节（由一个 `heading` 且 `level=2` 引领的小节）都必须至少有一个「图」——
一个 `chart` 块或一个 `image` 块。整节只有文字的章节判定为不合格。**

- 一份 6 章节的课件，至少 **6 个**图（每章 ≥ 1 个）。
- **不允许出现连续 2 个没有图的章节。**
- 「图」只认 `chart` 和 `image` 两种块。写"建议配图：XX"、或把 `src` 留空，
  **都等于没有图**（渲染出来只是一行字或一个虚线框）。

### 图表优先原则：能用图表达的，不许退化成表格

凡是可以画成图表的数据或关系——函数图像、变化趋势、占比构成、分类对比、
多组数据比较、实验数据——**必须**用 `chart` 块画出来。

`table` 只留给两类场景：① 图表之外的关键取值补充（顶点坐标、零点、截距）；
② 纯结构化的文字对比（概念辨析、步骤清单）。
**不得**因为"画图麻烦"就把本该是图表的内容写成一张文字表格。

### `chart` 块（首选，平台会真的画出来）

    {
      "id": "c1",
      "type": "chart",
      "chart": {
        "kind": "function",
        "expression": "s = 5t^2",
        "xLabel": "t/s",
        "yLabel": "s/m",
        "points": [[0,0],[1,5],[2,20],[3,45],[4,80]]
      },
      "caption": "图1 自由落体位移—时间图像：位移与时间的平方成正比"
    }

`kind` 三种取值：
- `function`（函数图像、几何描点）：给 `expression` + **12~25 个** `[x,y]` 采样点；
- `bar`（分类对比、占比、统计）：给 `categories`（分类名数组）+ `values`（数值数组）；
- `line`（变化趋势）：给 `points`。

`chart.title` 可写图名；`caption` **必须**写清"这张图说明了什么"，不能只写"如图所示"。

### `image` 块（示意图，`src` 必须是内联 SVG 的 data URI）

无法用 `chart` 表达的示意图（实验装置、地理示意、生物结构、流程示意、小图标），
用 `image` 块，`src` 写一段**自己写出来的内联 SVG**（data URI 形式）：

    {
      "id": "i1",
      "type": "image",
      "src": "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 200'%3E%3Crect width='320' height='200' fill='%23F7F9FC'/%3E%3Crect x='60' y='60' width='90' height='90' fill='none' stroke='%232F6BFF' stroke-width='3'/%3E%3Crect x='170' y='60' width='90' height='90' fill='none' stroke='%232F6BFF' stroke-width='3'/%3E%3Ctext x='105' y='175' text-anchor='middle' font-size='13' fill='%236B7280'%3EA%3C/text%3E%3Ctext x='215' y='175' text-anchor='middle' font-size='13' fill='%236B7280'%3EB%3C/text%3E%3C/svg%3E",
      "caption": "图2 面积对比示意图：A 与 B 两个正方形的边长为 3:2，面积比为 9:4"
    }

编码与写法规则（不遵守图就显示不出来）：
- `<` → `%3C`，`>` → `%3E`，`#` → `%23`；属性引号一律用单引号 `'`，不要出现双引号；
- SVG 里**不要写中文**（编码容易出错），只用图形 + 数字 / 字母标注，说明写进 `caption`；
- 图形保持简单（矩形 / 圆 / 线段 / 箭头 / 少量标注），不要把整页板书塞进一张 SVG；
- **禁止外链**（`http://...` / `https://...`）：教室经常断网，外链必定加载失败，
  也会被浏览器安全策略拦掉；
- **禁止 `src` 留空**，也禁止写"待补 / 建议配图 / 略"：那渲染出来只是一个虚线框。

---

## 📏 二、质量下限（达不到即判定失败）

| 项目 | 最低要求 |
|---|---|
| 章节数 | **≥ 6 个章节**（每个章节 = 一个 `heading` 且 `level=2` 引领的小节） |
| 每章配图 | 每一章 **≥ 1 个** `chart` 或 `image` 块 |
| `chart` 总数 | **≥ 2 个**；函数 / 数据 / 对比型内容必须出 `chart` |
| 每章正文 | 每章「讲解 + 例子 + 提示」合计 **≥ 150 字** |
| 全文正文 | **≥ 1200 字** |
| 互动活动 | **≥ 2 个**「想一想 / 做一做」，每个写清任务要求与预期答案要点 |
| 课堂小结 | 结尾 `heading` "本节课小结" + `paragraph` **≥ 150 字** |
| 课后练习 | 结尾 `heading` "课后练习" + `list`（**≥ 3 题**） |

**结构（不得缺项）**：
1. 开场 `heading`：本节学习目标（≥ 3 条，每条 ≥ 20 字）；
2. **≥ 6 个章节**，每章 = `paragraph` 讲解 → `chart` / `image` 出图 → `callout` 提示易错点；
3. 每 2~3 个章节插入一个 `list` 形式的「想一想 / 做一做」；
4. 结尾 `heading` "本节课小结" + `paragraph`；
5. 结尾 `heading` "课后练习" + `list`（≥ 3 题）。

---

## 🚫 三、禁止出现

- **无图章节**；
- 「略」「同上」「……」「此处插入图片 / 动画 / 视频」「此处可展开」「学生自行阅读课本」
  「教师可自行补充」等占位与施工标记；
- 把本该是图表的内容写成文字表格；
- `src` 为空或指向外链的 `image` 块；
- 只有标题没有讲解、只有要点没有展开。

---

## 范围约束

**只生成一节课（1 课时）的课件。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

（2D 课件的可视化由富文本编辑器 + 静态图形渲染；本批只需结构化 blocks。）
$pt$;
begin
  update public.prompt_templates
     set content = v_content
   where key = 'doc_type:courseware_2d'
     and is_active;

  -- 兜底：该 key 一行都没有时（例如库被清空重建）插入初始版本
  if not exists (select 1 from public.prompt_templates where key = 'doc_type:courseware_2d') then
    insert into public.prompt_templates (kind, key, version, content, is_active)
    values ('doc_type', 'doc_type:courseware_2d', 1, v_content, true);
  end if;
end $$;

-- =============================================================================
-- 自测说明（本机无 Postgres 实例，已人工逐字核对；客户在 Supabase SQL Editor
--           跑完后按下面步骤复查）
--
-- ⚠️ 字段名更正：`public.prompt_templates` 的列是 **`content`**，不是 `value`
--    （表结构见 0005：id / kind / key / version / content / is_active /
--     created_at / created_by）。查内容请用 content。
--
-- 1. 确认 PPT 提示词已生效（重点看有没有"每页必须有图 / 每页至少 1 个 chart 或 image"）：
--      select key, version, is_active, content
--        from public.prompt_templates
--       where key = 'doc_type:ppt' and is_active;
--    期望：命中 1 行；content 中含
--      「除封面页与目录页外，每一页 `body` 里都必须至少有一个「图」」
--      「≥ 12 页」「chart 总数 ... ≥ 2 个」
--      「data:image/svg+xml」「禁止外链」「禁止 `src` 留空」
--
-- 2. 确认 2D 课件提示词已生效：
--      select key, version, is_active, content
--        from public.prompt_templates
--       where key = 'doc_type:courseware_2d' and is_active;
--    期望：命中 1 行；content 中含
--      「每一个章节 ... 都必须至少有一个「图」」「≥ 6 个章节」
--      「不允许出现连续 2 个没有图的章节」「data:image/svg+xml」
--
-- 3. 确认没有误伤其它提示词（本次只应改这两个 key）：
--      select key, version, is_active from public.prompt_templates order by key, version;
--    期望：doc_type:ppt / doc_type:courseware_2d 各只有 **1 行 is_active = true**
--          （0046 是原地 UPDATE，不新增版本行）；
--          doc_type:courseware_3d 仍是 0027 的内容、且 is_active = true（未动）；
--          lesson_plan / office_doc 仍为 0043 的内容（未动）；
--          system_section:doc_output_format 仍为 0043 的内容，含 `chart`（未动）。
--
-- 4. 幂等：整段反复粘贴执行不报错，且不产生重复行 ——
--      DO 块内先 update（where key = ... and is_active），
--      仅当该 key 完全不存在时才 insert，重复执行版本号不变、行数不变。
--
-- 5. 三反引号自检（防止提示词被搬进 TS 模板字符串时炸掉）：
--      提示词正文里搜索「三个连续反引号」应为 0 处（本文件只有这行注释提到它）；
--      JSON 示例一律用 4 空格缩进。
--
-- 6. 生效范围：改表即生效，60s 缓存后自动生效，**不需要重新部署 Edge Function、
--    不需要重新发布前端**。
--
-- 7. 未触碰清单（红线复核）：
--      app_type_profiles.credit_cost / system_config 计价项 —— 未出现在本文件；
--      courseware_3d —— 未出现；
--      daily_practice / exam_paper —— 未出现；
--      system_section:* —— 未出现；
--      src/ 与 supabase/functions/ —— 未改动。
-- =============================================================================
