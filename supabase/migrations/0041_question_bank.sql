-- =============================================================================
-- 0041_question_bank.sql
-- T11「组卷」配套：知识点表 + 题库表 + RLS + 四个服务端 RPC
--
-- 业务链路（承接 0040_exam_paper.sql）：
--   老师组卷（AI 生成 / 上传原卷变式 / 从题库挑）→ 每道题顺手沉淀进题库 →
--   下次组卷直接从题库按 学科/年级/单元/题型/知识点 挑题复用（usage_count 记使用次数）。
--
-- 设计约束（与 0034 / 0035 / 0037 / 0038 / 0040 完全一致）：
--   1) RLS 全表开启，无一例外；
--   2) 新 RPC 一律 `security definer` + `set search_path = public` + 函数体内做身份校验；
--   3) 四个 RPC **一律不授予 anon**（题库含答案，绝不能让未登录用户触达）；
--   4) 幂等：create ... if not exists / create or replace / drop policy if exists + create /
--      on conflict do nothing，整段反复粘贴运行不报错（客户在 SQL Editor 里可反复执行）。
--
-- 相对 0040 的两处**必要扩展**（已同步告知 lead）：
--   a) 0040 的 list_exam_paper_stats 只返回 studentName，**不带提交 id / 题目 id**，
--      教师后台没法调 set_exam_subjective_score 给主观题打分。本文件用
--      create or replace 补上 'submissionId' / 'questionId' / 'answers' 三个字段
--      （签名不变，前端无感；不改动判分逻辑）。
--   b) question_bank 在 lead 给的列清单之外多两列（都是可空/有默认，不影响既有数据）：
--      - knowledge_point text：AI 直接给的知识点文本（knowledge_point_id 为空时的兜底）；
--      - score numeric default 1：题目沉淀时保留分值，从题库组卷时可直接带出。
--
-- ⚠️ 运行顺序：0038a → 0038 → 0039 → 0040a → 0040 → **本文件 0041**。
--    本文件依赖 public.profiles(role)、public.touch_updated_at()（0013/0002 已建）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. knowledge_points：知识点（老师自建 / AI 解析沉淀）
--    is_public=true 的知识点可被全体登录教师读取（用于"共享知识点体系"）。
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_points (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  subject     text,
  grade       text,
  unit        text,
  name        text not null,
  description text,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table  public.knowledge_points is '组卷·知识点：老师自建或 AI 解析沉淀；is_public=true 时全体登录教师可读';
comment on column public.knowledge_points.unit is '所属单元（如 第一单元），与 subject/grade 共同定位';

create index if not exists knowledge_points_owner_idx on public.knowledge_points (owner_id);
create index if not exists knowledge_points_scope_idx
  on public.knowledge_points (subject, grade, unit);

-- ---------------------------------------------------------------------------
-- 2. question_bank：题库（组卷产出沉淀 + 老师手工录入）
--    answer / explanation 属敏感字段：仅 作者本人 / 公开题（全体登录教师）/ 管理员 可读。
-- ---------------------------------------------------------------------------
create table if not exists public.question_bank (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles (id) on delete cascade,
  -- 关联知识点（可空：AI 直接给文本、未建知识点行时为空）
  knowledge_point_id uuid null references public.knowledge_points (id) on delete set null,
  subject            text,
  grade              text,
  unit               text,
  qtype              text not null check (qtype in ('choice', 'fill', 'judge', 'subjective')),
  stem               text not null,
  options            jsonb null,
  answer             jsonb not null default '[]'::jsonb,
  explanation        text null,
  -- 难度：建议 'easy' / 'medium' / 'hard' 或中文 基础/提高；不做 check，避免 AI 文案被拒
  difficulty         text null,
  -- 扩展列（见文件头 b）：知识点文本兜底 + 沉淀时的分值
  knowledge_point    text null,
  score              numeric not null default 1,
  is_public          boolean not null default false,
  usage_count        integer not null default 0,
  created_at         timestamptz not null default now()
);

comment on table  public.question_bank is '组卷·题库：组卷产出自动沉淀 + 老师手工录入；含答案，RLS 严格限制可见范围';
comment on column public.question_bank.answer is '标准答案 jsonb 数组；填空多空用竖线 | 合并成同一元素（与判分函数约定一致）';
comment on column public.question_bank.knowledge_point is '知识点文本（knowledge_point_id 为空时的兜底展示/筛选用）';
comment on column public.question_bank.usage_count is '被组卷引用次数，用于"常用好题"排序';

create index if not exists question_bank_owner_idx on public.question_bank (owner_id);
create index if not exists question_bank_scope_idx  on public.question_bank (subject, grade, unit);
create index if not exists question_bank_qtype_idx  on public.question_bank (qtype);
create index if not exists question_bank_kp_idx     on public.question_bank (knowledge_point_id);

-- ---------------------------------------------------------------------------
-- 3. RLS（红线：全表开启，无一例外）
--    规则：作者本人 = 全部权限；is_public=true = 全体登录教师可读；管理员 = 全部权限。
-- ---------------------------------------------------------------------------
alter table public.knowledge_points enable row level security;
alter table public.question_bank    enable row level security;

-- 3.1 knowledge_points ----
drop policy if exists knowledge_points_select_owner on public.knowledge_points;
create policy knowledge_points_select_owner on public.knowledge_points
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists knowledge_points_select_public on public.knowledge_points;
create policy knowledge_points_select_public on public.knowledge_points
  for select to authenticated
  using (is_public = true);

drop policy if exists knowledge_points_select_admin on public.knowledge_points;
create policy knowledge_points_select_admin on public.knowledge_points
  for select to authenticated
  using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'));

drop policy if exists knowledge_points_insert_owner on public.knowledge_points;
create policy knowledge_points_insert_owner on public.knowledge_points
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists knowledge_points_update_owner on public.knowledge_points;
create policy knowledge_points_update_owner on public.knowledge_points
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists knowledge_points_delete_owner on public.knowledge_points;
create policy knowledge_points_delete_owner on public.knowledge_points
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists knowledge_points_admin_all on public.knowledge_points;
create policy knowledge_points_admin_all on public.knowledge_points
  for all to authenticated
  using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'))
  with check (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'));

-- 3.2 question_bank ----
drop policy if exists question_bank_select_owner on public.question_bank;
create policy question_bank_select_owner on public.question_bank
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists question_bank_select_public on public.question_bank;
create policy question_bank_select_public on public.question_bank
  for select to authenticated
  using (is_public = true);

drop policy if exists question_bank_select_admin on public.question_bank;
create policy question_bank_select_admin on public.question_bank
  for select to authenticated
  using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'));

drop policy if exists question_bank_insert_owner on public.question_bank;
create policy question_bank_insert_owner on public.question_bank
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      is_public = false
      or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin')
    )
  );

drop policy if exists question_bank_update_owner on public.question_bank;
create policy question_bank_update_owner on public.question_bank
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      is_public = false
      or exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin')
    )
  );

drop policy if exists question_bank_delete_owner on public.question_bank;
create policy question_bank_delete_owner on public.question_bank
  for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists question_bank_admin_all on public.question_bank;
create policy question_bank_admin_all on public.question_bank
  for all to authenticated
  using (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'))
  with check (exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'admin'));

-- ---------------------------------------------------------------------------
-- 4. RPC：题库检索（仅登录教师；**绝不给 anon**）
--    可见范围：自己的题 + is_public 的题（管理员可见全部）。
--    筛选：学科 / 年级 / 单元 / 题型 / 知识点 id；p_public_only=true 时只看公开题。
-- ---------------------------------------------------------------------------
create or replace function public.list_question_bank(
  p_subject            text default null,
  p_grade              text default null,
  p_unit               text default null,
  p_qtype              text default null,
  p_knowledge_point_id uuid default null,
  p_public_only        boolean default false
)
returns table (
  id                 uuid,
  owner_id           uuid,
  subject            text,
  grade              text,
  unit               text,
  qtype              text,
  stem               text,
  options            jsonb,
  answer             jsonb,
  explanation        text,
  difficulty         text,
  knowledge_point    text,
  knowledge_point_id uuid,
  score              numeric,
  is_public          boolean,
  usage_count        integer,
  created_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_admin boolean := false;
begin
  if v_uid is null then
    return; -- 未登录：一行都不给
  end if;

  select exists (select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin')
    into v_admin;

  return query
  select q.id, q.owner_id, q.subject, q.grade, q.unit, q.qtype, q.stem,
         q.options, q.answer, q.explanation, q.difficulty,
         q.knowledge_point, q.knowledge_point_id, q.score,
         q.is_public, q.usage_count, q.created_at
    from public.question_bank q
   where (v_admin or q.owner_id = v_uid or q.is_public = true)
     and (p_subject is null or q.subject = p_subject)
     and (p_grade   is null or q.grade   = p_grade)
     and (p_unit    is null or q.unit    = p_unit)
     and (p_qtype   is null or q.qtype   = p_qtype)
     and (p_knowledge_point_id is null or q.knowledge_point_id = p_knowledge_point_id)
     and (coalesce(p_public_only, false) = false or q.is_public = true)
   order by q.created_at desc
   limit 300;
end;
$$;

comment on function public.list_question_bank(text, text, text, text, uuid, boolean) is '题库检索：本人 + 公开题（管理员全部）；支持学科/年级/单元/题型/知识点筛选；绝不授予 anon';

revoke all on function public.list_question_bank(text, text, text, text, uuid, boolean) from public;
grant execute on function public.list_question_bank(text, text, text, text, uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RPC：新增题目到题库（owner 强制 = auth.uid()；非管理员 is_public 强制 false）
--    返回新题 uuid；未登录 / 参数非法 → 抛异常（前端转成中文提示）。
-- ---------------------------------------------------------------------------
create or replace function public.add_question_to_bank(
  p_subject            text default null,
  p_grade              text default null,
  p_unit               text default null,
  p_knowledge_point_id uuid default null,
  p_qtype              text default 'choice',
  p_stem               text default '',
  p_options            jsonb default null,
  p_answer             jsonb default '[]'::jsonb,
  p_explanation        text default null,
  p_difficulty         text default null,
  p_knowledge_point    text default null,
  p_score              numeric default 1,
  p_is_public          boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_admin  boolean := false;
  v_public boolean := false;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception '请先登录后再录入题目';
  end if;

  if p_qtype not in ('choice', 'fill', 'judge', 'subjective') then
    raise exception '题型不合法（必须是 choice/fill/judge/subjective）';
  end if;

  if coalesce(btrim(coalesce(p_stem, '')), '') = '' then
    raise exception '题干不能为空';
  end if;

  select exists (select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin')
    into v_admin;

  -- 非管理员一律不得公开发布（防"偷偷公开"绕过审核）
  v_public := case when v_admin then coalesce(p_is_public, false) else false end;

  insert into public.question_bank
    (owner_id, knowledge_point_id, subject, grade, unit, qtype, stem, options,
     answer, explanation, difficulty, knowledge_point, score, is_public, usage_count)
  values
    (v_uid, p_knowledge_point_id, p_subject, p_grade, p_unit, p_qtype, btrim(p_stem), p_options,
     coalesce(p_answer, '[]'::jsonb), p_explanation, p_difficulty, p_knowledge_point,
     coalesce(p_score, 1), v_public, 0)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.add_question_to_bank(text, text, text, uuid, text, text, jsonb, jsonb, text, text, text, numeric, boolean) is '录入题目到题库：owner 强制为当前登录用户；非管理员 is_public 强制 false；绝不授予 anon';

revoke all on function public.add_question_to_bank(text, text, text, uuid, text, text, jsonb, jsonb, text, text, text, numeric, boolean) from public;
grant execute on function public.add_question_to_bank(text, text, text, uuid, text, text, jsonb, jsonb, text, text, text, numeric, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RPC：删除题库中的题目（仅作者本人 / 管理员）
--    返回 {ok, deleted}；无权或题目不存在 → ok:false（不抛异常，前端统一提示）。
-- ---------------------------------------------------------------------------
create or replace function public.delete_question_from_bank(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_deleted integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', '请先登录');
  end if;
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', '题目不存在');
  end if;

  delete from public.question_bank q
   where q.id = p_id
     and (
       q.owner_id = v_uid
       or exists (select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin')
     );
  get diagnostics v_deleted = row_count;

  if v_deleted = 0 then
    return jsonb_build_object('ok', false, 'error', '题目不存在或无权删除');
  end if;

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

comment on function public.delete_question_from_bank(uuid) is '删除题库题目：仅作者本人 / 管理员；返回 {ok, deleted}';

revoke all on function public.delete_question_from_bank(uuid) from public;
grant execute on function public.delete_question_from_bank(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC：批量累加使用次数（组卷引用某题后调用；仅可见范围内的题）
-- ---------------------------------------------------------------------------
create or replace function public.increment_bank_usage(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_admin boolean := false;
  v_rows  integer := 0;
begin
  if v_uid is null or p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;

  select exists (select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin')
    into v_admin;

  update public.question_bank q
     set usage_count = coalesce(q.usage_count, 0) + 1
   where q.id = any(p_ids)
     and (v_admin or q.owner_id = v_uid or q.is_public = true);
  get diagnostics v_rows = row_count;

  return coalesce(v_rows, 0);
end;
$$;

comment on function public.increment_bank_usage(uuid[]) is '批量累加题库题目被引用次数；仅本人/公开/管理员可见的题；绝不授予 anon';

revoke all on function public.increment_bank_usage(uuid[]) from public;
grant execute on function public.increment_bank_usage(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. 扩展 0040 的 list_exam_paper_stats：补 submissionId / questionId / answers
--    原因：教师后台要给主观题打分（set_exam_subjective_score 需要 submission_id +
--    question_id）并需要看到学生写了什么，缺这两个 id 后台没法落地。
--    ⚠️ 只增字段，判分与权限逻辑一字不改；签名不变，前端与既有调用无感。
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
  -- 扩展字段：submissionId（打分用）、answers（教师查看学生作答原文）
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'submissionId',     s.id,
               'studentName',      s.student_name,
               'score',            s.score,
               'objectiveTotal',   s.total,
               'subjectiveTotal',  coalesce((select sum(value::text::numeric) from jsonb_each_text(s.subjective_scores)), 0),
               'finalScore',       s.score + coalesce((select sum(value::text::numeric) from jsonb_each_text(s.subjective_scores)), 0),
               'submittedAt',      s.submitted_at,
               'answers',          s.answers
             ) order by s.submitted_at desc
           ), '[]'::jsonb)
    into v_subs
    from public.exam_paper_submissions s
   where s.paper_id = p_paper_id;

  -- 每题统计：客观题=正确率；主观题=平均得分
  -- 扩展字段：questionId（打分用）
  with qidx as (
    select q.id, q.paper_id, q.section_no, q.seq, q.qtype, q.stem,
           (row_number() over (partition by q.paper_id order by q.section_no, q.seq))::int - 1 as idx
      from public.exam_paper_questions q
     where q.paper_id = p_paper_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'questionId', r.id,
               'sectionNo',  r.section_no,
               'seq',        r.seq,
               'qtype',      r.qtype,
               'stem',       r.stem,
               'metric',     r.metric
             ) order by r.section_no, r.seq
           ), '[]'::jsonb)
    into v_per
    from (
      select qi.id, qi.section_no, qi.seq, qi.qtype, qi.stem,
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

comment on function public.list_exam_paper_stats(uuid) is '教师看板：完成名单（含 submissionId/answers）+ 每题统计（含 questionId，客观正确率/主观均分）；仅作者/管理员';

revoke all on function public.list_exam_paper_stats(uuid) from public;
grant execute on function public.list_exam_paper_stats(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. 授权兜底：循环补齐五个 RPC 的 grant execute（**一律不含 anon**）
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'list_question_bank',
         'add_question_to_bank',
         'delete_question_from_bank',
         'increment_bank_usage',
         'list_exam_paper_stats'
       )
  loop
    execute format('grant execute on function public.%I(%s) to authenticated, service_role', f.proname, f.args);
  end loop;
end $$;

-- 再加一道保险：确保上述函数没有把 execute 暴露给 anon（客户可能手滑改过）
do $$
declare
  f record;
begin
  for f in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'list_question_bank',
         'add_question_to_bank',
         'delete_question_from_bank',
         'increment_bank_usage'
       )
  loop
    execute format('revoke execute on function public.%I(%s) from anon', f.proname, f.args);
  end loop;
end $$;

-- =============================================================================
-- 自测说明（本机无 psql / 无 Supabase 实例，已人工逐条核对）
--   1. 幂等：建表 create table if not exists；策略 drop policy if exists + create policy；
--      函数 create or replace；授权用 do $$ 循环（不会因重复 grant 报错）。
--      整段反复粘贴运行不报错。
--   2. RLS：两张新表都 enable row level security；每张表 7 条策略
--      （owner 读/公开读/admin 读/owner 增/owner 改/owner 删/admin for all），
--      **没有任何 to anon 的策略**。
--   3. RPC 红线：四个新 RPC 全部 security definer + set search_path = public，
--      先 revoke all from public 再 grant execute to authenticated, service_role，
--      且第 9 节末尾再对 anon 做一次 revoke 兜底。
--   4. 身份校验：list/add/delete/increment 开头都判 `auth.uid() is null` 直接拒绝；
--      add_question_to_bank 的 owner_id 一律写 auth.uid()（调用方传不进来），
--      非管理员 is_public 被强制 false。
--   5. 未使用 encode(x,'sha256')（PostgreSQL 的 encode 不支持 sha256，项目踩过坑）。
--   6. list_exam_paper_stats 为**同签名替换**，仅增加 submissionId/questionId/answers
--      三个输出字段，不改判分与权限判定逻辑。
-- =============================================================================
