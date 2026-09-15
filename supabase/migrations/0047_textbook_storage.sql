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

drop policy if exists textbooks_select_owner on storage.objects;
create policy textbooks_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'textbooks'
    and public.textbook_object_owner(name) = (select auth.uid())
  );

drop policy if exists textbooks_insert_owner on storage.objects;
create policy textbooks_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'textbooks'
    and public.textbook_object_owner(name) = (select auth.uid())
  );

drop policy if exists textbooks_update_owner on storage.objects;
create policy textbooks_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'textbooks'
    and public.textbook_object_owner(name) = (select auth.uid())
  )
  with check (
    bucket_id = 'textbooks'
    and public.textbook_object_owner(name) = (select auth.uid())
  );

drop policy if exists textbooks_delete_owner on storage.objects;
create policy textbooks_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'textbooks'
    and public.textbook_object_owner(name) = (select auth.uid())
  );

comment on table storage.objects is 'textbooks bucket stores private electronic textbook files under tb/{owner_id}/';
