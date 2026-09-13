-- =============================================================================
-- 0020_credit_expiry.sql
-- 注册赠送体验积分 7 天过期 + FIFO（先扣最快到期）+ 到期自动作废
--
-- 设计要点（资金逻辑保守，余额（credit_accounts.balance）永远是权威真相源）：
--   1. credit_lots 记录每一笔「收入」的剩余量与过期时间，是 FIFO 扣减的批次真相源；
--   2. apply_credit 统一维护 balance + credit_lots + credit_transactions：
--        - 正变动（发放）：记一条 lot（带 expires_at），再调余额；
--        - 负变动（生成扣减 / 管理员减）：按 expires_at 升序（null 永放最后）从 lot 扣减；
--   3. void_expired_credits：把已过期 lot 的剩余量清零并同步调减余额（不超过当前余额）；
--   4. reserve_credits 扣前先作废过期积分，再校验余额，扣减走 apply_credit（FIFO）；
--   5. 注册触发器：建积分账户时，把赠送体验积分登记为一条带 7 天过期的 lot；
--   6. 配置 registerGiftDays（默认 7，0 = 永不过期），过期天数走配置、不写死；
--   7. get_my_summary / admin_list_users 展示余额时剔除「已过期但尚未触发作废」部分，保证一致。
--
-- 注意：本机无 Supabase 实例，无法真连库执行；正确性问题见文件末尾「自测说明」。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 流水原因枚举增加 'expire'（过期作废）
-- ---------------------------------------------------------------------------
alter type public.ledger_reason_enum add value if not exists 'expire';

-- ---------------------------------------------------------------------------
-- 2. credit_transactions 增加 expires_at（便于流水追溯有效期 / 过期时间）
-- ---------------------------------------------------------------------------
alter table public.credit_transactions
  add column if not exists expires_at timestamptz;

create index if not exists credit_tx_expires_idx
  on public.credit_transactions (user_id, expires_at) where expires_at is not null;

-- ---------------------------------------------------------------------------
-- 3. credit_lots：积分批次（lot），记录每笔收入的剩余量与过期时间
-- ---------------------------------------------------------------------------
create table if not exists public.credit_lots (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  amount     integer not null check (amount >= 0),      -- 原始发放量
  remaining  integer not null check (remaining >= 0),  -- 剩余可花
  expires_at timestamptz,                               -- null = 永久有效
  reason     public.ledger_reason_enum not null,
  ref_type   text not null default '',
  ref_id     text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists credit_lots_user_exp_idx
  on public.credit_lots (user_id, expires_at) where expires_at is not null;
create index if not exists credit_lots_user_rem_idx
  on public.credit_lots (user_id) where remaining > 0;

-- 仅经 SECURITY DEFINER RPC 访问，客户端无策略（默认全拒），不暴露给 anon
alter table public.credit_lots enable row level security;

-- ---------------------------------------------------------------------------
-- 4. 配置：注册赠送有效期（天），默认 7；0 = 永不过期
-- ---------------------------------------------------------------------------
update public.system_config
   set value = jsonb_set(value, '{registerGiftDays}', to_jsonb(7))
 where key = 'credit';

-- ---------------------------------------------------------------------------
-- 5. 重写 apply_credit：统一维护 balance + credit_lots + credit_transactions
--    - 正变动：记 lot（带 expires_at）+ 调余额；
--    - 负变动（生成扣减 / 管理员减）：按到期顺序 FIFO 从 lot 扣减。
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit(
  p_user_id uuid,
  p_delta integer,
  p_reason public.ledger_reason_enum,
  p_ref_type text default '',
  p_ref_id text default '',
  p_memo text default '',
  p_tokens_in integer default 0,
  p_tokens_out integer default 0,
  p_model text default '',
  p_cost_cny numeric default 0,
  p_operator_id uuid default null,
  p_expires_at timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_lot public.credit_lots%rowtype;
  v_need integer;
  v_take integer;
begin
  -- 行锁：并发下串行化，保证余额不超额
  select balance into v_balance
    from public.credit_accounts
   where user_id = p_user_id
     for update;

  if not found then
    insert into public.credit_accounts (user_id, balance, total_earned)
    values (p_user_id, 0, 0);
    v_balance := 0;
  end if;

  -- 收入：记 lot + 调余额 + 写流水
  if p_delta > 0 then
    v_balance := v_balance + p_delta;

    update public.credit_accounts
       set balance = v_balance,
           total_earned = total_earned + p_delta,
           updated_at = now()
     where user_id = p_user_id;

    insert into public.credit_lots (user_id, amount, remaining, expires_at, reason, ref_type, ref_id)
    values (p_user_id, p_delta, p_delta, p_expires_at, p_reason, p_ref_type, p_ref_id);

    insert into public.credit_transactions
      (user_id, delta, balance_after, reason, ref_type, ref_id,
       tokens_in, tokens_out, model, cost_cny, memo, operator_id, expires_at)
    values
      (p_user_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id,
       p_tokens_in, p_tokens_out, p_model, coalesce(p_cost_cny, 0), p_memo, p_operator_id, p_expires_at);

    return v_balance;
  end if;

  -- 支出：FIFO 从「未过期 lot」中扣减（expires_at 升序，null 永久放最后）
  if p_delta < 0 then
    v_need := -p_delta;
    for v_lot in
      select * from public.credit_lots
       where user_id = p_user_id and remaining > 0
         and (expires_at is null or expires_at > now())
       order by expires_at asc nulls last, id asc
       for update
    loop
      exit when v_need <= 0;
      v_take := least(v_lot.remaining, v_need);
      update public.credit_lots set remaining = remaining - v_take where id = v_lot.id;
      v_need := v_need - v_take;
    end loop;

    v_balance := v_balance + p_delta;   -- p_delta < 0
    if v_balance < 0 then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;

    update public.credit_accounts
       set balance = v_balance,
           total_used = total_used + (-p_delta),
           updated_at = now()
     where user_id = p_user_id;

    insert into public.credit_transactions
      (user_id, delta, balance_after, reason, ref_type, ref_id,
       tokens_in, tokens_out, model, cost_cny, memo, operator_id, expires_at)
    values
      (p_user_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id,
       p_tokens_in, p_tokens_out, p_model, coalesce(p_cost_cny, 0), p_memo, p_operator_id, null);

    return v_balance;
  end if;

  -- p_delta = 0：无操作
  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. void_expired_credits：把已过期 lot 剩余量清零并同步调减余额
--    保守：单次调减不超过当前余额，绝不让余额变负。
--    可周期性由 Edge Function（service_role）调用 void_expired_credits(null) 全量清扫；
--    客户端路径 reserve_credits 在扣前也会先对本用户作废一次。
-- ---------------------------------------------------------------------------
create or replace function public.void_expired_credits(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot public.credit_lots%rowtype;
  v_balance integer;
  v_deduct integer;
  v_count integer := 0;
begin
  for v_lot in
    select * from public.credit_lots
     where remaining > 0 and expires_at is not null and expires_at <= now()
       and (p_user_id is null or user_id = p_user_id)
     order by user_id, expires_at asc
     for update of credit_lots
  loop
    select balance into v_balance
      from public.credit_accounts where user_id = v_lot.user_id for update;

    v_deduct := least(v_lot.remaining, greatest(v_balance, 0));
    if v_deduct > 0 then
      update public.credit_accounts
         set balance = balance - v_deduct, updated_at = now()
       where user_id = v_lot.user_id;

      insert into public.credit_transactions
        (user_id, delta, balance_after, reason, ref_type, ref_id, memo)
      values
        (v_lot.user_id, -v_deduct,
         (select balance from public.credit_accounts where user_id = v_lot.user_id),
         'expire', 'expire', v_lot.id::text, '体验积分过期自动作废');
    end if;

    update public.credit_lots set remaining = remaining - v_deduct where id = v_lot.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. 重写 reserve_credits：扣前先作废过期积分 → 余额校验 → FIFO 扣减
-- ---------------------------------------------------------------------------
create or replace function public.reserve_credits(
  p_amount integer,
  p_job_id uuid,
  p_app_type text default 'auto',
  p_model text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
  v_existing integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'UNAUTHORIZED');
  end if;

  -- 扣前先作废过期积分，保证余额真实（保守）
  perform public.void_expired_credits(v_uid);

  -- 幂等：同一 job 已预扣过则直接返回当前余额
  select balance_after into v_existing
    from public.credit_transactions
   where ref_type = 'generate_spend' and ref_id = p_job_id::text;

  if found then
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
    return jsonb_build_object('ok', true, 'balance', coalesce(v_balance, 0), 'code', '', 'idempotent', true);
  end if;

  select balance into v_balance
    from public.credit_accounts
   where user_id = v_uid
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'INSUFFICIENT_CREDITS');
  end if;

  if v_balance < p_amount then
    return jsonb_build_object('ok', false, 'balance', v_balance, 'code', 'INSUFFICIENT_CREDITS');
  end if;

  v_balance := public.apply_credit(
    p_user_id   => v_uid,
    p_delta     => -p_amount,
    p_reason    => 'generate_spend',
    p_ref_type  => 'generate_spend',
    p_ref_id    => p_job_id::text,
    p_memo      => format('生成%s应用预扣', coalesce(p_app_type, '')),
    p_model     => coalesce(p_model, '')
  );

  return jsonb_build_object('ok', true, 'balance', v_balance, 'code', '', 'idempotent', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. get_my_summary：展示余额剔除「已过期但尚未触发作废」部分，保持一致
-- ---------------------------------------------------------------------------
create or replace function public.get_my_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_balance integer;
begin
  if v_uid is null then
    return jsonb_build_object('balance', 0, 'totalEarned', 0, 'totalUsed', 0, 'membership', null);
  end if;

  select coalesce(c.balance, 0) - coalesce((
           select sum(l.remaining) from public.credit_lots l
            where l.user_id = v_uid and l.remaining > 0
              and l.expires_at is not null and l.expires_at <= now()
         ), 0)
    into v_balance
    from public.credit_accounts c
   where c.user_id = v_uid;

  return jsonb_build_object(
    'balance',     coalesce(v_balance, 0),
    'totalEarned', coalesce((select total_earned from public.credit_accounts where user_id = v_uid), 0),
    'totalUsed',   coalesce((select total_used from public.credit_accounts where user_id = v_uid), 0),
    'membership',  (
      select jsonb_build_object(
               'planId', m.plan_id,
               'planName', p.name,
               'expiresAt', m.expires_at,
               'status', m.status
             )
        from public.user_memberships m
        left join public.membership_plans p on p.id = m.plan_id
       where m.user_id = v_uid
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. 触发器：注册建积分账户时，把赠送体验积分登记为一条带过期的 lot
--    （handle_new_user 直接 insert credit_accounts，这里在其后自动补 lot，零侵入）
-- ---------------------------------------------------------------------------
create or replace function public.tag_register_gift_lot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := 7;
  v_exp timestamptz;
begin
  if new.balance <= 0 then
    return new;
  end if;

  select coalesce((value ->> 'registerGiftDays')::integer, 7)
    into v_days
    from public.system_config
   where key = 'credit';

  v_exp := case when coalesce(v_days, 0) > 0
             then now() + (v_days || ' days')::interval
             else null end;

  insert into public.credit_lots (user_id, amount, remaining, expires_at, reason, ref_type, ref_id)
  values (new.user_id, new.balance, new.balance, v_exp, 'register_gift', 'register_gift', new.user_id::text);

  return new;
end;
$$;

drop trigger if exists trg_credit_accounts_gift_lot on public.credit_accounts;
create trigger trg_credit_accounts_gift_lot
  after insert on public.credit_accounts
  for each row execute function public.tag_register_gift_lot();

-- ---------------------------------------------------------------------------
-- 10. 授权（create or replace 保留 ACL；这里再显式授一次，幂等）
--     void_expired_credits 供 Edge Function（service_role）全量清扫；apply_credit 仅内部调用，无需客户端授权。
-- ---------------------------------------------------------------------------
grant execute on function public.void_expired_credits(uuid) to service_role;

-- =============================================================================
-- 自测说明（本机无 Supabase 实例，无法真连库执行；以下为部署后应覆盖的断言，
-- 可在 Supabase SQL Editor / Edge Function 中验证）：
--   1) 发放：新用户注册后 credit_lots 应有一条 reason='register_gift'、
--            expires_at≈ now()+7d 的 lot，remaining = registerGift（默认 100）。
--   2) 7 天内消费：reserve_credits(job) 成功扣减，FIFO 优先消耗该 gift lot
--            （其 expires_at 最早；若同时有其他永久 lot，则 gift 先被扣）。
--   3) 7 天后过期：void_expired_credits(uid) 将该 lot remaining 置 0，并把余额扣回；
--            get_my_summary().balance 不再含过期部分（展示已自动剔除）。
--   4) 余额正确：总 gift 100 → 消费 2 → 余额 98；若 100 一直未消费，过期后余额回到 0。
--   5) 保守性：余额永不为负（void / 扣减都受 balance>=0 约束）。
-- =============================================================================
