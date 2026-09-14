-- =============================================================================
-- 0040_exam_paper.sql
-- T11「组卷」数据层：测验卷 / 题目 / 学生提交 三张表 + RLS + 服务端判分 RPC
--
-- 业务链路（详见后续 docs/PLAN_组卷.md）：
--   老师传原卷（或填 年级+科目+单元）→ AI 解析知识点 / 联网检索单元知识点 → 生成变式卷
--   → 一条 /e/{slug} 链接发给学生 → 学生**免登录**点开就做 → 客观题服务端判分、
--     主观题留待教师后台手动批改 → 教师看完成情况与每题正确率 / 主观均分 → 导出 Word/PPTX。
--
-- 与 T10「每日一练」的关系：
--   * 每日一练 = 日常客观题练习（按天）；组卷 = 正式测验卷（大题/分值/答题卡/含主观题）。
--   * 本迁移**复用 0038 的通用判分函数** public.practice_normalize_answer /
--     practice_judge_token / practice_answer_matches / practice_grade_question /
--     practice_answer_text（它们与具体表无关，只吃参数），避免重复实现。
--   * 数据结构独立（exam_* 前缀），不污染 practices 体系。
--
-- 设计约束（与 0017 / 0034 / 0035 / 0037 / 0038 完全一致）：
--   1) RLS 全表开启，无一例外；
--   2) 新 RPC 一律 `security definer` + `set search_path = public` + 函数体内做身份校验；
--   3) 积分数值只读 app_type_profiles.credit_cost 与 system_config.exam，本迁移不写死价格、
--      不调用 reserve_credits / settle_generation / refund_generation（积分由 Edge 侧结算）；
--   4) 幂等：create ... if not exists / drop ... if exists + create / on conflict do update /
--      整段反复粘贴运行不报错。
--
-- 答案安全（验收清单）：
--   * exam_paper_questions.answer / explanation 只存服务端；
--   * anon 只能通过白名单 RPC 触达：get_exam_paper_for_student（列白名单，绝不返回 answer）。
--   * exam_paper_submissions 不给 anon 任何表级策略，写入只走 submit_exam_paper_answer。
--
-- ⚠️ 本项目真实踩过的坑：
--   * PostgreSQL 的 encode() 只支持 base64 / hex / escape，没有 sha256；本文件不使用。
--   * 枚举加值须先单独提交（见 0040a_enum_exam_paper.sql），否则报 55P04。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. ⚠️ 前置依赖：枚举值 'exam_paper' 已由 **0040a_enum_exam_paper.sql** 单独提交。
--    运行顺序：先 0040a → 再本文件 0040 →（若未跑过）0038a/0038/0039。三者均可反复重跑。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. 内容类型定价：组卷 = 2 积分 / 套（基准价，按题量在 Edge 侧再折算）
--    model_override 留 null（默认走 model_profiles.is_default）。后台「内容类型积分」可直接改。
-- ---------------------------------------------------------------------------
insert into public.app_type_profiles
  (app_type, label, credit_cost, model_override, prompt_key, sort_order, enabled)
values
  ('exam_paper', '组卷', 2, null, 'app_type:exam_paper', 40, true)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order,
      enabled     = excluded.enabled;

-- ---------------------------------------------------------------------------
-- 2. system_config 键 `exam`：各题型单题积分 / 题量阶梯折扣 / 上传识别积分 / 默认大题结构
--    口径（PLAN §5）：客观题便宜、主观题贵；题越多单套越便宜（阶梯折扣）。后台可改，代码零改动。
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('exam', jsonb_build_object(
    'questionCost',        jsonb_build_object('choice', 0.1, 'fill', 0.1, 'judge', 0.08, 'subjective', 0.25),
    'bulkTiers',           jsonb_build_array(
                              jsonb_build_object('min', 1,  'discount', 1),
                              jsonb_build_object('min', 20, 'discount', 0.9),
                              jsonb_build_object('min', 40, 'discount', 0.8)
                            ),
    'minDiscount',         0.6,
    'importCostCredits',   0.5,
    'defaultQuestionCount', 20
  ), '组卷配置：各题型单题积分 / 题量阶梯折扣 / 上传识别积分 / 默认题量')
on conflict (key) do update
  set value       = excluded.value,
      description = excluded.description,
      updated_at  = now();

-- ---------------------------------------------------------------------------
-- 3. 表结构
--    3.1 exam_papers：一套测验卷
-- ---------------------------------------------------------------------------
create table if not exists public.exam_papers (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  title               text not null,
  subject             text,
  grade               text,
  -- 教材版本（0013 textbook_versions）；AI 生成路径可写，上传路径可为 null。不加外键（理由同 0038）。
  textbook_version_id uuid null,
  -- 单元（如「第一单元」「第二单元」）；组卷按 年级+科目+单元 生成，故单元是关键定位字段
  unit                text,
  chapter             text,
  day_count           int  not null default 1,
  -- 'ai' = AI 生成（原卷解析或知识点生成）；'upload' = 老师上传（AI 识别）
  source              text not null default 'ai' check (source in ('ai', 'upload')),
  -- 'draft'=未发布；'published'=可作答；'closed'=已关闭作答
  status              text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  share_slug          text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  credit_cost         numeric null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table  public.exam_papers is '组卷·测验卷：一套卷 = 若干大题（含客观+主观），一条 /e/{share_slug} 链接发给学生';
comment on column public.exam_papers.unit is '单元定位（如 第一单元/第二单元）；组卷按 年级+科目+单元 生成';
comment on column public.exam_papers.status is 'draft=未发布；published=学生可作答；closed=已关闭作答（学生端一律拒绝）';
comment on column public.exam_papers.share_slug is '学生端链接短码 /e/{slug}，10 位随机，唯一';
comment on column public.exam_papers.credit_cost is '本次实际扣除积分快照；NULL=未计费';

create index if not exists exam_papers_owner_idx  on public.exam_papers (owner_id);
create index if not exists exam_papers_status_idx on public.exam_papers (status);

drop trigger if exists trg_exam_papers_touch on public.exam_papers;
create trigger trg_exam_papers_touch
  before update on public.exam_papers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
--    3.2 exam_paper_questions：题目
--        qtype：'choice' 选择 | 'fill' 填空 | 'judge' 判断 | 'subjective' 主观（简答/作文/应用）
--        section_no / section_title：大题分组（如 1 + "一、选择题"）
--        score：该题分值（numeric，支持 0.5 等）
--        knowledge_point：该题对应知识点（用于"同知识点变式"溯源与去重校验）
-- ---------------------------------------------------------------------------
create table if not exists public.exam_paper_questions (
  id              uuid primary key default gen_random_uuid(),
  paper_id        uuid not null references public.exam_papers (id) on delete cascade,
  section_no      int  not null default 1,
  section_title   text not null default '',
  seq             int  not null,
  qtype           text not null check (qtype in ('choice', 'fill', 'judge', 'subjective')),
  stem            text not null,
  options         jsonb null,
  answer          jsonb not null,
  explanation     text null,
  score           numeric not null default 1,
  knowledge_point text null,
  created_at      timestamptz not null default now()
);

comment on table  public.exam_paper_questions is '组卷·题目：answer/explanation 属敏感字段，仅服务端可见；subjective 的 answer 存参考答案/评分要点';
comment on column public.exam_paper_questions.section_no is '大题序号（1,2,3...），与 section_title 共同构成大题分组';
comment on column public.exam_paper_questions.score is '该题分值，numeric 支持 0.5';
comment on column public.exam_paper_questions.knowledge_point is '对应知识点，用于变式溯源与去重校验';

create index if not exists exam_paper_questions_paper_sec_idx
  on public.exam_paper_questions (paper_id, section_no, seq);

-- ---------------------------------------------------------------------------
--    3.3 exam_paper_submissions：学生提交
--        answers jsonb：字符串数组，下标 = 全部题目按 (section_no, seq) 排好的 0 基全局下标；
--                       客观题填选项字母/填空文本/判断；主观题填学生作答文本。
--        subjective_scores jsonb：{ question_id(text): 教师给分(numeric) }，主观题由教师后台手改。
--        score / total：仅客观题自动判分的结果（total=客观题数，score=客观答对题数）。
--        唯一约束 (paper_id, student_name)：同名学生重做覆盖，防刷提交。
-- ---------------------------------------------------------------------------
create table if not exists public.exam_paper_submissions (
  id                uuid primary key default gen_random_uuid(),
  paper_id          uuid not null references public.exam_papers (id) on delete cascade,
  student_name      text not null default '',
  answers           jsonb not null,
  subjective_scores jsonb not null default '{}'::jsonb,
  score             int  not null default 0,
  total             int  not null default 0,
  submitted_at      timestamptz not null default now(),
  constraint exam_paper_submissions_paper_student_key
    unique (paper_id, student_name)
);

comment on table  public.exam_paper_submissions is '组卷·学生提交：匿名也要存（完成名单用）；表级不给 anon 任何策略，写入只走 submit_exam_paper_answer';
comment on column public.exam_paper_submissions.subjective_scores is '主观题教师手改得分，{题目id:分数}；final = score + sum(subjective_scores)';
comment on column public.exam_paper_submissions.score is '客观题自动判分得分（不含主观）；total=客观题数';

create index if not exists exam_paper_submissions_paper_submitted_idx
  on public.exam_paper_submissions (paper_id, submitted_at);

-- ---------------------------------------------------------------------------
-- 4. RLS（红线：全表开启，无一例外）
-- ---------------------------------------------------------------------------
alter table public.exam_papers            enable row level security;
alter table public.exam_paper_questions   enable row level security;
alter table public.exam_paper_submissions enable row level security;

-- 4.1 exam_papers：本人 CRUD；管理员只读全部
drop policy if exists exam_papers_select_owner on public.exam_papers;
create policy exam_papers_select_owner on public.exam_papers
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists exam_papers_select_admin on public.exam_papers;
create policy exam_papers_select_admin on public.exam_papers
  for select to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists exam_papers_insert_owner on public.exam_papers;
create policy exam_papers_insert_owner on public.exam_papers
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists exam_papers_update_owner on public.exam_papers;
create policy exam_papers_update_owner on public.exam_papers
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists exam_papers_delete_owner on public.exam_papers;
create policy exam_papers_delete_owner on public.exam_papers
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- 4.2 exam_paper_questions：通过所属 paper 的 owner 判权；管理员只读；anon 无策略
drop policy if exists exam_paper_questions_select_owner on public.exam_paper_questions;
create policy exam_paper_questions_select_owner on public.exam_paper_questions
  for select to authenticated
  using (exists (select 1 from public.exam_papers p where p.id = exam_paper_questions.paper_id and p.owner_id = (select auth.uid())));

drop policy if exists exam_paper_questions_select_admin on public.exam_paper_questions;
create policy exam_paper_questions_select_admin on public.exam_paper_questions
  for select to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists exam_paper_questions_insert_owner on public.exam_paper_questions;
create policy exam_paper_questions_insert_owner on public.exam_paper_questions
  for insert to authenticated
  with check (exists (select 1 from public.exam_papers p where p.id = exam_paper_questions.paper_id and p.owner_id = (select auth.uid())));

drop policy if exists exam_paper_questions_update_owner on public.exam_paper_questions;
create policy exam_paper_questions_update_owner on public.exam_paper_questions
  for update to authenticated
  using (exists (select 1 from public.exam_papers p where p.id = exam_paper_questions.paper_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.exam_papers p where p.id = exam_paper_questions.paper_id and p.owner_id = (select auth.uid())));

drop policy if exists exam_paper_questions_delete_owner on public.exam_paper_questions;
create policy exam_paper_questions_delete_owner on public.exam_paper_questions
  for delete to authenticated
  using (exists (select 1 from public.exam_papers p where p.id = exam_paper_questions.paper_id and p.owner_id = (select auth.uid())));

-- 4.3 exam_paper_submissions：本人 + 管理员可读可删；无任何 insert/update 策略，也不给 anon
drop policy if exists exam_paper_submissions_select_owner on public.exam_paper_submissions;
create policy exam_paper_submissions_select_owner on public.exam_paper_submissions
  for select to authenticated
  using (exists (select 1 from public.exam_papers p where p.id = exam_paper_submissions.paper_id and p.owner_id = (select auth.uid())));

drop policy if exists exam_paper_submissions_select_admin on public.exam_paper_submissions;
create policy exam_paper_submissions_select_admin on public.exam_paper_submissions
  for select to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists exam_paper_submissions_delete_owner on public.exam_paper_submissions;
create policy exam_paper_submissions_delete_owner on public.exam_paper_submissions
  for delete to authenticated
  using (exists (select 1 from public.exam_papers p where p.id = exam_paper_submissions.paper_id and p.owner_id = (select auth.uid())));

drop policy if exists exam_paper_submissions_delete_admin on public.exam_paper_submissions;
create policy exam_paper_submissions_delete_admin on public.exam_paper_submissions
  for delete to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

-- ---------------------------------------------------------------------------
-- 5. RPC：学生端读题（列白名单，**绝不返回 answer / explanation**）
--    参数：p_slug = 分享短码；返回按 (section_no, seq) 排好的全部题目（含主观）。
--    约束：只返回 status='published' 的卷；草稿 / 已关闭 → 一行都不返回。
-- ---------------------------------------------------------------------------
create or replace function public.get_exam_paper_for_student(p_slug text)
returns table (
  paper_id      uuid,
  title         text,
  grade         text,
  subject       text,
  unit          text,
  chapter       text,
  status        text,
  section_no    integer,
  section_title text,
  seq           integer,
  qtype         text,
  stem          text,
  options       jsonb,
  score         numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select p.id, p.title, p.grade, p.subject, p.unit, p.chapter, p.status,
         q.section_no, q.section_title, q.seq, q.qtype, q.stem, q.options, q.score
    from public.exam_papers p
    join public.exam_paper_questions q on q.paper_id = p.id
   where p.share_slug = coalesce(p_slug, '')
     and p.status = 'published'
   order by q.section_no, q.seq;
end;
$$;

comment on function public.get_exam_paper_for_student(text) is '学生端（免登录）读题：只取已发布卷，列白名单不含 answer / explanation';

revoke all on function public.get_exam_paper_for_student(text) from public;
grant execute on function public.get_exam_paper_for_student(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC：提交作答并判分（anon 可用，客观题服务端判分；主观题留待教师后台批改）
--    参数：p_slug 分享短码 / p_student_name 昵称或学号后4位 / p_answers jsonb 全局下标数组
--    返回：{ok, objectiveScore, objectiveTotal, perQuestion:[bool|null], explanations:[text]}
--          subjective 题目 perQuestion 为 null（不参与自动判分）。
-- ---------------------------------------------------------------------------
create or replace function public.submit_exam_paper_answer(
  p_slug         text,
  p_student_name text,
  p_answers      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paper_id  uuid;
  v_status    text;
  v_name      text    := left(btrim(coalesce(p_student_name, '')), 50);
  v_answers   jsonb   := coalesce(p_answers, '[]'::jsonb);
  v_rec       record;
  v_idx       integer := 0;
  v_score     integer := 0;
  v_total     integer := 0;
  v_global    integer := 0;
  v_per       jsonb   := '[]'::jsonb;
  v_exp       jsonb   := '[]'::jsonb;
  v_student   text;
  v_correct   boolean;
begin
  -- 1) 定位卷
  select p.id, p.status into v_paper_id, v_status
    from public.exam_papers p
   where p.share_slug = coalesce(p_slug, '')
   limit 1;

  if v_paper_id is null then
    return jsonb_build_object('ok', false, 'error', '测验卷不存在');
  end if;
  if v_status <> 'published' then
    return jsonb_build_object('ok', false, 'error', '该测验卷已关闭');
  end if;

  -- 2) 按全局顺序逐题；客观题判分，主观题跳过（perQuestion 记 null）
  for v_rec in
    select q.qtype, q.answer, q.options, q.explanation
      from public.exam_paper_questions q
     where q.paper_id = v_paper_id
     order by q.section_no, q.seq
  loop
    v_global := v_global + 1;
    v_idx    := v_global - 1;
    if v_rec.qtype in ('choice', 'fill', 'judge') then
      v_total   := v_total + 1;
      v_student := public.practice_answer_text(v_answers, v_idx);
      v_correct := public.practice_grade_question(v_rec.qtype, v_rec.answer, v_student, v_rec.options);
      if v_correct then v_score := v_score + 1; end if;
      v_per := v_per || to_jsonb(v_correct);
      v_exp := v_exp || to_jsonb(coalesce(v_rec.explanation, ''));
    else
      -- 主观题：不参与自动判分
      v_per := v_per || to_jsonb(null);
      v_exp := v_exp || to_jsonb('');
    end if;
  end loop;

  if v_global = 0 then
    return jsonb_build_object('ok', false, 'error', '该卷没有题目');
  end if;

  -- 3) 写提交（覆盖式）；objective 部分入 score/total，subjective_scores 初始为空
  insert into public.exam_paper_submissions
    (paper_id, student_name, answers, subjective_scores, score, total, submitted_at)
  values
    (v_paper_id, v_name, v_answers, '{}'::jsonb, v_score, v_total, now())
  on conflict (paper_id, student_name) do update
    set answers      = excluded.answers,
        score        = excluded.score,
        total        = excluded.total,
        submitted_at = now();

  return jsonb_build_object(
    'ok',               true,
    'objectiveScore',   v_score,
    'objectiveTotal',   v_total,
    'perQuestion',      v_per,
    'explanations',     v_exp
  );
end;
$$;

comment on function public.submit_exam_paper_answer(text, text, jsonb) is '学生提交作答：客观题服务端判分（复用 practice_grade_question），主观题留待教师后台批改';

revoke all on function public.submit_exam_paper_answer(text, text, jsonb) from public;
grant execute on function public.submit_exam_paper_answer(text, text, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC：教师后台给某份提交的主观题打分（仅作者本人或管理员）
--    参数：p_submission_id / p_question_id / p_score(numeric)
--    返回：{ok:true, finalScore} / {ok:false, error}
--    说明：finalScore = 客观 score + 该提交 subjective_scores 各项之和。
-- ---------------------------------------------------------------------------
create or replace function public.set_exam_subjective_score(
  p_submission_id uuid,
  p_question_id   uuid,
  p_score         numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_new   jsonb;
  v_final numeric;
begin
  -- 1) 身份校验：该提交所属卷的作者
  select p.owner_id into v_owner
    from public.exam_paper_submissions s
    join public.exam_papers p on p.id = s.paper_id
   where s.id = p_submission_id;

  if v_owner is null
     or (v_owner <> (select auth.uid())
         and not exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'))
  then
    return jsonb_build_object('ok', false, 'error', '无权批改');
  end if;

  -- 2) 写入/更新该主观题得分（合并进 subjective_scores map）
  update public.exam_paper_submissions s
     set subjective_scores = coalesce(s.subjective_scores, '{}'::jsonb)
                             || jsonb_build_object(p_question_id::text, p_score)
   where s.id = p_submission_id;

  -- 3) 计算总分（客观 + 主观）
  select s.score + coalesce(
           (select sum(value::text::numeric)
              from jsonb_each_text(s2.subjective_scores)), 0)
    into v_final
    from public.exam_paper_submissions s2
   where s2.id = p_submission_id;

  return jsonb_build_object('ok', true, 'finalScore', coalesce(v_final, 0));
end;
$$;

comment on function public.set_exam_subjective_score(uuid, uuid, numeric) is '教师后台给主观题打分：合并进 subjective_scores，返回客观+主观总分；仅作者/管理员';

revoke all on function public.set_exam_subjective_score(uuid, uuid, numeric) from public;
grant execute on function public.set_exam_subjective_score(uuid, uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RPC：教师看板统计（仅作者本人或管理员）
--    返回：{ok, submissions:[{studentName, score, objectiveTotal, subjectiveTotal, finalScore, submittedAt}],
--           perQuestion:[{sectionNo, seq, qtype, stem, correctRate|avgScore}]}
-- ---------------------------------------------------------------------------
create or replace function public.list_exam_paper_stats(p_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subs     jsonb;
  v_per      jsonb;
begin
  if p_paper_id is null
     or not exists (
       select 1 from public.exam_papers p
        where p.id = p_paper_id
          and (p.owner_id = (select auth.uid())
               or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'))
     ) then
    return jsonb_build_object('ok', false, 'error', '无权查看');
  end if;

  -- 完成名单（含客观分 + 主观分合计 + 总分）
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'studentName',      s.student_name,
               'score',            s.score,
               'objectiveTotal',   s.total,
               'subjectiveTotal',  coalesce((select sum(value::text::numeric) from jsonb_each_text(s.subjective_scores)), 0),
               'finalScore',       s.score + coalesce((select sum(value::text::numeric) from jsonb_each_text(s.subjective_scores)), 0),
               'submittedAt',      s.submitted_at
             ) order by s.submitted_at desc
           ), '[]'::jsonb)
    into v_subs
    from public.exam_paper_submissions s
   where s.paper_id = p_paper_id;

  -- 每题统计：客观题=正确率；主观题=平均得分
  with qidx as (
    select q.id, q.paper_id, q.section_no, q.seq, q.qtype, q.stem,
           (row_number() over (partition by q.paper_id order by q.section_no, q.seq))::int - 1 as idx
      from public.exam_paper_questions q
     where q.paper_id = p_paper_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'sectionNo',  r.section_no,
               'seq',        r.seq,
               'qtype',      r.qtype,
               'stem',       r.stem,
               'metric',     r.metric
             ) order by r.section_no, r.seq
           ), '[]'::jsonb)
    into v_per
    from (
      select qi.section_no, qi.seq, qi.qtype, qi.stem,
             case
               when qi.qtype in ('choice', 'fill', 'judge') then
                 jsonb_build_object(
                   'type', 'correctRate',
                   'value', case when coalesce(cnt.day_total,0)=0 then 0::numeric
                                else round(cnt.correct_count::numeric / cnt.day_total, 4) end
                 )
               else
                 jsonb_build_object(
                   'type', 'avgScore',
                   'value', coalesce((
                     select avg((s.subjective_scores ->> qi.id::text)::numeric)
                       from public.exam_paper_submissions s
                      where s.paper_id = qi.paper_id
                        and s.subjective_scores ? qi.id::text
                   ), 0)
                 )
             end as metric
        from qidx qi
        left join (
          select qi2.id as qid,
                 (select count(*) from public.exam_paper_submissions d where d.paper_id = qi2.paper_id) as day_total,
                 (select count(*) from public.exam_paper_submissions d
                   where d.paper_id = qi2.paper_id
                     and public.practice_grade_question(qi2.qtype, qi2.answer,
                         public.practice_answer_text(d.answers, qi2.idx), qi2.options)
                 ) as correct_count
            from qidx qi2
           where qi2.qtype in ('choice','fill','judge')
        ) cnt on cnt.qid = qi.id
    ) r;

  return jsonb_build_object('ok', true, 'submissions', coalesce(v_subs, '[]'::jsonb), 'perQuestion', coalesce(v_per, '[]'::jsonb));
end;
$$;

comment on function public.list_exam_paper_stats(uuid) is '教师看板：完成名单（客观+主观总分）+ 每题统计（客观正确率/主观均分）；仅作者/管理员';

revoke all on function public.list_exam_paper_stats(uuid) from public;
grant execute on function public.list_exam_paper_stats(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. RPC：一键清空某次测验卷的全部提交（仅作者本人或管理员）
-- ---------------------------------------------------------------------------
create or replace function public.clear_exam_paper_submissions(p_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_paper_id is null
     or not exists (
       select 1 from public.exam_papers p
        where p.id = p_paper_id
          and (p.owner_id = (select auth.uid())
               or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'))
     ) then
    return jsonb_build_object('ok', false, 'error', '无权清空');
  end if;

  delete from public.exam_paper_submissions where paper_id = p_paper_id;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', coalesce(v_deleted, 0));
end;
$$;

comment on function public.clear_exam_paper_submissions(uuid) is '清空某次测验卷的全部学生提交；仅作者本人或管理员';

revoke all on function public.clear_exam_paper_submissions(uuid) from public;
grant execute on function public.clear_exam_paper_submissions(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. 授权兜底：循环补齐五个 RPC 的 grant execute
-- ---------------------------------------------------------------------------
do $$
declare
  f    record;
  v_to text;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'get_exam_paper_for_student',
         'submit_exam_paper_answer',
         'set_exam_subjective_score',
         'list_exam_paper_stats',
         'clear_exam_paper_submissions'
       )
  loop
    v_to := case
              when f.proname in ('get_exam_paper_for_student', 'submit_exam_paper_answer')
                then 'anon, authenticated, service_role'
              else 'authenticated, service_role'
            end;
    execute format('grant execute on function public.%I(%s) to %s', f.proname, f.args, v_to);
  end loop;
end $$;

-- =============================================================================
-- 自测说明（本机无 psql / 无 Supabase 实例，已人工逐条核对）
--   1. 幂等：全文只有 if not exists / create or replace / drop if exists + create / on conflict do update；
--      枚举加值在 0040a（独立提交），本文件不负责本枚举加值。
--   2. 去敏：get_exam_paper_for_student 的 returns table 只有
--      paper_id/title/grade/subject/unit/chapter/status/section_no/section_title/seq/qtype/stem/options/score，
--      **没有任何 answer / explanation 字段**；且 where 限定 status='published'。
--   3. RLS：三张表全部 enable row level security；exam_paper_submissions 只给了
--      select/delete 两类策略（owner + admin），**没有 insert/update 策略、没有给 anon 的策略**，
--      写入只能走 submit_exam_paper_answer。
--   4. 判分复用：客观题判分直接调用 0038 的 public.practice_grade_question /
--      public.practice_answer_text（表无关通用函数），不重复实现归一化/多空逻辑。
--   5. 主观题：submit 时不判分（perQuestion 记 null，total 仅计客观题）；
--      由 set_exam_subjective_score 由教师后台打分，finalScore = 客观 score + 主观合计。
--   6. RPC 红线：五个 RPC 全部 security definer + set search_path = public，
--      且先 revoke all from public 再按最小权限 grant execute。
--   7. 禁用 encode(x,'sha256')：全文未出现 encode 调用。
-- =============================================================================
