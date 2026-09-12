-- =============================================================================
-- 0017_doc_library.sql
-- T06 收尾：内容沉淀库 doc_library（「生成即沉淀」，为后续 Skill 提炼降本做准备）
--
-- 业务动机（BRD BR-014/015）：
--   教师每次生成教案 / PPT / 课件都直接落一条沉淀记录。同类内容累积到阈值（≥100 条）后，
--   可离线提炼为 Skill —— 新请求命中 Skill 时走「套骨架 + 局部填空」而非全量生成，
--   按 40% 命中率估算 token 成本可降约 30%。
--
-- 设计约束：
--   - 本表只存**元数据索引**（关键词 / 学科 / 年级 / 教材版本），不存文档正文；
--     正文仍是 Storage 里的 doc_json（守 Postgres 500MB 红线，ARCHITECTURE §C.8）。
--   - doc_id 指向 public.apps(id)（文档类产物复用 apps 行，category='doc'）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 表结构
-- ---------------------------------------------------------------------------
create table if not exists public.doc_library (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references public.profiles (id) on delete cascade,
  doc_id              uuid not null references public.apps (id) on delete cascade,

  category            text not null default 'doc',
  doc_type            text,
  subject             text not null default '',
  grade               text not null default '',
  textbook_version_id uuid,                       -- T07 教材版本表建好后可加外键；此处仅存 id
  keywords            text[] not null default '{}',

  is_public           boolean not null default false,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint doc_library_category_chk
    check (category in ('app', 'doc')),
  constraint doc_library_doc_type_chk
    check (
      doc_type is null
      or doc_type in ('lesson_plan', 'ppt', 'courseware_2d', 'courseware_3d', 'office_doc')
    )
);

-- 唯一约束：一个产物只沉淀一条记录（重复生成不会灌水）
create unique index if not exists doc_library_doc_id_key
  on public.doc_library (doc_id);

-- 检索索引：按「学科 + 年级 + 文档类型」聚合同类内容，供 Skill 提炼扫描
create index if not exists doc_library_skill_idx
  on public.doc_library (doc_type, subject, grade);
create index if not exists doc_library_owner_idx
  on public.doc_library (owner_id, created_at desc);
create index if not exists doc_library_public_idx
  on public.doc_library (is_public) where is_public;
create index if not exists doc_library_textbook_idx
  on public.doc_library (textbook_version_id);
-- 关键词数组检索（GIN）
create index if not exists doc_library_keywords_idx
  on public.doc_library using gin (keywords);

comment on table  public.doc_library is '内容沉淀库：文档/课件生成的元数据索引，供 Skill 提炼与复用降本（BR-014/015）';
comment on column public.doc_library.doc_id is '指向 public.apps(id)，文档类产物 category=''doc''';
comment on column public.doc_library.keywords is '关键词数组，用于同类内容聚合与 Skill 命中判定';
comment on column public.doc_library.is_public is 'true 时对全体登录教师可读（用于跨校共享样例）';

-- ---------------------------------------------------------------------------
-- 2. updated_at 自动维护（沿用 0001 的 public.touch_updated_at()）
-- ---------------------------------------------------------------------------
drop trigger if exists trg_doc_library_touch on public.doc_library;
create trigger trg_doc_library_touch
  before update on public.doc_library
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS（红线：全表开启，无一例外）
--    读：本人全部可读；is_public=true 的记录全体登录教师可读
--    写：仅本人可增删改（写入实际由 Edge Function 以 service_role 完成，走 SECURITY DEFINER 语境）
-- ---------------------------------------------------------------------------
alter table public.doc_library enable row level security;

drop policy if exists doc_library_select_owner on public.doc_library;
create policy doc_library_select_owner on public.doc_library
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists doc_library_select_public on public.doc_library;
create policy doc_library_select_public on public.doc_library
  for select to authenticated
  using (is_public);

drop policy if exists doc_library_insert_owner on public.doc_library;
create policy doc_library_insert_owner on public.doc_library
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists doc_library_update_owner on public.doc_library;
create policy doc_library_update_owner on public.doc_library
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists doc_library_delete_owner on public.doc_library;
create policy doc_library_delete_owner on public.doc_library
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. 幂等沉淀函数：由 generate 的 doc 分支在成功后调用（service_role 绕过 RLS）
--    on conflict (doc_id) do nothing —— 重跑不灌水。
-- ---------------------------------------------------------------------------
create or replace function public.deposit_doc_library(
  p_doc_id              uuid,
  p_owner_id            uuid,
  p_category            text default 'doc',
  p_doc_type            text default null,
  p_subject             text default '',
  p_grade               text default '',
  p_textbook_version_id uuid default null,
  p_keywords            text[] default '{}',
  p_is_public           boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.doc_library (
    owner_id, doc_id, category, doc_type, subject, grade,
    textbook_version_id, keywords, is_public
  ) values (
    p_owner_id, p_doc_id, p_category, p_doc_type,
    coalesce(p_subject, ''), coalesce(p_grade, ''),
    p_textbook_version_id, coalesce(p_keywords, '{}'::text[]), coalesce(p_is_public, false)
  )
  on conflict (doc_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.deposit_doc_library(
  uuid, uuid, text, text, text, text, uuid, text[], boolean
) from public;
grant execute on function public.deposit_doc_library(
  uuid, uuid, text, text, text, text, uuid, text[], boolean
) to service_role;
