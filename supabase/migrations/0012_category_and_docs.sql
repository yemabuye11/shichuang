-- =============================================================================
-- 0012_category_and_docs.sql
-- T06 文档与课件生成：apps 表加 category 维度 + 文档类字段；app_type_profiles 扩 5 类文档
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. apps 表扩展文档维度
--    category 默认 'app'（沿用既有应用单文件 HTML 形态）；'doc' 表示结构化文档
--    doc_json_url 一律存 Storage（不进 DB 字段，守 500MB 红线，ARCHITECTURE §C.8 阻塞① 选 B）
-- ---------------------------------------------------------------------------
alter table public.apps
  add column if not exists category        text not null default 'app',
  add column if not exists doc_type        text,
  add column if not exists doc_json_url    text,
  add column if not exists doc_version     integer not null default 1,
  add column if not exists verify_status   text not null default 'pending',
  add column if not exists textbook_version_id uuid;

-- category 取值约束
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_category_chk'
  ) then
    alter table public.apps
      add constraint apps_category_chk
      check (category in ('app', 'doc'));
  end if;
end $$;

-- verify_status 取值约束
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_verify_status_chk'
  ) then
    alter table public.apps
      add constraint apps_verify_status_chk
      check (verify_status in ('pending', 'verified', 'partial'));
  end if;
end $$;

-- doc_type 取值约束
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_doc_type_chk'
  ) then
    alter table public.apps
      add constraint apps_doc_type_chk
      check (
        doc_type is null
        or doc_type in (
          'lesson_plan', 'ppt', 'courseware_2d', 'courseware_3d', 'office_doc'
        )
      );
  end if;
end $$;

-- textbook_version_id 外键（T07 建表后由 0013 建立；这里仅建索引）
create index if not exists apps_category_doc_type_idx
  on public.apps (category, doc_type, published_at desc);
create index if not exists apps_textbook_version_idx
  on public.apps (textbook_version_id);

-- ---------------------------------------------------------------------------
-- 2. 扩展 app_type_enum（app_type_profiles 的 PK 是 public.app_type_enum）
--    5 个文档类必须先成为合法枚举值，才能写进 app_type_profiles。
--    枚举在 0001 已创建（跨事务），此处 ADD VALUE 在 PG12+ 事务内可用。
-- ---------------------------------------------------------------------------
alter type public.app_type_enum add value if not exists 'lesson_plan';
alter type public.app_type_enum add value if not exists 'ppt';
alter type public.app_type_enum add value if not exists 'courseware_2d';
alter type public.app_type_enum add value if not exists 'courseware_3d';
alter type public.app_type_enum add value if not exists 'office_doc';

-- ---------------------------------------------------------------------------
-- 3. app_type_profiles 扩 5 个文档类（积分：教案1 / PPT2 / 课件(2D)2 / 课件(3D)3 / 办公文档1）
--    提示词 key 约定：doc_type:<kind>
-- ---------------------------------------------------------------------------
insert into public.app_type_profiles (app_type, label, credit_cost, prompt_key, sort_order) values
  ('lesson_plan',     '教案',         1, 'doc_type:lesson_plan',     20),
  ('ppt',             'PPT 课件',     2, 'doc_type:ppt',             21),
  ('courseware_2d',   '课件（2D）',   2, 'doc_type:courseware_2d',   22),
  ('courseware_3d',   '课件（3D）',   3, 'doc_type:courseware_3d',   23),
  ('office_doc',      '办公文档',     1, 'doc_type:office_doc',      24)
on conflict (app_type) do update
  set label       = excluded.label,
      credit_cost = excluded.credit_cost,
      prompt_key  = excluded.prompt_key,
      sort_order  = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 3. 视图字段对齐（public_authors 已存在，无需改动；apps 视图若需筛选文档类在此留口）
-- ---------------------------------------------------------------------------
comment on column public.apps.category is '产物大类：app=单文件HTML应用(沙箱)；doc=结构化文档(平台渲染壳)';
comment on column public.apps.doc_json_url is '结构化 DocModel 的 Storage 路径（不进 DB 正文，守 500MB 红线）';
comment on column public.apps.doc_version is '文档版本号，保存即新版本 v{n+1}';
comment on column public.apps.verify_status is 'AI 生成内容核对状态：pending/partial/verified';
