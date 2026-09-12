-- =============================================================================
-- 0015_rls_docs_textbook.sql
-- T07 RLS（ARCHITECTURE.md §C.5 T07 验收点）：
--   - textbook_versions：版本仅 owner 可增改删；登录教师可读全部（便于选教材）
--   - textbook_knowledge：status='verified' 全教师可读（含 anon）；
--                        pending 仅版本 owner 可读；
--                        未登录(anon) 不可写任何行
-- =============================================================================

alter table public.textbook_versions   enable row level security;
alter table public.textbook_knowledge enable row level security;

-- ---------------------------------------------------------------------------
-- textbook_versions：读全部登录用户；写仅 owner
-- ---------------------------------------------------------------------------
drop policy if exists textbook_versions_select on public.textbook_versions;
create policy textbook_versions_select on public.textbook_versions
  for select to authenticated
  using (true);

drop policy if exists textbook_versions_insert on public.textbook_versions;
create policy textbook_versions_insert on public.textbook_versions
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists textbook_versions_owner on public.textbook_versions;
create policy textbook_versions_owner on public.textbook_versions
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- textbook_knowledge
--   verified：全教师（含 anon）可读
--   pending：仅版本 owner 可读
--   写：仅版本 owner（已登录）；anon 不可写
-- ---------------------------------------------------------------------------
drop policy if exists textbook_knowledge_select_verified on public.textbook_knowledge;
create policy textbook_knowledge_select_verified on public.textbook_knowledge
  for select to anon, authenticated
  using (status = 'verified');

drop policy if exists textbook_knowledge_select_own on public.textbook_knowledge;
create policy textbook_knowledge_select_own on public.textbook_knowledge
  for select to authenticated
  using (
    verified_by = (select auth.uid())
    or exists (
      select 1 from public.textbook_versions tv
       where tv.id = textbook_version_id
         and tv.owner_id = (select auth.uid())
    )
  );

drop policy if exists textbook_knowledge_write_owner on public.textbook_knowledge;
create policy textbook_knowledge_write_owner on public.textbook_knowledge
  for all to authenticated
  using (
    exists (
      select 1 from public.textbook_versions tv
       where tv.id = textbook_version_id
         and tv.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.textbook_versions tv
       where tv.id = textbook_version_id
         and tv.owner_id = (select auth.uid())
    )
  );
