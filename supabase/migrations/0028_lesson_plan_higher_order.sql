-- =============================================================================
-- 0028_lesson_plan_higher_order.sql
-- 教案：强制标注**认知层级** + 高阶活动占比 + 课堂互动设计
--
-- 背景依据（学术背书，也是我们要拿来做抖音第一张牌的点）：
--   马萨诸塞大学 Amherst 2025 年研究分析了 **311 份教案 / 2230 个课堂活动**，
--   **约 90% 的课堂活动只停留在「记忆、背诵、复述」这类低阶认知层级**。
--   这是全行业公认的弱点，也是本平台教案最容易做出差异化的地方。
--
-- 要求（写进提示词，AI 生成时即被约束）：
--   1. 教学过程的**每个环节**必须标注布鲁姆六层认知层级（记忆/理解/应用/分析/评价/创造）；
--   2. 高阶（分析及以上）环节占比**不得低于 1/3**——不能整堂都是"朗读并背诵"；
--   3. **每个环节**必须有明确的课堂互动设计（提问链 / 小组讨论 / 动手任务 / 同伴互评…），
--      不能只是"教师讲授、学生听"；
--   4. 输出 `pedagogy` 汇总字段（bloomDistribution / higherOrderRatio / interactionTypes），
--      数据结构先行——前端展示层可以缓，但字段必须先有。
--
-- 纯改配置表（prompt_templates），**不需要重新部署 Edge Function**。
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
-- 一、教案主模板：加认知层级 / 高阶占比 / 互动设计三条硬约束
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

---

## 🧠 三条硬约束（不遵守即判定失败）

### A. 时间分配必须自洽
教学过程各环节的时间分配之和，**必须等于**教师填写的课堂时长
（教师未填写时按 45 分钟计）。写完后自己加一遍核对，不允许出现 5+10+15+12+10=52 这类错误。

### B. 必须给出例题链
至少 **3 道**例题，每道都要有**完整的演算/解答过程**（分步写出，不是只给答案），
并体现**由易到难的梯度**（基础模仿 → 变式 → 综合应用）。
数学/物理/化学等演算型学科，例题用 `list` 或 `paragraph` 逐步写出步骤；
语文/英语/历史等学科，"例题"对应"样例分析 / 语段精读 / 材料解析"，同样要有完整分析过程。

### C. 认知层级 + 课堂互动（**本平台教案的核心差异点**）

研究显示约 90% 的课堂活动只停留在"记忆、背诵、复述"这类低阶认知层级。
本平台要求**每一节教案都必须有实质性的高阶思维活动**。

**C1. 每个教学环节都要标 `bloom`（布鲁姆六层）**

教学过程的每个环节块上写 `bloom` 字段，取值只能是：

| 值 | 层级 | 典型活动 |
|---|---|---|
| `remember` | 记忆 | 背诵、复述、识别、回忆定义 |
| `understand` | 理解 | 解释、举例、归纳、用自己的话说 |
| `apply` | 应用 | 用公式解题、套用方法做新题 |
| `analyze` | 分析 | 比较异同、找因果、拆解结构、辨析易错（**高阶**） |
| `evaluate` | 评价 | 判断方案优劣、论证合理性、互评（**高阶**） |
| `create` | 创造 | 自编题目、设计实验、改编情境、综合建模（**高阶**） |

**C2. 高阶环节占比不得低于 1/3**

`analyze` / `evaluate` / `create` 三类环节的数量，**必须 ≥ 全部环节的 1/3**
（如 6 个环节至少 2 个、5 个环节至少 2 个）。
**不能整堂课都是"教师讲、学生听、然后朗读背诵"。**

**C3. 每个环节都要有 `interaction`（明确的课堂互动设计）**

不能只写"教师讲授"。每个环节必须给出**可执行的互动形式**，例如：
- 提问链：3~4 个层层递进的问题（从"是什么"到"为什么"到"如果…会怎样"）；
- 小组讨论：分组任务 + 明确的分工与汇报方式 + 时长；
- 动手任务：画图 / 测量 / 拼搭 / 实验 / 用数据验证猜想；
- 同伴互评：交换作业按给定量规互评；
- 错例辨析：给出典型错解，让学生找出错在哪、为什么错。

**C4. 输出 `pedagogy` 汇总字段**

```
"pedagogy": {
  "bloomDistribution": { "remember": 1, "understand": 1, "apply": 1, "analyze": 2, "create": 1 },
  "higherOrderRatio": 0.5,
  "interactionTypes": ["提问链", "小组讨论", "动手任务", "错例辨析"]
}
```

`higherOrderRatio` = 高阶环节数 / 全部环节数（保留两位小数），**必须 ≥ 0.34**。

---

## 函数 / 数据型内容：必须用 chart 块出图

数学（函数图像、几何图形）、物理（图像、图表）等学科，**只要涉及函数或数据，
就必须至少输出 1 个 `chart` 块**，让教案里真的有图。

```
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
  "caption": "图1 二次函数 y=x²-2x-3 的图像"
}
```

`kind` 取 `function`（给 expression + 12~25 个采样点）/ `line`（给 points）/ `bar`（给 categories + values）。
**不要**用 image 块的"建议配图：XX"来糊弄。

---

## 范围约束

**只生成一节课（1 课时）的内容。** 若教师要求"整学期 / 全册 / 整个单元 / 全套"，
只生成其中**第 1 课时**，并在 `verifyHints` 中说明：
`本平台一次生成一课时，请分次生成其余课时。`

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整。
凡 AI 推断的课时数、例题数据等不确定点，写入 `verifyHints`。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);
