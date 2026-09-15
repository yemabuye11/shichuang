-- 0047_textbook_storage.sql
-- 教材电子版独立存储：与校本 resources、文档 docs、应用 apps-html 分桶。

insert into storage.buckets (id, name, public)
values ('textbooks', 'textbooks', false)
on conflict (id) do update set public = false;

-- 对象路径：tb/{owner_id}/{uuid}-{safe_filename}
create or replace function public.textbook_object_owner(object_name text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select (regexp_match(object_name, '^tb/([0-9a-fA-F-]{36})/'))[1]::uuid;
$$;

revoke all on function public.textbook_object_owner(text) from public;
grant execute on function public.textbook_object_owner(text) to authenticated, service_role;

-- 注意：当前 Supabase 项目的 SQL Editor 角色不是 storage.objects 的 owner，
-- 因此不能在这里 DROP/CREATE POLICY。请运行本文件后，按
-- docs/0047_textbook_storage_policies.md 在 Storage -> Policies 中创建 4 条策略。
