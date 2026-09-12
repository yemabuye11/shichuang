-- =============================================================================
-- 0010_rls_policies.sql
-- 全表 ENABLE ROW LEVEL SECURITY（无一例外，ARCHITECTURE.md §8.7 红线）
--
-- 约定：
--   - 积分 / 兑换码相关写操作只允许经 SECURITY DEFINER RPC，不给任何写策略；
--   - 未登录（anon）只能看到 status='published' 的应用与公开配置；
--   - 作者信息经 public_authors 视图下发，只暴露 id / nickname / avatar_seed。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 开启 RLS
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.credit_accounts     enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.membership_plans    enable row level security;
alter table public.user_memberships    enable row level security;
alter table public.redemption_codes    enable row level security;
alter table public.apps                enable row level security;
alter table public.app_likes           enable row level security;
alter table public.app_views           enable row level security;
alter table public.reports             enable row level security;
alter table public.system_config       enable row level security;
alter table public.prompt_templates    enable row level security;
alter table public.model_profiles      enable row level security;
alter table public.app_type_profiles   enable row level security;
alter table public.generation_jobs     enable row level security;
alter table public.generation_daily    enable row level security;
alter table public.monthly_spend       enable row level security;
alter table public.events              enable row level security;

-- ---------------------------------------------------------------------------
-- profiles：本人可读写；作者昵称经视图下发
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = (select p.role from public.profiles p where p.id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- credit_accounts：本人可读；写入仅 RPC
-- ---------------------------------------------------------------------------
drop policy if exists credit_accounts_select_self on public.credit_accounts;
create policy credit_accounts_select_self on public.credit_accounts
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- credit_transactions：本人可读；只增不改不删
-- ---------------------------------------------------------------------------
drop policy if exists credit_tx_select_self on public.credit_transactions;
create policy credit_tx_select_self on public.credit_transactions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- membership_plans / user_memberships
-- ---------------------------------------------------------------------------
drop policy if exists membership_plans_select on public.membership_plans;
create policy membership_plans_select on public.membership_plans
  for select to anon, authenticated
  using (enabled);

drop policy if exists user_memberships_select_self on public.user_memberships;
create policy user_memberships_select_self on public.user_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- apps：anon 只看已发布；作者看自己的全部
-- ---------------------------------------------------------------------------
drop policy if exists apps_select_public on public.apps;
create policy apps_select_public on public.apps
  for select to anon
  using (status = 'published');

drop policy if exists apps_select_own_or_published on public.apps;
create policy apps_select_own_or_published on public.apps
  for select to authenticated
  using (status = 'published' or author_id = (select auth.uid()));

drop policy if exists apps_insert_own on public.apps;
create policy apps_insert_own on public.apps
  for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists apps_update_own on public.apps;
create policy apps_update_own on public.apps
  for update to authenticated
  using (author_id = (select auth.uid()) and status <> 'taken_down')
  with check (author_id = (select auth.uid()) and status <> 'taken_down');

drop policy if exists apps_delete_own on public.apps;
create policy apps_delete_own on public.apps
  for delete to authenticated
  using (author_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- app_likes：全表可读；本人可增删
-- ---------------------------------------------------------------------------
drop policy if exists app_likes_select on public.app_likes;
create policy app_likes_select on public.app_likes
  for select to anon, authenticated
  using (true);

drop policy if exists app_likes_insert_self on public.app_likes;
create policy app_likes_insert_self on public.app_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists app_likes_delete_self on public.app_likes;
create policy app_likes_delete_self on public.app_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- app_views / reports
-- app_views 仅 service_role 写入（无客户端策略 = 全拒）
-- reports 允许匿名插入；客户端不可 SELECT（防泄露举报人）
-- ---------------------------------------------------------------------------
drop policy if exists reports_insert_any on public.reports;
create policy reports_insert_any on public.reports
  for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- system_config：仅经 get_public_config() 暴露白名单；管理员可改
-- ---------------------------------------------------------------------------
drop policy if exists system_config_admin_update on public.system_config;
create policy system_config_admin_update on public.system_config
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists system_config_admin_insert on public.system_config;
create policy system_config_admin_insert on public.system_config
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- prompt_templates：核心资产，仅管理员可读可改
-- ---------------------------------------------------------------------------
drop policy if exists prompt_templates_admin_select on public.prompt_templates;
create policy prompt_templates_admin_select on public.prompt_templates
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists prompt_templates_admin_write on public.prompt_templates;
create policy prompt_templates_admin_write on public.prompt_templates
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

-- ---------------------------------------------------------------------------
-- model_profiles / app_type_profiles：enabled 的公开可读；写仅管理员
-- ---------------------------------------------------------------------------
drop policy if exists model_profiles_select_enabled on public.model_profiles;
create policy model_profiles_select_enabled on public.model_profiles
  for select to anon, authenticated
  using (enabled);

drop policy if exists model_profiles_admin_write on public.model_profiles;
create policy model_profiles_admin_write on public.model_profiles
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

drop policy if exists app_type_profiles_select on public.app_type_profiles;
create policy app_type_profiles_select on public.app_type_profiles
  for select to anon, authenticated
  using (enabled);

-- ---------------------------------------------------------------------------
-- generation_jobs：本人可读（前端重连与状态查询）
-- ---------------------------------------------------------------------------
drop policy if exists gen_jobs_select_self on public.generation_jobs;
create policy gen_jobs_select_self on public.generation_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- generation_daily / monthly_spend / redemption_codes / app_views：无客户端策略（全拒）

-- ---------------------------------------------------------------------------
-- events：埋点只进不出
-- ---------------------------------------------------------------------------
drop policy if exists events_insert_any on public.events;
create policy events_insert_any on public.events
  for insert to anon, authenticated
  with check (true);

-- ---------------------------------------------------------------------------
-- public_authors 视图：只暴露 id / nickname / avatar_seed
-- security_invoker=false → 以视图属主权限读取，绕过 profiles 的 RLS，
-- 从而让未登录访客也能看到作者署名（PRD P0-C6）。
-- ---------------------------------------------------------------------------
drop view if exists public.public_authors;
create view public.public_authors with (security_invoker = false) as
  select p.id, p.nickname, p.avatar_seed
    from public.profiles p
   where p.status = 'active';

grant select on public.public_authors to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 函数执行授权
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
         'get_public_config','estimate_cost','check_generation_allowed',
         'reserve_credits','settle_generation','refund_generation','redeem_code',
         'publish_app','unpublish_app','rename_app','delete_app','duplicate_app',
         'toggle_like','report_app','list_square','get_my_summary','track_event',
         'admin_create_codes','admin_list_codes','admin_disable_code',
         'admin_adjust_credits','admin_list_users','admin_upsert_plan',
         'admin_set_plan_enabled','admin_upsert_model','admin_upsert_app_type',
         'admin_takedown','admin_restore','admin_list_reports',
         'admin_handle_report','admin_stats'
       )
  loop
    execute format('grant execute on function public.%I(%s) to anon, authenticated, service_role',
                   f.proname, f.args);
  end loop;
end $$;

-- record_app_view 仅允许 service_role（Edge Function 使用 service_role key 调用）
revoke all on function public.record_app_view(uuid, text, date) from public;
revoke all on function public.record_app_view(uuid, text, date) from anon, authenticated;
grant execute on function public.record_app_view(uuid, text, date) to service_role;
