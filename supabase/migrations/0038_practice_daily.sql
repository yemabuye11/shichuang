-- =============================================================================
-- 0038_practice_daily.sql
-- T10「每日一练」数据层：练习集 / 题目 / 学生提交 三张表 + RLS + 服务端判分 RPC
--
-- 业务链路（见 docs/PLAN_每日一练.md）：
--   老师选教材章节（或上传自己的题目）→ 生成客观题练习 → 一条 /p/{slug} 链接发给学生
--   → 学生**免登录**点开就做 → 服务端判分 → 老师看完成情况与正确率 → 导出 CSV。
--
-- 设计约束（与 0017 / 0034 / 0035 / 0037 完全一致）：
--   1) RLS 全表开启，无一例外；
--   2) 新 RPC 一律 `security definer` + `set search_path = public` + 函数体内做身份校验；
--   3) 积分数值只读 app_type_profiles.credit_cost 与 system_config.practice，本迁移不写死价格、
--      不调用 reserve_credits / settle_generation / refund_generation（积分由 Edge 侧结算，
--      本文件只建数据与判分层）；
--   4) 幂等：create ... if not exists / drop ... if exists + create / on conflict do update /
--      枚举加值用 do $$ ... exception when others then null 兜底，整段反复粘贴运行不报错。
--
-- 答案安全（验收清单第 4 条）：
--   * practice_questions.answer / explanation 只存服务端；
--   * anon 只能通过两个白名单 RPC 触达：
--       - get_practice_for_student：列白名单，**绝不返回 answer / explanation**；
--       - submit_practice_answer ：服务端判分，返回「得分 + 每题对错 + 解析」；
--   * practice_submissions 不给 anon 任何表级策略，写与读都走 RPC。
--
-- ⚠️ 本项目真实踩过的坑：PostgreSQL 的 encode() 只支持 base64 / hex / escape，没有 sha256。
--    本文件不使用 encode(x, 'sha256')；需要哈希时用 encode(sha256(x), 'hex')。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. 枚举补充：app_type_enum 增加 'daily_practice'（幂等）
--    app_type_profiles 的 PK 是 public.app_type_enum，必须先成为合法枚举值才能写定价行。
--    写法照 0034 / 0035：do $$ ... exception when others then null $$。
-- ---------------------------------------------------------------------------
do $$
begin
  alter type public.app_type_enum add value if not exists 'daily_practice';
exception
  when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 内容类型定价：每日一练 = 1 积分 / 天（基准价）
--    多天折扣由 system_config.practice 的 discountByDays 计算（见第 2 节），这里存 1 天的价格，
--    后台「内容类型积分」Tab 可直接改。model_override 留 null（默认走 model_profiles.is_default）。
-- ---------------------------------------------------------------------------
insert into public.app_type_profiles
  (app_type, label, credit_cost, model_override, prompt_key, sort_order, enabled)
values
  ('daily_practice', '每日一练', 1, null, 'app_type:daily_practice', 30, true)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order,
      enabled     = excluded.enabled;
-- 注意：model_override 故意不进 conflict 分支，避免覆盖管理员后续在后台指定的便宜模型。

-- ---------------------------------------------------------------------------
-- 2. system_config 键 `practice`：天数档位 / 折算折扣 / 上传识别积分 / 每天默认题量
--    口径（PLAN §5.2）：1 天不打折；3 天 9 折；5 天 8.4 折；10 天 6.8 折；20 天 6 折；
--    上传识别（AI 结构化）0.5 积分/次，与天数无关。全部后台可改，代码零改动。
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description) values
  ('practice', jsonb_build_object(
    'dayTiers',              jsonb_build_array(1, 3, 5, 10, 20),
    'discountByDays',        jsonb_build_object('1', 1, '3', 0.9, '5', 0.84, '10', 0.68, '20', 0.6),
    'minDiscount',           0.6,
    'importCostCredits',     0.5,
    'questionPerDayDefault', 5
  ), '每日一练配置：天数档位 / 多天折扣 / 上传识别积分 / 每天默认题量')
on conflict (key) do update
  set value       = excluded.value,
      description = excluded.description,
      updated_at  = now();

-- ---------------------------------------------------------------------------
-- 3. 表结构
--    3.1 practices：练习集（一套练习 = 若干天）
-- ---------------------------------------------------------------------------
create table if not exists public.practices (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  title               text not null,
  subject             text,
  grade               text,
  -- 教材版本（0013 textbook_versions）；AI 生成路径写入，上传路径可为 null。
  -- 刻意不加外键约束：老师可能只选「年级+章节」不选版本；且教材版本被清理时
  -- 不应连带删掉已经发出去的练习（链接失效影响面大）。
  textbook_version_id uuid null,
  chapter             text,
  day_count           int  not null default 1,
  -- 'ai' = AI 生成；'upload' = 老师上传（本地规则解析或 AI 识别）
  source              text not null default 'ai' check (source in ('ai', 'upload')),
  -- 'draft'=未发布；'published'=可作答（学生端唯一可见状态）；'closed'=已关闭作答
  status              text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  -- 分享短码：/p/{share_slug}，10 位十六进制随机数
  share_slug          text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  -- 本次实际扣掉的积分快照（已含多天折扣）；NULL 表示未计费（如本地解析导入）
  credit_cost         numeric null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table  public.practices is '每日一练·练习集：一套练习 = N 天客观题，一条 /p/{share_slug} 链接发给学生';
comment on column public.practices.day_count is '练习天数：1/3/5/10/20，取自 system_config.practice.dayTiers';
comment on column public.practices.status is 'draft=未发布；published=学生可作答；closed=已关闭作答（学生端一律拒绝）';
comment on column public.practices.share_slug is '学生端链接短码 /p/{slug}，10 位随机，唯一';
comment on column public.practices.credit_cost is '本次实际扣除积分（含多天折扣）快照；NULL=未计费';

create index if not exists practices_owner_idx  on public.practices (owner_id);
create index if not exists practices_status_idx on public.practices (status);

-- updated_at 自动维护（沿用 0001 的 public.touch_updated_at()）
drop trigger if exists trg_practices_touch on public.practices;
create trigger trg_practices_touch
  before update on public.practices
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
--    3.2 practice_questions：题目
--        answer  jsonb：「若干个空」的标准答案数组。元素内部若含 '|'，表示该空的多个可接受答案
--                （如 ["又大又红|又香又甜"] 答案不唯一的填空；["A"] 单选；["对"] 判断）。
--        options jsonb：选择题选项文本数组，如 ["A. 朝霞(zhāo)", "B. 应该(yìng)"]；填空/判断为 null。
-- ---------------------------------------------------------------------------
create table if not exists public.practice_questions (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references public.practices (id) on delete cascade,
  day_no      int  not null default 1,
  -- 同一天内的题序（1,2,3...），学生端展示与判分都按它排
  seq         int  not null,
  -- 'choice' 选择题 | 'fill' 填空题 | 'judge' 判断题（P0 只做客观题）
  qtype       text not null check (qtype in ('choice', 'fill', 'judge')),
  stem        text not null,
  options     jsonb null,
  answer      jsonb not null,
  explanation text null,
  created_at  timestamptz not null default now()
);

comment on table  public.practice_questions is '每日一练·题目：answer / explanation 属敏感字段，仅服务端可见，禁止出现在任何面向 anon 的接口里';
comment on column public.practice_questions.answer is '标准答案数组 = 若干个空；元素内以 | 分隔表示同一空的多个可接受答案';
comment on column public.practice_questions.explanation is '解析：学生提交后才下发';

create index if not exists practice_questions_practice_day_idx
  on public.practice_questions (practice_id, day_no, seq);

-- ---------------------------------------------------------------------------
--    3.3 practice_submissions：学生提交
--        answers jsonb：字符串数组，下标 = 该天按 seq 排序后的题目下标（0 基）；
--                       某题多空时该元素也可以是字符串数组（按空顺序）。
--        唯一约束 (practice_id, day_no, student_name)：同一学生同天重做则**覆盖**，
--        防止刷新页面把提交数刷上去（PLAN §十「刷提交」风险）。
-- ---------------------------------------------------------------------------
create table if not exists public.practice_submissions (
  id           uuid primary key default gen_random_uuid(),
  practice_id  uuid not null references public.practices (id) on delete cascade,
  day_no       int  not null default 1,
  -- 昵称 / 学号后 4 位，教师可选开；未填为 ''（多条匿名记录会互相覆盖，见上）
  student_name text not null default '',
  answers      jsonb not null,
  score        int  not null default 0,
  total        int  not null default 0,
  duration_ms  int  null,
  submitted_at timestamptz not null default now(),
  constraint practice_submissions_practice_day_student_key
    unique (practice_id, day_no, student_name)
);

comment on table  public.practice_submissions is '每日一练·学生提交：匿名也要存（完成名单用）；表级不给 anon 任何策略，写入只走 submit_practice_answer';
comment on column public.practice_submissions.duration_ms is '作答耗时（毫秒），前端可选传；当前 RPC 未收该参数，留待扩展';

create index if not exists practice_submissions_practice_submitted_idx
  on public.practice_submissions (practice_id, submitted_at);

-- ---------------------------------------------------------------------------
-- 4. 判分口径（务必与前端交互、CSV 模板保持一致）
--    A. 归一化（practice_normalize_answer）：全角字母数字转半角 → 英文统一小写
--       → 去掉所有空白（含全角空格）→ 去掉英文标点 → 去掉中文标点，再比是否相等。
--    B. 多空填空题：**全部空都对，该题才算对**。空数以 answer 数组长度为准；
--       学生作答用 '|' 分隔多个空（也可直接提交字符串数组）。空数不符（少填/多填）
--       → 整题判错，不做部分给分。
--    C. 单个空内部 '|' 左右是该空的**多个可接受答案**，任一命中即算该空对
--       （二年级语文「照样子写词语」这类答案不唯一的题）。
--    D. 选择题：比对归一化后的**选项字母**（A/a/Ａ 均可）；若学生直接提交**选项文本**
--       （如 "朝霞(zhāo)" 或整串 "A. 朝霞(zhāo)"），也按「正确答案所在选项」认作对。
--    E. 判断题：对/正确/是/√/true 与 错/错误/否/×/false 各自归并视为同一答案。
--    F. 没有标准答案（空数组）或学生未作答（空串）→ 一律判错，绝不误判为对。
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
--    4.1 归一化函数
-- ---------------------------------------------------------------------------
create or replace function public.practice_normalize_answer(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  with s1 as (
    -- a) 全角数字 / 全角字母 → 半角
    select translate(
             coalesce(p_text, ''),
             '０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ',
             '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
           ) as t
  ),
  s2 as (   -- b) 英文统一小写
    select lower(t) as t from s1
  ),
  s3 as (   -- c) 去掉首尾与中间的所有空白（含全角空格 U+3000）
    select regexp_replace(t, '[\s　]+', '', 'g') as t from s2
  ),
  s4 as (   -- d) 去掉英文 / ASCII 标点
    select regexp_replace(t, '[[:punct:]]', '', 'g') as t from s3
  ),
  s5 as (   -- e) 去掉常见中文与全角标点
    select regexp_replace(t, '[，。、；：？！《》〈〉「」『』【】〔〕（）．·…—－～]+', '', 'g') as t from s4
  )
  select t from s5;
$$;

comment on function public.practice_normalize_answer(text) is '判分前的答案归一化：全角转半角、去空白、小写化、去中英文标点';

-- ---------------------------------------------------------------------------
--    4.2 判断题的同义答案归并（√/✓/正确/是/true 统一映射为「对」）
-- ---------------------------------------------------------------------------
create or replace function public.practice_judge_token(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when x.t in ('对', '正确', '是', '真', '√', '✓', 'true', 't', 'yes', 'y') then '对'
           when x.t in ('错', '错误', '否', '假', '×', '✗', 'false', 'f', 'no', 'n') then '错'
           else null
         end
    from (select lower(btrim(coalesce(p_text, ''))) as t) x;
$$;

comment on function public.practice_judge_token(text) is '判断题答案归并：非标准写法归一到「对」/「错」，非判断题答案返回 null';

-- ---------------------------------------------------------------------------
--    4.3 单个「空」的比对（p_expected_item = 该空标准答案，内部可用 | 给出多个可接受答案）
-- ---------------------------------------------------------------------------
create or replace function public.practice_answer_matches(
  p_qtype         text,
  p_expected_item text,
  p_student       text,
  p_options       jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_expect_norm text := public.practice_normalize_answer(p_expected_item);
  v_stu_norm    text := public.practice_normalize_answer(p_student);
  v_token       text;
  v_opt         text;
  v_opt_norm    text;
  v_opt_letter  text;
  v_size        integer := 0;
  v_i           integer;
begin
  -- 空值保护：标准答案为空 或 学生未作答 → 判错（口径 F）
  if coalesce(v_expect_norm, '') = '' or coalesce(v_stu_norm, '') = '' then
    return false;
  end if;

  -- 完全一致（忽略全角/大小写/标点差异）→ 判对
  if v_expect_norm = v_stu_norm then
    return true;
  end if;

  -- 判断题：只认同义归并，不做其它兜底，避免与填充答案巧合相等
  if p_qtype = 'judge' then
    v_token := public.practice_judge_token(p_expected_item);
    if v_token is not null and public.practice_judge_token(p_student) = v_token then
      return true;
    end if;
    return false;
  end if;

  -- 选择题：学生可能提交的是选项文本而非字母，取「正确答案所在选项」再比
  if p_qtype = 'choice' and p_options is not null and jsonb_typeof(p_options) = 'array' then
    v_size := jsonb_array_length(p_options);
    for v_i in 0 .. v_size - 1 loop
      v_opt := p_options ->> v_i;
      -- 选项文本形如 "A. 朝霞(zhāo)"：取行首字母作为该选项标号
      v_opt_letter := lower(coalesce(substring(v_opt from '^\s*([A-Za-z])'), ''));
      if v_opt_letter <> '' and v_opt_letter = v_expect_norm then
        v_opt_norm := public.practice_normalize_answer(v_opt);
        -- ① 学生整串与选项文本一致；② 学生只填了选项正文（去掉开头的字母标号）
        if v_opt_norm = v_stu_norm
           or regexp_replace(v_opt_norm, '^[0-9a-z]+', '') = v_stu_norm then
          return true;
        end if;
      end if;
    end loop;
    return false;
  end if;

  -- 填空题 / 未知题型：归一化相等才算对（多空的整体判定在 practice_grade_question 里）
  return false;
end;
$$;

comment on function public.practice_answer_matches(text, text, text, jsonb) is '单个「空」的答案比对：支持选项字母、选项文本、判断题同义写法；不命中返回 false';

-- ---------------------------------------------------------------------------
--    4.4 整题判分：多个空「全对才对」（口径 B / C）
-- ---------------------------------------------------------------------------
create or replace function public.practice_grade_question(
  p_qtype   text,
  p_answer  jsonb,
  p_student text,
  p_options jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_expect    text[] := array[]::text[];
  v_stu_parts text[];
  v_i         integer;
  v_blank_ok  boolean;
  v_alt       record;
begin
  -- 标准答案缺失 → 判错
  if p_answer is null or jsonb_typeof(p_answer) = 'null' then
    return false;
  end if;

  if jsonb_typeof(p_answer) = 'array' then
    select array_agg(a.t order by a.ord) into v_expect
      from jsonb_array_elements_text(p_answer) with ordinality as a(t, ord);
  else
    v_expect := array[coalesce(p_answer #>> '{}', '')];
  end if;

  if v_expect is null or coalesce(array_length(v_expect, 1), 0) = 0 then
    return false;
  end if;

  -- 学生作答：字符串内以 | 分隔多个空
  v_stu_parts := string_to_array(coalesce(p_student, ''), '|');

  -- 空数不一致 → 整题判错（不做部分给分）
  if coalesce(array_length(v_stu_parts, 1), 0) <> array_length(v_expect, 1) then
    return false;
  end if;

  -- 逐空比对：任一可接受答案命中即该空对；所有空全对才算整题对
  for v_i in 1 .. array_length(v_expect, 1) loop
    v_blank_ok := false;
    for v_alt in
      select btrim(a.t) as t
        from unnest(string_to_array(v_expect[v_i], '|')) as a(t)
    loop
      if public.practice_answer_matches(p_qtype, v_alt.t, v_stu_parts[v_i], p_options) then
        v_blank_ok := true;
        exit;
      end if;
    end loop;
    if not v_blank_ok then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function public.practice_grade_question(text, jsonb, text, jsonb) is '整题判分：answer 数组=若干个空，学生作答以 | 分空，**全部空都对才判对**；空数不符或答案为空一律判错';

-- ---------------------------------------------------------------------------
--    4.5 取出第 p_idx 题的学生作答（统一转成「'|' 分隔的多空字符串」）
-- ---------------------------------------------------------------------------
create or replace function public.practice_answer_text(p_answers jsonb, p_idx integer)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_el jsonb;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    return '';
  end if;
  if p_idx is null or p_idx < 0 or p_idx >= jsonb_array_length(p_answers) then
    -- 题目数多于答案数：缺的按未作答处理（判错），绝不越界报错
    return '';
  end if;

  v_el := p_answers -> p_idx;

  if jsonb_typeof(v_el) = 'array' then
    -- 该元素本身是数组（学生分空提交），合并成 '|' 分隔字符串
    return (select string_agg(coalesce(a.t, ''), '|') from jsonb_array_elements_text(v_el) as a(t));
  end if;

  if jsonb_typeof(v_el) = 'null' then
    return '';
  end if;

  return coalesce(v_el #>> '{}', '');
end;
$$;

comment on function public.practice_answer_text(jsonb, integer) is '按 0 基下标取学生某题作答，统一转成「| 分隔的多空字符串」；越界或空值返回空串';

-- ---------------------------------------------------------------------------
-- 5. RLS（红线：全表开启，无一例外）
-- ---------------------------------------------------------------------------
alter table public.practices            enable row level security;
alter table public.practice_questions   enable row level security;
alter table public.practice_submissions enable row level security;

-- ---------------------------------------------------------------------------
--    5.1 practices：本人 CRUD；管理员只读全部
-- ---------------------------------------------------------------------------
drop policy if exists practices_select_owner on public.practices;
create policy practices_select_owner on public.practices
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists practices_select_admin on public.practices;
create policy practices_select_admin on public.practices
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = (select auth.uid()) and role = 'admin'
    )
  );

drop policy if exists practices_insert_owner on public.practices;
create policy practices_insert_owner on public.practices
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists practices_update_owner on public.practices;
create policy practices_update_owner on public.practices
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists practices_delete_owner on public.practices;
create policy practices_delete_owner on public.practices
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
--    5.2 practice_questions：通过所属 practice 的 owner 判权；管理员只读。
--        answer / explanation 只对作者本人与管理员可见，anon 一条策略都没有。
-- ---------------------------------------------------------------------------
drop policy if exists practice_questions_select_owner on public.practice_questions;
create policy practice_questions_select_owner on public.practice_questions
  for select to authenticated
  using (
    exists (
      select 1 from public.practices p
       where p.id = practice_questions.practice_id
         and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists practice_questions_select_admin on public.practice_questions;
create policy practice_questions_select_admin on public.practice_questions
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = (select auth.uid()) and role = 'admin'
    )
  );

drop policy if exists practice_questions_insert_owner on public.practice_questions;
create policy practice_questions_insert_owner on public.practice_questions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.practices p
       where p.id = practice_questions.practice_id
         and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists practice_questions_update_owner on public.practice_questions;
create policy practice_questions_update_owner on public.practice_questions
  for update to authenticated
  using (
    exists (
      select 1 from public.practices p
       where p.id = practice_questions.practice_id
         and p.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.practices p
       where p.id = practice_questions.practice_id
         and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists practice_questions_delete_owner on public.practice_questions;
create policy practice_questions_delete_owner on public.practice_questions
  for delete to authenticated
  using (
    exists (
      select 1 from public.practices p
       where p.id = practice_questions.practice_id
         and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
--    5.3 practice_submissions：本人 + 管理员可读可删；
--        **没有任何 insert / update 策略，也不给 anon 任何策略**
--        —— 写入一律走 submit_practice_answer（SECURITY DEFINER）。
-- ---------------------------------------------------------------------------
drop policy if exists practice_submissions_select_owner on public.practice_submissions;
create policy practice_submissions_select_owner on public.practice_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.practices p
       where p.id = practice_submissions.practice_id
         and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists practice_submissions_select_admin on public.practice_submissions;
create policy practice_submissions_select_admin on public.practice_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = (select auth.uid()) and role = 'admin'
    )
  );

drop policy if exists practice_submissions_delete_owner on public.practice_submissions;
create policy practice_submissions_delete_owner on public.practice_submissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.practices p
       where p.id = practice_submissions.practice_id
         and p.owner_id = (select auth.uid())
    )
  );

drop policy if exists practice_submissions_delete_admin on public.practice_submissions;
create policy practice_submissions_delete_admin on public.practice_submissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = (select auth.uid()) and role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- 6. RPC：学生端读题（列白名单，**绝不返回 answer / explanation**）
--    参数：p_slug = 分享短码
--    返回：practice_id, title, grade, subject, chapter, day_count, status,
--          day_no, seq, qtype, stem, options
--    约束：只返回 status='published' 的练习；草稿 / 已关闭 → 一行都不返回。
-- ---------------------------------------------------------------------------
create or replace function public.get_practice_for_student(p_slug text)
returns table (
  practice_id uuid,
  title       text,
  grade       text,
  subject     text,
  chapter     text,
  day_count   integer,
  status      text,
  day_no      integer,
  seq         integer,
  qtype       text,
  stem        text,
  options     jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select p.id,
         p.title,
         p.grade,
         p.subject,
         p.chapter,
         p.day_count,
         p.status,
         q.day_no,
         q.seq,
         q.qtype,
         q.stem,
         q.options
    from public.practices p
    join public.practice_questions q on q.practice_id = p.id
   where p.share_slug = coalesce(p_slug, '')
     and p.status = 'published'
   order by q.day_no, q.seq;
end;
$$;

comment on function public.get_practice_for_student(text) is '学生端（免登录）读题：只取已发布练习，列白名单不含 answer / explanation';

revoke all on function public.get_practice_for_student(text) from public;
grant execute on function public.get_practice_for_student(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. RPC：提交作答并判分（anon 可用，答案不留前端）
--    参数：
--      p_slug         分享短码
--      p_day_no       第几天（默认 1）
--      p_student_name 昵称 / 学号后 4 位（可空；同名同天重做覆盖上一次）
--      p_answers      jsonb 字符串数组，下标对齐该天按 seq 排序的题目；某题多空时可用数组元素
--    返回：
--      成功 {ok:true, score, total, perQuestion:[bool], explanations:[text]}
--      失败 {ok:false, error}，error ∈ 练习不存在 / 该练习已关闭 / 该天没有题目
-- ---------------------------------------------------------------------------
create or replace function public.submit_practice_answer(
  p_slug         text,
  p_day_no       integer,
  p_student_name text,
  p_answers      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_practice_id  uuid;
  v_status       text;
  v_day_no       integer := greatest(coalesce(p_day_no, 1), 1);
  v_name         text    := left(btrim(coalesce(p_student_name, '')), 50);
  v_answers      jsonb   := coalesce(p_answers, '[]'::jsonb);
  v_rec          record;
  v_idx          integer := 0;
  v_score        integer := 0;
  v_total        integer := 0;
  v_per_question jsonb   := '[]'::jsonb;
  v_explanations jsonb   := '[]'::jsonb;
  v_student      text;
  v_correct      boolean;
begin
  -- 1) 定位练习
  select p.id, p.status
    into v_practice_id, v_status
    from public.practices p
   where p.share_slug = coalesce(p_slug, '')
   limit 1;

  if v_practice_id is null then
    return jsonb_build_object('ok', false, 'error', '练习不存在');
  end if;

  -- 2) 只有已发布的练习能作答（草稿 / 已关闭一律拒绝）
  if v_status <> 'published' then
    return jsonb_build_object('ok', false, 'error', '该练习已关闭');
  end if;

  -- 3) 按 seq 顺序逐题判分
  for v_rec in
    select q.qtype, q.answer, q.options, q.explanation
      from public.practice_questions q
     where q.practice_id = v_practice_id
       and q.day_no = v_day_no
     order by q.seq
  loop
    v_total := v_total + 1;
    -- p_answers 是 0 基数组：第 v_total 题对应下标 v_total - 1
    v_idx     := v_total - 1;
    v_student := public.practice_answer_text(v_answers, v_idx);
    v_correct := public.practice_grade_question(v_rec.qtype, v_rec.answer, v_student, v_rec.options);

    if v_correct then
      v_score := v_score + 1;
    end if;

    v_per_question := v_per_question || to_jsonb(v_correct);
    v_explanations := v_explanations || to_jsonb(coalesce(v_rec.explanation, ''));
  end loop;

  -- 4) 该天没有题目：不写提交，明确回错（不崩、不返回 0/0 让前端误以为交卷成功）
  if v_total = 0 then
    return jsonb_build_object('ok', false, 'error', '该天没有题目');
  end if;

  -- 5) 写提交：同一学生同一天重做 → 覆盖（唯一约束 practice_id + day_no + student_name）
  insert into public.practice_submissions
    (practice_id, day_no, student_name, answers, score, total, submitted_at)
  values
    (v_practice_id, v_day_no, v_name, v_answers, v_score, v_total, now())
  on conflict (practice_id, day_no, student_name) do update
    set answers      = excluded.answers,
        score        = excluded.score,
        total        = excluded.total,
        submitted_at = now();

  return jsonb_build_object(
    'ok',           true,
    'score',        v_score,
    'total',        v_total,
    'perQuestion',  v_per_question,
    'explanations', v_explanations
  );
end;
$$;

comment on function public.submit_practice_answer(text, integer, text, jsonb) is '学生提交作答：服务端判分（多空全对才对）+ 覆盖式写入 + 返回得分与解析';

revoke all on function public.submit_practice_answer(text, integer, text, jsonb) from public;
grant execute on function public.submit_practice_answer(text, integer, text, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RPC：教师看板统计（仅作者本人或管理员）
--    参数：p_practice_id 练习集 id
--    返回：{ok:true, submissions:[{studentName, dayNo, score, total, submittedAt}],
--           perQuestion:[{dayNo, seq, stem, correctRate}]}
--          correctRate = 该天答对该题的人数 / 该天提交份数；无人提交时为 0
-- ---------------------------------------------------------------------------
create or replace function public.list_practice_stats(p_practice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submissions  jsonb;
  v_per_question jsonb;
begin
  -- 身份校验：作者本人 或 role='admin'（anon 的 auth.uid() 为 null，必定落在拒绝分支）
  if p_practice_id is null
     or not exists (
       select 1 from public.practices p
        where p.id = p_practice_id
          and (
            p.owner_id = (select auth.uid())
            or exists (
              select 1 from public.profiles pr
               where pr.id = (select auth.uid()) and pr.role = 'admin'
            )
          )
     ) then
    return jsonb_build_object('ok', false, 'error', '无权查看');
  end if;

  -- 完成名单
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'studentName', s.student_name,
               'dayNo',       s.day_no,
               'score',       s.score,
               'total',       s.total,
               'submittedAt', s.submitted_at
             )
             order by s.submitted_at desc
           ),
           '[]'::jsonb
         )
    into v_submissions
    from public.practice_submissions s
   where s.practice_id = p_practice_id;

  -- 每题正确率：把题目按天重排成 0 基下标，与 answers 数组对齐后逐份重判
  with qidx as (
    select q.practice_id,
           q.day_no,
           q.seq,
           q.stem,
           q.qtype,
           q.answer,
           q.options,
           (row_number() over (partition by q.practice_id, q.day_no order by q.seq))::int - 1 as idx
      from public.practice_questions q
     where q.practice_id = p_practice_id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'dayNo',       r.day_no,
               'seq',         r.seq,
               'stem',        r.stem,
               'correctRate', case
                                when coalesce(r.day_total, 0) = 0 then 0::numeric
                                else round(r.correct_count::numeric / r.day_total, 4)
                              end
             )
             order by r.day_no, r.seq
           ),
           '[]'::jsonb
         )
    into v_per_question
    from (
      select qi.day_no,
             qi.seq,
             qi.stem,
             (select count(*)
                from public.practice_submissions d
               where d.practice_id = qi.practice_id
                 and d.day_no = qi.day_no) as day_total,
             (select count(*)
                from public.practice_submissions d
               where d.practice_id = qi.practice_id
                 and d.day_no = qi.day_no
                 and public.practice_grade_question(
                       qi.qtype,
                       qi.answer,
                       public.practice_answer_text(d.answers, qi.idx),
                       qi.options
                     )) as correct_count
        from qidx qi
    ) r;

  return jsonb_build_object(
    'ok',          true,
    'submissions', coalesce(v_submissions, '[]'::jsonb),
    'perQuestion', coalesce(v_per_question, '[]'::jsonb)
  );
end;
$$;

comment on function public.list_practice_stats(uuid) is '教师看板：完成名单 + 每题正确率；仅作者本人或管理员可调用';

revoke all on function public.list_practice_stats(uuid) from public;
grant execute on function public.list_practice_stats(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. RPC：一键清空某次练习的全部提交（仅作者本人或管理员）
--    参数：p_practice_id 练习集 id
--    返回：{ok:true, deleted:<条数>} / {ok:false, error:'无权清空'}
-- ---------------------------------------------------------------------------
create or replace function public.clear_practice_submissions(p_practice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if p_practice_id is null
     or not exists (
       select 1 from public.practices p
        where p.id = p_practice_id
          and (
            p.owner_id = (select auth.uid())
            or exists (
              select 1 from public.profiles pr
               where pr.id = (select auth.uid()) and pr.role = 'admin'
            )
          )
     ) then
    return jsonb_build_object('ok', false, 'error', '无权清空');
  end if;

  delete from public.practice_submissions
   where practice_id = p_practice_id;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object('ok', true, 'deleted', coalesce(v_deleted, 0));
end;
$$;

comment on function public.clear_practice_submissions(uuid) is '清空某次练习的全部学生提交（数据最小化要求：教师可一键清）；仅作者本人或管理员';

revoke all on function public.clear_practice_submissions(uuid) from public;
grant execute on function public.clear_practice_submissions(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. 授权兜底：无论上面写法怎么调整，都把这四个 RPC 的 grant execute 补齐
--     （照 0010:214-238 的写法，循环查 pg_proc，重复执行不报错）
--     * get_practice_for_student / submit_practice_answer：学生端免登录，给 anon + authenticated
--     * list_practice_stats / clear_practice_submissions：教师端，只给 authenticated
-- ---------------------------------------------------------------------------
do $$
declare
  f    record;
  v_to text;
begin
  for f in
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'get_practice_for_student',
         'submit_practice_answer',
         'list_practice_stats',
         'clear_practice_submissions'
       )
  loop
    v_to := case
              when f.proname in ('get_practice_for_student', 'submit_practice_answer')
                then 'anon, authenticated, service_role'
              else 'authenticated, service_role'
            end;
    execute format('grant execute on function public.%I(%s) to %s', f.proname, f.args, v_to);
  end loop;
end $$;

-- =============================================================================
-- 自测说明（本机无 psql / 无 Supabase 实例，已人工逐条核对，PR 评审照这 8 条复查）
--   1. 幂等：全文只有 `create table if not exists` / `create index if not exists` /
--      `create or replace function` / `drop X if exists + create X` / `on conflict do update`，
--      枚举加值包在 do $$ exception when others then null $$ 里 → 整段反复粘贴运行不报错。
--   2. 枚举：新增值 `daily_practice` 在同一文件内被用于 app_type_profiles 的 insert
--      （与 0012:71-91 的既有写法一致，该迁移客户已在 Supabase SQL Editor 跑通）。
--   3. 去敏：get_practice_for_student 的 returns table 只有
--      practice_id/title/grade/subject/chapter/day_count/status/day_no/seq/qtype/stem/options，
--      **没有任何 answer / explanation 字段**；且 where 限定 status='published'。
--   4. RLS：三张表全部 enable row level security；practice_submissions 只给了
--      select/delete 两类策略（owner + admin），**没有 insert/update 策略、没有给 anon 的策略**，
--      写入只能走 submit_practice_answer。
--   5. 容错：p_answers 为 null / 不是数组 / 长度少于题目数 → practice_answer_text 返回空串，
--      该题判错但不崩；题目答案数组为空 → practice_grade_question 判错，不会误判为对。
--   6. 填空题多空：全部空都对才算对（practice_grade_question），单个空内部 '|' 为多个可接受答案
--      （任一命中即可）；空数不符整题判错，不做部分给分。
--   7. 禁用 encode(x,'sha256')：全文未出现 encode 调用（本项目踩过的坑，PG 只支持 base64/hex/escape）。
--   8. RPC 红线：四个 RPC 全部 security definer + set search_path = public，
--      且先 revoke all from public 再按最小权限 grant execute。
-- =============================================================================
