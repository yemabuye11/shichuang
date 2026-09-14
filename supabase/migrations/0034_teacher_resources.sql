-- =============================================================================
-- 0034_teacher_resources.sql
-- 校本资源库：教师上传优秀教学案例 / 教案 / PPT，管理员审核通过后赠送积分
--
-- 业务动机（BR-014/015）：
--   - 教师把优质教学资料上传到「校本资源库」；
--   - 管理员审核通过后，教师获得积分奖励（写入流水，reason='resource_reward'）；
--   - 审核通过的公开资源进入「内容沉淀 + Skill 降本」闭环，AI 持续变好。
--
-- 设计约束（沿用 0017 doc_library / 0018 storage RLS / 0008 apply_credit 风格）：
--   - teacher_resources 只存元数据索引 + storage 对象名；文件本体在 `resources` 桶（公开读）；
--   - RLS 全表开启；写仅本人；读本人或 is_public；审核由 SECURITY DEFINER RPC 完成；
--   - 积分发放复用 0008 的 public.apply_credit。
--
-- 管理员判定：本项目统一用 public.profiles.role = 'admin'（见 0021_admin_users.sql），
--   故 RPC 与 RLS 均以该口径校验，未引用不存在的 admin_users 表。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. 枚举补充：积分流水原因增加 'resource_reward'（幂等）
-- ---------------------------------------------------------------------------
do $$
begin
  alter type public.ledger_reason_enum add value if not exists 'resource_reward';
exception
  when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1. 表结构
-- ---------------------------------------------------------------------------
create table if not exists public.teacher_resources (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles (id) on delete cascade,
  title           text not null,
  subject         text not null default '',
  grade           text not null default '',
  doc_type        text,  -- 'lesson_plan' | 'ppt' | 'courseware_2d' | 'courseware_3d' | 'office_doc' | 'other'
  file_name       text not null default '',
  file_size       int  not null default 0,
  file_kind       text not null default 'other',  -- 'doc' | 'ppt' | 'pdf' | 'image' | 'other'
  file_path       text not null default '',  -- storage 对象名，位于 `resources` 桶
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected')),
  review_note     text not null default '',
  granted_credits int  not null default 0,
  is_public       boolean not null default false,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid
);

create index if not exists teacher_resources_owner_idx
  on public.teacher_resources (owner_id, created_at desc);
create index if not exists teacher_resources_status_idx
  on public.teacher_resources (status);
create index if not exists teacher_resources_public_idx
  on public.teacher_resources (is_public) where is_public;

comment on table  public.teacher_resources is '校本资源库：教师上传的优秀教学案例元数据 + 审核/积分状态';
comment on column public.teacher_resources.file_path is 'storage 对象名，格式 r/{ownerId}/{uuid}/{filename}，位于 resources 桶';
comment on column public.teacher_resources.granted_credits is '审核通过时管理员授予的积分（>=0）';

-- ---------------------------------------------------------------------------
-- 2. updated_at 自动维护（沿用 0001 的 public.touch_updated_at()）
-- ---------------------------------------------------------------------------
drop trigger if exists trg_teacher_resources_touch on public.teacher_resources;
create trigger trg_teacher_resources_touch
  before update on public.teacher_resources
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Storage 桶 `resources`（公开读，与 docs 桶一致）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('resources', 'resources', true)
on conflict (id) do update set public = true;

-- ---------------------------------------------------------------------------
-- 4. 辅助函数：从存储对象路径解析归属者
--    路径格式：r/{ownerId}/{uuid}/{filename}
--    SECURITY DEFINER 绕过 RLS，供 Storage 策略判断「这个对象归谁」
-- ---------------------------------------------------------------------------
create or replace function public.resource_object_owner(object_name text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id
    from public.profiles
   where id = (
     (regexp_match(object_name, '^r/([0-9a-fA-F-]{36})/'))[1]
   )::uuid
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. Storage 对象策略（桶 resources）
-- ---------------------------------------------------------------------------
drop policy if exists resources_select_public on storage.objects;
create policy resources_select_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'resources');

drop policy if exists resources_insert_owner on storage.objects;
create policy resources_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'resources'
    and public.resource_object_owner(name) = (select auth.uid())
  );

drop policy if exists resources_update_owner on storage.objects;
create policy resources_update_owner on storage.objects
  for update to authenticated
  using (
    bucket_id = 'resources'
    and public.resource_object_owner(name) = (select auth.uid())
  )
  with check (
    bucket_id = 'resources'
    and public.resource_object_owner(name) = (select auth.uid())
  );

drop policy if exists resources_delete_owner on storage.objects;
create policy resources_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'resources'
    and public.resource_object_owner(name) = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. RLS（红线：全表开启，无一例外）
-- ---------------------------------------------------------------------------
alter table public.teacher_resources enable row level security;

-- 读：本人全部可读
drop policy if exists teacher_resources_select_owner on public.teacher_resources;
create policy teacher_resources_select_owner on public.teacher_resources
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- 读：is_public 的资源全体登录教师可读
drop policy if exists teacher_resources_select_public on public.teacher_resources;
create policy teacher_resources_select_public on public.teacher_resources
  for select to authenticated
  using (is_public);

-- 读：管理员可读全部（审核台用）
drop policy if exists teacher_resources_select_admin on public.teacher_resources;
create policy teacher_resources_select_admin on public.teacher_resources
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
       where id = (select auth.uid()) and role = 'admin'
    )
  );

-- 写：仅本人可增
drop policy if exists teacher_resources_insert_owner on public.teacher_resources;
create policy teacher_resources_insert_owner on public.teacher_resources
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

-- 写：仅本人可改（pending 阶段自助维护）
drop policy if exists teacher_resources_update_owner on public.teacher_resources;
create policy teacher_resources_update_owner on public.teacher_resources
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- 写：仅本人可删
drop policy if exists teacher_resources_delete_owner on public.teacher_resources;
create policy teacher_resources_delete_owner on public.teacher_resources
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. RPC：管理员审核通过（送积分 + 标记公开/沉淀）
-- ---------------------------------------------------------------------------
create or replace function public.approve_teacher_resource(
  p_resource_id     uuid,
  p_granted_credits int default 0,
  p_is_public       boolean default false,
  p_review_note     text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- 身份校验：仅管理员可操作（非管理员直接报错）
  if not exists (
    select 1 from public.profiles
     where id = (select auth.uid()) and role = 'admin'
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select owner_id into v_owner
    from public.teacher_resources
   where id = p_resource_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  update public.teacher_resources
     set status          = 'approved',
         granted_credits = greatest(p_granted_credits, 0),
         is_public       = p_is_public,
         review_note     = coalesce(p_review_note, ''),
         reviewed_at     = now(),
         reviewed_by     = (select auth.uid())
   where id = p_resource_id;

  if greatest(p_granted_credits, 0) > 0 then
    perform public.apply_credit(
      p_user_id   => v_owner,
      p_delta     => greatest(p_granted_credits, 0),
      p_reason    => 'resource_reward',
      p_ref_type  => 'resource',
      p_ref_id    => p_resource_id::text,
      p_memo      => '审核通过赠送积分（优秀教学案例）'
    );
  end if;

  return jsonb_build_object('ok', true, 'granted', greatest(p_granted_credits, 0));
end;
$$;

revoke all on function public.approve_teacher_resource(uuid, int, boolean, text) from public;
grant execute on function public.approve_teacher_resource(uuid, int, boolean, text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC：管理员驳回
-- ---------------------------------------------------------------------------
create or replace function public.reject_teacher_resource(
  p_resource_id uuid,
  p_review_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
     where id = (select auth.uid()) and role = 'admin'
  ) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.teacher_resources
     set status      = 'rejected',
         review_note = coalesce(p_review_note, ''),
         reviewed_at = now(),
         reviewed_by = (select auth.uid())
   where id = p_resource_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reject_teacher_resource(uuid, text) from public;
grant execute on function public.reject_teacher_resource(uuid, text) to service_role, authenticated;
