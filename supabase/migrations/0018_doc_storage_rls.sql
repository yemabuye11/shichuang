-- =============================================================================
-- 0018_doc_storage_rls.sql
-- T08 上线前置：文档产物 Storage 桶 + 仅作者可写策略
--
-- 设计（对应野马诉求「仅作者可改，且作者本人永远能恢复」）：
--   - `docs` 桶：公开读（文档本就是要分享给老师看的，与网页一致）；
--   - 写（增/改/删）：仅该文档作者可操作，陌生人无法篡改、也无法删；
--   - 作者本人随时可再编辑 / 保存新版本 = 自带恢复能力。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 建 docs 桶（公开读）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('docs', 'docs', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- 2. 辅助函数：从对象路径解析 appId 并查作者
--    SECURITY DEFINER 绕过 RLS，供 Storage 策略判断「这个对象归谁」
--    路径格式：d/{yyyy}/{mm}/{appId}/v{n}.json
-- ---------------------------------------------------------------------------
create or replace function public.doc_object_owner(object_name text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select a.author_id
    from public.apps a
   where a.id = (
     (regexp_match(object_name, '^d/\d{4}/\d{2}/([0-9a-fA-F-]{36})/'))[1]
   )::uuid
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. Storage 对象策略
-- ---------------------------------------------------------------------------
drop policy if exists docs_select_public on storage.objects;
create policy docs_select_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'docs');

drop policy if exists docs_insert_author on storage.objects;
create policy docs_insert_author on storage.objects
  for insert to authenticated
  with check (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()));

drop policy if exists docs_update_author on storage.objects;
create policy docs_update_author on storage.objects
  for update to authenticated
  using (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()))
  with check (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()));

drop policy if exists docs_delete_author on storage.objects;
create policy docs_delete_author on storage.objects
  for delete to authenticated
  using (bucket_id = 'docs' and public.doc_object_owner(name) = (select auth.uid()));
