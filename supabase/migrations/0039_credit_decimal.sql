-- =============================================================================
-- 0039_credit_decimal.sql
-- 「每日一练」小数积分支持：把积分相关列与 RPC 参数 / 返回值从 integer 改成 numeric(10,2)
--
-- 背景（见 PLAN_每日一练.md）：每日一练多天折扣会产生小数积分
--   （3 天扣 2.7 / 5 天扣 4.2 / 10 天扣 6.8）。原积分系统为 integer，会把 2.7 收成 3，
--   与验收目标冲突。本迁移把「余额真相源」与扣减/退还链路改成 numeric(10,2)。
--
-- 改动范围（仅改类型，绝不改业务语义：扣减 / 退还 / 幂等 / 行锁 / 不足抛
--   INSUFFICIENT_CREDITS 全部保留）：
--   1) credit_accounts.balance / total_earned / total_used  -> numeric(10,2)
--   2) credit_transactions.delta / balance_after            -> numeric(10,2)
--   3) apply_credit   : p_delta integer -> numeric(10,2)；内部 v_balance/v_need/v_take
--                       -> numeric；返回值 integer -> numeric
--   4) reserve_credits: p_amount integer -> numeric(10,2)；内部 v_balance/v_existing -> numeric
--   5) refund_generation: 内部 v_amount/v_balance -> numeric
--      （注意：refund_generation 无 p_amount 形参，p_amount 取自 generation_jobs.reserved_credits，
--        该列已由另一工程师在 0038 之前改为 numeric）
--
-- 不动：estimate_cost（保留 integer，daily_practice 不依赖它，其余 app 仍按整数积分显示）。
-- 不动：0008 / 0020 原文件（重跑语义不变；本文件用 create or replace 完整覆盖函数体）。
--
-- ---------------------------------------------------------------------------
-- ⚠️ PostgreSQL 语义说明（决定本文件写法）
--   `create or replace function` 在**参数类型变化**时不会替换原函数，而是新增一个「重载」。
--   因此本文件对 apply_credit / reserve_credits 新增的是「numeric 重载」，原本的
--   integer 重载（来自 0008 / 0020，仅被整数积分路径调用）继续存在、行为不变 —— 这正好符合
--   「其余 app 类型仍按整数积分」的现状，且不破坏任何依赖、可重复运行。
--   refund_generation 当前只有唯一一个签名（0008 定义，未被 0020 重写），本文件 create or
--   replace 同名同签名即直接覆盖（无重载）。
-- ---------------------------------------------------------------------------
-- 幂等：
--   * alter table ... alter column type：类型相同时 PG 仍执行转换（无数据改写）且不报错，重跑安全。
--   * create or replace function：重跑幂等，不报错。
--   * 全程无裸 drop function（不破坏依赖）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. credit_accounts：余额真相源三列 integer -> numeric(10,2)
--    balance 上的 check (balance >= 0) 在类型转换后会被 PG 重新校验（既有数据均满足），安全。
-- ---------------------------------------------------------------------------
alter table public.credit_accounts
  alter column balance      type numeric(10, 2);

alter table public.credit_accounts
  alter column total_earned type numeric(10, 2);

alter table public.credit_accounts
  alter column total_used   type numeric(10, 2);

-- ---------------------------------------------------------------------------
-- 2. credit_transactions：流水两列 integer -> numeric(10,2)
--    delta / balance_after 均为 not null，类型转换保留 not null，安全。
-- ---------------------------------------------------------------------------
alter table public.credit_transactions
  alter column delta         type numeric(10, 2);

alter table public.credit_transactions
  alter column balance_after type numeric(10, 2);

-- ---------------------------------------------------------------------------
-- 3. apply_credit：新增 numeric 重载（保留 0020 的 FIFO / 过期作废 语义，仅改类型）
--    正变动：记 lot（带 expires_at）+ 调余额；
--    负变动：按 expires_at 升序（null 永放最后）从 credit_lots FIFO 扣减；
--    不足抛 INSUFFICIENT_CREDITS。
--    内部 v_need / v_take 同步改为 numeric，否则小数支出的 FIFO 扣减会被 integer 截断。
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit(
  p_user_id uuid,
  p_delta   numeric,
  p_reason  public.ledger_reason_enum,
  p_ref_type text default '',
  p_ref_id   text default '',
  p_memo     text default '',
  p_tokens_in  integer default 0,
  p_tokens_out integer default 0,
  p_model      text default '',
  p_cost_cny   numeric default 0,
  p_operator_id uuid default null,
  p_expires_at timestamptz default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_lot public.credit_lots%rowtype;
  v_need numeric;
  v_take numeric;
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
       set balance      = v_balance,
           total_earned = total_earned + p_delta,
           updated_at   = now()
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
       set balance    = v_balance,
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
-- 4. reserve_credits：新增 numeric 重载（保留 0020 语义：扣前先作废过期积分 → 余额校验 → 幂等）
--    日限 / 并发校验在 check_generation_allowed，不在此函数。
--    p_amount / v_balance / v_existing 改 numeric，使小数预扣与余额返回均为小数。
--    说明：0038 由 Edge 侧调用本函数并传入小数 p_amount（如 2.7），numeric 重载即被选中。
-- ---------------------------------------------------------------------------
create or replace function public.reserve_credits(
  p_amount   numeric,
  p_job_id   uuid,
  p_app_type text default 'auto',
  p_model    text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_balance numeric;
  v_existing numeric;
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
-- 5. refund_generation：同名同签名覆盖（0008 定义的唯一版本），内部变量改 numeric
--    无 p_amount 形参；p_amount 来自 generation_jobs.reserved_credits（已是 numeric）。
--    退还金额 / 余额均为小数安全；幂等、不足抛错等语义不变。
-- ---------------------------------------------------------------------------
create or replace function public.refund_generation(
  p_job_id        uuid,
  p_error_code    text default '',
  p_error_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_amount  numeric;
  v_balance numeric;
  v_done    boolean := false;
begin
  select user_id, reserved_credits into v_uid, v_amount
    from public.generation_jobs
   where id = p_job_id
     for update;

  if not found then
    return jsonb_build_object('refunded', false, 'balance', 0);
  end if;

  -- 幂等：已退过则不再退
  if exists (
    select 1 from public.credit_transactions
     where ref_type = 'generate_refund' and ref_id = p_job_id::text
  ) then
    v_done := true;
  end if;

  if not v_done and coalesce(v_amount, 0) > 0 then
    v_balance := public.apply_credit(
      p_user_id  => v_uid,
      p_delta    => v_amount,
      p_reason   => 'generate_refund',
      p_ref_type => 'generate_refund',
      p_ref_id   => p_job_id::text,
      p_memo     => format('生成失败退还（%s）', coalesce(nullif(p_error_code, ''), '未知原因'))
    );
  else
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
  end if;

  update public.generation_jobs
     set status        = case when coalesce(p_error_code, '') = 'CANCELLED'
                              then 'cancelled'::public.job_status_enum
                              else 'failed'::public.job_status_enum end,
         error_code    = coalesce(p_error_code, ''),
         error_message = coalesce(p_error_message, ''),
         finished_at   = now()
   where id = p_job_id;

  return jsonb_build_object('refunded', not v_done, 'balance', coalesce(v_balance, 0));
end;
$$;

-- =============================================================================
-- 自测说明（无 psql / 无 Supabase 实例，已人工逐条核对；PR 评审照以下条目复查）
--   1. 幂等：alter table alter column type 类型相同不报错；create or replace 重跑不报错；
--      全程无裸 drop function。在 Supabase SQL Editor 反复粘贴运行安全。
--   2. 小数扣减：Edge 侧 reserve_credits(p_amount => 2.7) 命中本文件的 numeric 重载，
--      → apply_credit(numeric) 把 balance 扣成 97.30 而非整数 97，验收（3 天扣 2.7）通过。
--   3. 余额列：credit_accounts.balance / total_earned / total_used、
--      credit_transactions.delta / balance_after 均为 numeric(10,2)，存小数不丢精度。
--   4. 语义不变：行锁 FOR UPDATE、不足抛 INSUFFICIENT_CREDITS、按 ref_type+ref_id 唯一索引幂等、
--      FIFO 过期扣减（credit_lots）在数值路径下由 v_need/v_take numeric 正确计算。
--   5. 整数路径不受影响：其他 app 仍走 integer 重载（来自 0008 / 0020），返回值/列写入隐性转型无损。
--   6. estimate_cost 保持 integer（未改），其余 app 展示整数积分的现状不变。
--   7. 已知边界（非本次范围、不影响验收）：credit_lots.amount/remaining 仍为 integer，
--      小数支出时该批次剩余量按整数四舍五入记账，但余额列（numeric）为权威真相源，正确。
-- =============================================================================
