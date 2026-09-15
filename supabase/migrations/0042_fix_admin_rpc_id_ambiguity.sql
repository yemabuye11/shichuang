-- =============================================================================
-- 0042_fix_admin_rpc_id_ambiguity.sql
--
-- 线上 Bug：管理后台「注册用户」/「待充值（代充值）」两个 Tab 打开即报
--     ERROR: column reference "id" is ambiguous   (SQLSTATE 42702)
--
-- 根因（plpgsql 变量与列名冲突，不是 PostgREST 联表 select）：
--   `returns table (id uuid, ...)` 的**输出列名会被 plpgsql 声明成同名变量**。
--   这些管理员 RPC 的身份校验又写成了未限定的
--       select 1 from public.profiles where id = auth.uid() and role = 'admin'
--   于是函数体里的裸 `id` 既可能指输出变量 `id`，也可能指 `profiles.id`，
--   PL/pgSQL 默认 `#variable_conflict error` → 抛出 42702。
--
--   命中条件 = 「返回表里有 id 列」且「函数体里有裸 id」：
--     * public.admin_list_users(text,integer,integer)   ← 注册用户 Tab（报错外显）
--     * public.admin_list_recharge(text,integer)        ← 待充值 Tab（报错外显）
--     * public.admin_list_reports(text,integer,integer) ← 概览 Tab 举报列表
--       （同样坏，但 AdminPage 用 .catch(() => []) 吞掉了，表现为列表永远为空）
--   反证：admin_list_codes 的返回表里没有 id 列，同样的裸写法不冲突 → 兑换码页正常。
--
-- 修法（治本）：
--   1. 所有管理员身份校验改成带别名限定：`public.profiles pr where pr.id = ... and pr.role = 'admin'`；
--   2. 函数体内其余裸列名（`where id = p_id` / `select * into ... where id = ...`）一并加别名；
--   3. `admin_list_users` 需要改 RETURNS TABLE 列类型（balance integer → numeric(10,2)，
--      对齐 0039 的小数余额），CREATE OR REPLACE 不允许改返回类型（42P13），
--      故沿用 0021 的 drop + create，再显式补授权（drop 会丢 ACL）。
--
-- 幂等：drop if exists + create or replace + grant 均可重复执行；
--       保留 security definer / set search_path = public / stable 与原有授权范围。
--
-- 说明：本机没有 Postgres / Supabase 实例，无法本地复现；
--       本修复点由逐行阅读 0009 / 0021 / 0022 的函数体 SQL 定位（见上方根因分析）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. admin_list_users：注册用户列表（drop + create：返回类型 balance 改 numeric）
-- ---------------------------------------------------------------------------
drop function if exists public.admin_list_users(text, integer, integer);

create function public.admin_list_users(
  p_q      text default null,
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id               uuid,
  nickname         text,
  role             public.user_role_enum,
  email            text,
  balance          numeric(10, 2),   -- 0039 起余额为小数，注册用户页按小数口径展示
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
  -- 注意：`id` / `role` 是本函数返回列名（plpgsql 变量），
  --       因此这里**必须**用表别名 pr 限定，否则触发 42702 ambiguous。
  if not exists (
    select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin'
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
    coalesce(c.balance, 0)::numeric(10, 2) - coalesce((
      select sum(l.remaining) from public.credit_lots l
       where l.user_id = p.id and l.remaining > 0
         and l.expires_at is not null and l.expires_at <= now()
    ), 0)::numeric(10, 2),
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

-- ---------------------------------------------------------------------------
-- 2. admin_list_recharge：待充值（代充值）请求列表
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_recharge(
  p_status text default 'pending',
  p_limit  integer default 50
)
returns table (
  id              uuid,
  user_id         uuid,
  nickname        text,
  plan_id         text,
  plan_name       text,
  amount_cny      numeric,
  pay_method      text,
  status          text,
  proof_text      text,
  proof_image_url text,
  created_at      timestamptz,
  handled_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- `id` 是本函数返回列名（plpgsql 变量），必须限定为 pr.id，否则 42702 ambiguous。
  if not exists (
    select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin'
  ) then
    raise exception '仅管理员可查看充值请求' using errcode = '42501';
  end if;

  return query
  select r.id, r.user_id, p.nickname, r.plan_id, mp.name, r.amount_cny, r.pay_method, r.status,
         r.proof_text, r.proof_image_url, r.created_at, r.handled_at
    from public.recharge_requests r
    left join public.profiles p on p.id = r.user_id
    left join public.membership_plans mp on mp.id = r.plan_id
   where (p_status is null or p_status = '' or r.status = p_status)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 50);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. admin_approve_recharge：确认 / 拒绝充值到账（代充值动作）
--    返回 jsonb（无 id 输出列），本不会触发 42702，但同类裸 id 一并限定
-- ---------------------------------------------------------------------------
create or replace function public.admin_approve_recharge(p_id uuid, p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_req     public.recharge_requests%rowtype;
  v_plan    public.membership_plans%rowtype;
  v_balance integer := 0;
begin
  if not exists (
    select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin'
  ) then
    raise exception '仅管理员可确认充值' using errcode = '42501';
  end if;

  select * into v_req from public.recharge_requests rq where rq.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', '充值请求不存在');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_HANDLED',
                              'message', format('该请求已处理（%s），无需重复操作', v_req.status));
  end if;

  if p_ok then
    if v_req.plan_id is null or v_req.plan_id = '' then
      return jsonb_build_object('ok', false, 'code', 'NO_PLAN',
                                'message', '该请求未选择套餐，无法到账');
    end if;

    select * into v_plan from public.membership_plans mp where mp.id = v_req.plan_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND',
                                'message', '套餐不存在，无法到账');
    end if;
    if v_plan.credits <= 0 then
      return jsonb_build_object('ok', false, 'code', 'ZERO_CREDITS',
                                'message', '套餐积分为 0，无需到账');
    end if;

    v_balance := public.apply_credit(
      p_user_id   => v_req.user_id,
      p_delta     => v_plan.credits,
      p_reason    => 'recharge_self',
      p_ref_type  => 'recharge',
      p_ref_id    => p_id::text,
      p_memo      => format('自助充值到账：%s ¥%s（%s）',
                            v_plan.name, v_req.amount_cny, v_req.pay_method)
    );
  end if;

  update public.recharge_requests rq
     set status     = case when p_ok then 'approved' else 'rejected' end,
         handled_by = v_uid,
         handled_at = now()
   where rq.id = p_id;

  return jsonb_build_object(
    'ok',      true,
    'status',  case when p_ok then 'approved' else 'rejected' end,
    'balance', coalesce(v_balance, 0),
    'message', case when p_ok then '已确认到账' else '已拒绝该请求' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_adjust_credits：手工给老师加 / 减积分（代充值）
--    返回 jsonb（无 id 输出列），同类裸 id 一并限定
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_credits(
  p_user_id uuid,
  p_delta   integer,
  p_memo    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance integer;
begin
  if not exists (
    select 1 from public.profiles pr where pr.id = v_uid and pr.role = 'admin'
  ) then
    raise exception '仅管理员可调整积分' using errcode = '42501';
  end if;
  if p_delta = 0 then
    return jsonb_build_object('ok', false, 'balance', 0, 'message', '调整数量不能为 0');
  end if;

  begin
    v_balance := public.apply_credit(
      p_user_id    => p_user_id,
      p_delta      => p_delta,
      p_reason     => 'admin_adjust',
      p_ref_type   => 'admin',
      p_ref_id     => v_uid::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
      p_memo       => coalesce(nullif(trim(p_memo), ''), '管理员手动调整'),
      p_operator_id => v_uid
    );
  exception when others then
    return jsonb_build_object('ok', false, 'balance', 0, 'message', '调整失败：余额不足');
  end;

  return jsonb_build_object('ok', true, 'balance', v_balance, 'message', '已调整');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. admin_list_reports：概览 Tab 举报列表
--    返回表里**有** id 列 → 与 admin_list_users 完全相同的 42702，
--    之前被 AdminPage 的 .catch(() => []) 吞掉，表现为列表永远为空
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_reports(
  p_status text default 'pending',
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id         bigint,
  app_id     uuid,
  app_title  text,
  reason     text,
  detail     text,
  status     public.report_status_enum,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- `id` 是本函数返回列名（plpgsql 变量），必须限定为 pr.id，否则 42702 ambiguous。
  if not exists (
    select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin'
  ) then
    raise exception '仅管理员可查看举报' using errcode = '42501';
  end if;

  return query
  select r.id, r.app_id, a.title, r.reason, r.detail, r.status, r.created_at,
         (count(*) over())::bigint
    from public.reports r
    left join public.apps a on a.id = r.app_id
   where (p_status is null or p_status = '' or r.status::text = p_status)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. admin_list_codes：同类裸 id 写法（返回表里没有 id 列，当前不报错，
--    但一旦有人给返回表加 id 列就会复现，故一并限定）
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_codes(
  p_kind    text default null,
  p_status  text default null,
  p_batch_no text default null,
  p_offset  integer default 0,
  p_limit   integer default 100
)
returns table (
  code        text,
  kind        public.redemption_kind_enum,
  plan_id     text,
  credits     integer,
  valid_days  integer,
  batch_no    text,
  status      public.redemption_status_enum,
  used_by     uuid,
  used_by_name text,
  used_at     timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz,
  memo        text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles pr where pr.id = auth.uid() and pr.role = 'admin'
  ) then
    raise exception '仅管理员可查看兑换码' using errcode = '42501';
  end if;

  return query
  select r.code, r.kind, r.plan_id, r.credits, r.valid_days, r.batch_no, r.status,
         r.used_by, u.nickname, r.used_at, r.expires_at, r.created_at, r.memo,
         (count(*) over())::bigint
    from public.redemption_codes r
    left join public.profiles u on u.id = r.used_by
   where (p_kind     is null or p_kind     = '' or r.kind::text   = p_kind)
     and (p_status   is null or p_status   = '' or r.status::text = p_status)
     and (p_batch_no is null or p_batch_no = '' or r.batch_no     = p_batch_no)
   order by r.created_at desc, r.code
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 授权（create or replace 保留 ACL；admin_list_users 走过 drop，必须补授一次）
-- ---------------------------------------------------------------------------
grant execute on function public.admin_list_users(text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.admin_list_recharge(text, integer) to anon, authenticated, service_role;
grant execute on function public.admin_approve_recharge(uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to anon, authenticated, service_role;
grant execute on function public.admin_list_reports(text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.admin_list_codes(text, text, text, integer, integer) to anon, authenticated, service_role;
