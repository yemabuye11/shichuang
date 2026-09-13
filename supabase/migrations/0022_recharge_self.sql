-- =============================================================================
-- 0022_recharge_self.sql
-- 自助充值：野马个人收款码 + 后台确认到账（无聚合支付、无商户资质、零费率）
--
-- 流程：
--   1) 老师在 RechargePage 看收款码 + 引导文案（system_config.payment）；
--   2) 扫码付款后，提交充值请求 → 写 recharge_requests（status='pending'）；
--   3) 野马在 AdminPage「待充值」Tab 点「确认到账」→ admin_approve_recharge：
--        - approved: 按 plan_id 查 membership_plans.credits，给该用户加积分（永久）；
--        - rejected: 仅置状态；
--   4) 积分走已有 apply_credit（reason='recharge_self', ref_type='recharge'），
--      留流水对账，ref_id=请求 uuid。
--
-- 安全约束：
--   - recharge_requests 启 RLS，客户端只能 insert / select 自己的行；
--   - 管理员读全部走 SECURITY DEFINER RPC（admin_list_recharge / admin_approve_recharge）；
--   - 公开读收款码配置走 get_system_config（SECURITY DEFINER）；
--   - 管理员写收款码配置走 admin_set_system_config（SECURITY DEFINER + role 校验）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 流水原因枚举增加 'recharge_self'（自助充值到账）
-- ---------------------------------------------------------------------------
alter type public.ledger_reason_enum add value if not exists 'recharge_self';

-- ---------------------------------------------------------------------------
-- 2. 充值请求表
-- ---------------------------------------------------------------------------
create table if not exists public.recharge_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  plan_id         text references public.membership_plans (id),
  amount_cny      numeric(10, 2) not null,
  pay_method      text not null check (pay_method in ('wechat', 'alipay')),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proof_text      text,
  proof_image_url text,
  created_at      timestamptz not null default now(),
  handled_by      uuid references public.profiles (id),
  handled_at      timestamptz
);

create index if not exists recharge_requests_user_idx
  on public.recharge_requests (user_id, created_at desc);
create index if not exists recharge_requests_status_idx
  on public.recharge_requests (status, created_at desc);

alter table public.recharge_requests enable row level security;

-- 用户可 insert 自己的、select 自己的
drop policy if exists recharge_requests_insert_self on public.recharge_requests;
create policy recharge_requests_insert_self on public.recharge_requests
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists recharge_requests_select_self on public.recharge_requests;
create policy recharge_requests_select_self on public.recharge_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. 公开读 system_config 单条 key（供未登录老师也能看收款码 + 引导文案）
-- ---------------------------------------------------------------------------
create or replace function public.get_system_config(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_value jsonb;
begin
  select value into v_value from public.system_config where key = p_key;
  return coalesce(v_value, '{}'::jsonb);
end;
$$;

grant execute on function public.get_system_config(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 管理员写 system_config（SECURITY DEFINER + role 校验）
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_system_config(p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可维护系统配置' using errcode = '42501';
  end if;

  insert into public.system_config (key, value, updated_at, updated_by)
  values (p_key, coalesce(p_value, '{}'::jsonb), now(), v_uid)
  on conflict (key) do update
    set value      = excluded.value,
        updated_at = now(),
        updated_by = excluded.updated_by;

  return coalesce(p_value, '{}'::jsonb);
end;
$$;

grant execute on function public.admin_set_system_config(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. 管理员：确认 / 拒绝充值请求
--    - p_ok=true  时按 plan_id 查 membership_plans.credits 加积分（永久）；
--    - plan_id 为空 / 套餐不存在 / credits=0 时返回 ok=false（不修改状态）。
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
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可确认充值' using errcode = '42501';
  end if;

  select * into v_req from public.recharge_requests where id = p_id for update;
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

    select * into v_plan from public.membership_plans where id = v_req.plan_id;
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

  update public.recharge_requests
     set status     = case when p_ok then 'approved' else 'rejected' end,
         handled_by = v_uid,
         handled_at = now()
   where id = p_id;

  return jsonb_build_object(
    'ok',      true,
    'status',  case when p_ok then 'approved' else 'rejected' end,
    'balance', coalesce(v_balance, 0),
    'message', case when p_ok then '已确认到账' else '已拒绝该请求' end
  );
end;
$$;

grant execute on function public.admin_approve_recharge(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. 管理员：分页列出充值请求（≤50，防批量爬取）
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
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
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

grant execute on function public.admin_list_recharge(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. 种子：payment key 兜底（缺图仍可显示引导文案）
-- ---------------------------------------------------------------------------
insert into public.system_config (key, value, description)
values (
  'payment',
  jsonb_build_object(
    'wechatQrUrl', '',
    'alipayQrUrl', '',
    'tip', '选套餐 → 扫下方码付款（备注你的账号名）→ 付款后点"我已付款"提交凭证 → 管理员核对后积分到账'
  ),
  '个人收款码 + 引导文案（自助充值）'
)
on conflict (key) do nothing;