-- =============================================================================
-- 0013_textbook_versions.sql
-- T07 教材版本机制：textbook_versions 表
--   级联 5 维（年级 grade / 学科 subject / 出版社 publisher / 版本 version / 年份 year）
--   + 章节 chapter + 电子版 upload_url + 状态 status
--   并补 apps.textbook_version_id 外键（0012 仅建了索引，外键在此建立）
-- =============================================================================

create table if not exists public.textbook_versions (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  year       text not null default '2024',
  version    text not null default '通用版',
  publisher  text not null default '通用',
  subject    text not null default '通用',
  grade      text not null default '通用',
  chapter    text,
  upload_url text,
  status     text not null default 'draft'
               check (status in ('draft', 'verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 级联筛选索引（生成页按 年级/学科/出版社/版本/年份 过滤教材版本）
create index if not exists textbook_versions_cascade_idx
  on public.textbook_versions (grade, subject, publisher, version, year);
create index if not exists textbook_versions_owner_idx
  on public.textbook_versions (owner_id);

-- apps.textbook_version_id 外键（版本删除时置空，不级联删应用）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'apps_textbook_version_fk'
  ) then
    alter table public.apps
      add constraint apps_textbook_version_fk
      foreign key (textbook_version_id)
      references public.textbook_versions (id)
      on delete set null;
  end if;
end $$;

comment on table public.textbook_versions is
  '教师维护的教材版本（级联维度：年级/学科/出版社/版本/年份 + 章节），生成时作为教材上下文来源';
