-- =============================================================================
-- 0021_admin_users.sql
-- 后台「查看注册用户」增强（复用既有 admin_* RPC 体系，不另起炉灶）
--
-- 改动点（在既有 admin_list_users 上补强）：
--   1. 增加 email（来自 auth.users，仅管理员经 SECURITY DEFINER 可见）、generation_count（生成次数）；
--   2. 分页上限收紧到每页 ≤ 50（p_limit 被 clamp 到 [1,50]），防脚本批量爬取；
--   3. 身份校验不变：函数体内校验调用者 role='admin'，非管理员直接 raise 42501；
--   4. 余额剔除「已过期但尚未触发作废」的体验积分，与 get_my_summary 口径一致；
--   5. 反爬要点：列表接口为 SECURITY DEFINER RPC（PII 不进任何视图、不暴露给 anon），
--      RLS 对相关表默认全拒；最小化限频建议后续在 Edge Function 层做
--      （如 supabase.functions 限流 / 网关层 WAF），本次把分页上限 + 身份校验做扎实。
--
-- 说明：本 RPC 经 SECURITY DEFINER 读取 auth.users.email 与 generation_jobs，
--       绕过客户端 RLS，故 PII 绝不会下发到非 admin 客户端。
-- =============================================================================

create or replace function public.admin_list_users(
  p_q      text default null,
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id               uuid,
  nickname         text,
  role             public.user_role_enum,
  email            text,
  balance          integer,
  plan_id          text,
  generation_count bigint,
  created_at       timestamptz,
  total_count      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- 身份校验：仅管理员可查看（非管理员直接报错，绝不返回数据）
  if not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then
    raise exception '仅管理员可查看用户' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.nickname,
    p.role,
    coalesce(au.email, ''),
    -- 余额剔除已过期但尚未触发作废的体验积分
    coalesce(c.balance, 0) - coalesce((
      select sum(l.remaining) from public.credit_lots l
       where l.user_id = p.id and l.remaining > 0
         and l.expires_at is not null and l.expires_at <= now()
    ), 0),
    m.plan_id,
    coalesce((
      select count(*) from public.generation_jobs g where g.user_id = p.id
    ), 0),
    p.created_at,
    (count(*) over())::bigint
  from public.profiles p
  left join public.credit_accounts c on c.user_id = p.id
  left join public.user_memberships m on m.user_id = p.id
  left join auth.users au on au.id = p.id
  where (p_q is null or p_q = '' or p.nickname ilike '%' || p_q || '%' or au.email ilike '%' || p_q || '%')
  order by p.created_at desc
  -- 分页上限收紧到每页 ≤ 50（防批量爬取）
  limit least(greatest(coalesce(p_limit, 50), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- 重新显式授权（create or replace 保留 ACL，这里幂等再授一次）
grant execute on function public.admin_list_users(text, integer, integer) to anon, authenticated, service_role;
