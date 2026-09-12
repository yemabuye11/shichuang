-- =============================================================================
-- 0016_seed_doc_prompts.sql
-- T06 文档与课件生成：文档类（教案 / PPT / 课件2D / 课件3D / 办公文档）提示词种子
--   + 教材感知 system_section（T07 教材检索回填用）
--
-- 与 0011 同款幂等助手 public.seed_prompt，运行时被 generate 拼进 system 消息：
--   role → output_format → pedagogy → safety → code_quality
--        → textbook_aware（本文件新增） → doc_type:<kind>（本文件新增）
--
-- ⚠️ 文档类产物走「结构化 DocModel JSON」而非单文件 HTML（见 src/types/doc.ts），
--    因此 app_type:<kind> 的提示词与 0011 的 app_type 段不同：本文件要求输出 DocModel。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 幂等 seed 助手（与 0011 同实现；0011 末尾已 drop，这里 recreate 以便本文件独立可重跑）
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
-- 一、system_section：教材感知（T07 教材检索结果回填后生效；本批仅 seed 节，逻辑 T07）
-- =============================================================================
select public.seed_prompt('system_section', 'system_section:textbook_aware', $pt$
# 教材感知（让 AI 生成内容贴合教师所选教材版本与章节）

如果教师在请求中提供了「教材版本 / 年级 / 学科 / 章节」信息（由后台教材检索模块回填，
会出现在 user 消息的 {textbook_context} 占位符），你必须：

1. **锚定教材顺序**：知识点的先后、名称、例题口径严格对齐该教材对应章节，不得凭空编造
   课时编号或“第几单元”。
2. **难度贴合学段**：题目与讲解的难度、语言、生活情境必须符合该年级课标与认知水平。
3. **标注不确定点**：凡是教材版本信息缺失、或你对该版本某个细节（如具体页码、例题数据）
   无把握时，在 DocModel 的 `verifyHints` 数组里写明“建议教师核对：XX”，由教师人工确认。
4. **不越界**：不要因为缺失教材信息就拒绝生成——按通用教学逻辑给出合理默认，并在
   `verifyHints` 提示教师按需替换为实际教材内容。

教材信息由可信后台提供，不要质疑其真实性，直接使用即可。
$pt$);

-- =============================================================================
-- 二、doc_type：5 类文档子模板（输出目标均为 DocModel JSON，见 src/types/doc.ts）
--    通用 DocModel 结构（务必严格遵守字段，缺失字段用空或合理默认值）：
--    {
--      "id": "<产物id，后台注入>",
--      "kind": "<lesson_plan|ppt|courseware_2d|courseware_3d|office_doc>",
--      "meta": { "title","subject?","grade?","textbook?","author?","duration?","difficulty?" },
--      "blocks": [ { "id","type","level?","text?","ordered?","items?","rows?","header?","src?","caption?","align?" } ],
--      "slides": [ { "index","title","body":[DocBlock],"notes?","layout?" } ],   -- 仅 ppt
--      "scene":  { "type","params","explodable","annotations":[],"title?" },     -- 仅 courseware_3d
--      "verifyHints": [ "建议教师核对：..." ],
--      "version": 1,
--      "createdAt": "<ISO 时间，后台注入>"
--    }
--    输出约束：只输出一个 ```json 代码块，块外不得有任何文字；不得截断；不得含外部资源引用。
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
8. 教学反思——heading + paragraph（预留可填写区域，可写“（待课后填写）”）

排版要求：层级清晰、标题加粗（heading 的 level 区分 1/2/3）、表格规整；如涉及评分表等
结构化数据，可用 type=table 的 block 表达。凡 AI 推断的课时数、例题数据等不确定点，写入
`verifyHints`。
$pt$);

select public.seed_prompt('doc_type', 'doc_type:ppt', $pt$
# 文档类型：PPT 课件（ppt）

输出一份幻灯片课件，用 `slides` 数组表达，每页 slide 含 `title` 与 `body`（DocBlock 列表）与
可选 `notes`（演讲者备注）与 `layout`（title|content|two_col|section）。

要求：
- 页数 ≥ 8 页，逻辑顺序：封面 → 目标 → 新知导入 → 2~4 个知识页 → 例题/活动 → 小结 → 作业；
- 每页 `body` 用 heading / list / paragraph / image 等块，避免大段纯文字；
- `notes` 给教师一句“怎么讲”：开场白、易错提醒、互动提问；
- 关键概念、公式、对比可用 table 或 callout 块突出；
- 若需要配图，image 块的 `src` 留空并 `caption` 注明“建议配图：XX”，由教师后续上传；
- 不确定处（如例题数据）写入 `verifyHints`。
$pt$);

select public.seed_prompt('doc_type', 'doc_type:courseware_2d', $pt$
# 文档类型：课件（2D / 伪 3D）（courseware_2d）

输出一节以图文为主的互动式 2D 课件，用 `blocks` 富文本表达，强调“边看边学”的版式：

- 开场用 heading 说明本节目标；
- 每个知识点用 paragraph + image（caption 注明“建议配图/动画：XX”，src 留空）+ callout（提示/易错）组织；
- 关键对比、步骤、数据用 table 块；
- 每 2~3 个知识点插入一个 list 形式的“想一想/做一做”小活动；
- 结尾 heading“本节课小结”+ paragraph 总结；
- 需要动图/可交互演示的，用 callout 注明“建议在此插入 2D 动图/演示：XX”；
- 不确定处写入 `verifyHints`。

（2D 课件的可视化在 T08 由富文本编辑器 + 静态图形渲染；本批只需结构化 blocks。）
$pt$);

select public.seed_prompt('doc_type', 'doc_type:courseware_3d', $pt$
# 文档类型：课件（3D 真 Three.js）（courseware_3d）

输出一节含可旋转/可拆解 3D 模型的课件，除 `blocks` 富文本讲解外，必须提供 `scene`
（SceneDescriptor）结构化描述，供平台 ThreeViewer 渲染：

- `scene.type` 从 geometry|function|molecule|globe|circuit|biology|physics|custom 选一；
- `scene.params` 按 type 约定给出结构化参数（如 geometry 的 形状/尺寸、molecule 的分子式与
  原子坐标、function 的 表达式与区间）；
- `scene.explodable`：是否支持点击拆解观察内部（如细胞器、电路元件），默认尽量 true；
- `scene.annotations`：部件/知识点标注文字列表（显示在模型旁）；
- `scene.title`：场景标题。
- `blocks` 仍提供文字讲解（目标/知识点/操作步骤/小结），与 3D 模型呼应；
- 凡 3D 参数（如精确坐标、比例）由 AI 推断的，写入 `verifyHints`。

（真实 three.js 在前端懒加载渲染，本批只需给出可被解析的 scene 结构。）
$pt$);

select public.seed_prompt('doc_type', 'doc_type:office_doc', $pt$
# 文档类型：办公文档（office_doc）

输出一份教师日常办公文档（如：通知、计划、总结、发言稿、家长会文案、活动方案、阅卷说明等），
用 `blocks` 富文本表达，结构清晰、用语正式得体：

- 文档标题用 heading(level=1)；
- 正文分段用 paragraph；
- 要点、步骤、名单用 list（有序/无序按内容）；
- 涉及排期、分工、名单等可用 table；
- 如引用文件/模板，callout 注明“依据：XX 文件”；
- 落款、日期等用 paragraph 或 caption；
- 缺失的具体信息（如学校名、日期、人名）用占位并写入 `verifyHints`，不要编造真实机构名。

排版要求：层级分明、便于直接复制进 Word/WPS 使用。
$pt$);

-- ---------------------------------------------------------------------------
-- 收尾：与 0011 保持一致，删除幂等助手（后续若有 T08 文档导出模板可再次 recreate）
-- ---------------------------------------------------------------------------
drop function if exists public.seed_prompt(text, text, text, uuid);
