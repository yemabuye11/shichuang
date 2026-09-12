-- =============================================================================
-- 0008_rpc_credit.sql
-- 积分原子性：预扣 / 结算 / 退还 / 兑换 / 预估 / 生成前检查
--
-- 硬要求（ARCHITECTURE.md §3.5 + PRD P0-F6）：
--   - SELECT ... FOR UPDATE 行锁；
--   - balance >= amount 校验，不足抛 INSUFFICIENT_CREDITS；
--   - 按 job_id / code 的唯一索引保证幂等（重复调用不重复扣/退）；
--   - 全程单事务（函数体本身即事务）。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 读配置的便捷函数（统一默认值，避免各处硬编码）
-- ---------------------------------------------------------------------------
create or replace function public.cfg_num(p_key text, p_field text, p_default numeric)
returns numeric
language sql
stable
as $$
  select coalesce((value ->> p_field)::numeric, p_default)
    from public.system_config
   where key = p_key;
$$;

-- ---------------------------------------------------------------------------
-- 内部：写入一条流水并同步账户余额（单一出口，保证余额与流水永远一致）
-- ---------------------------------------------------------------------------
create or replace function public.apply_credit(
  p_user_id uuid,
  p_delta   integer,
  p_reason  public.ledger_reason_enum,
  p_ref_type text default '',
  p_ref_id   text default '',
  p_memo     text default '',
  p_tokens_in  integer default 0,
  p_tokens_out integer default 0,
  p_model      text default '',
  p_cost_cny   numeric default 0,
  p_operator_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
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

  v_balance := v_balance + p_delta;

  if v_balance < 0 then
    raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
  end if;

  update public.credit_accounts
     set balance      = v_balance,
         total_earned = total_earned + case when p_delta > 0 then p_delta else 0 end,
         total_used   = total_used   + case when p_delta < 0 then -p_delta else 0 end,
         updated_at   = now()
   where user_id = p_user_id;

  insert into public.credit_transactions
    (user_id, delta, balance_after, reason, ref_type, ref_id,
     tokens_in, tokens_out, model, cost_cny, memo, operator_id)
  values
    (p_user_id, p_delta, v_balance, p_reason, p_ref_type, p_ref_id,
     p_tokens_in, p_tokens_out, p_model, coalesce(p_cost_cny, 0), p_memo, p_operator_id);

  return v_balance;
end;
$$;

-- ---------------------------------------------------------------------------
-- estimate_cost：生成前预估积分（P0-F2）
-- ---------------------------------------------------------------------------
create or replace function public.estimate_cost(
  p_app_type text default 'auto',
  p_model    text default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cost integer;
begin
  select credit_cost into v_cost
    from public.app_type_profiles
   where app_type = p_app_type::public.app_type_enum;

  return coalesce(v_cost, 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- check_generation_allowed：日限 / 并发 / 月度阀 三查
-- ---------------------------------------------------------------------------
create or replace function public.check_generation_allowed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_limit    integer;
  v_used     integer;
  v_running  integer;
  v_cap      numeric;
  v_spend    numeric;
  v_period   text := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM');
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'code', 'UNAUTHORIZED',
                              'message', '请先登录', 'remainingToday', 0);
  end if;

  v_limit := coalesce((select (value ->> 'dailyGenerationLimit')::integer
                         from public.system_config where key = 'credit'), 30);
  v_cap   := coalesce((select (value ->> 'monthlySpendCny')::numeric
                         from public.system_config where key = 'limit'), 100);

  select coalesce(count, 0) into v_used
    from public.generation_daily
   where user_id = v_uid and day = (now() at time zone 'Asia/Shanghai')::date;

  select count(*) into v_running
    from public.generation_jobs
   where user_id = v_uid and status = 'running';

  if v_running > 0 then
    return jsonb_build_object('allowed', false, 'code', 'CONCURRENT_LIMIT',
                              'message', '你还有一个应用在生成中，请稍等一下',
                              'remainingToday', greatest(v_limit - v_used, 0));
  end if;

  if v_used >= v_limit then
    return jsonb_build_object('allowed', false, 'code', 'DAILY_LIMIT',
                              'message', format('今天生成次数已达上限（%s 次），明天再来吧', v_limit),
                              'remainingToday', 0);
  end if;

  select coalesce(sum(cost_cny), 0) into v_spend
    from public.monthly_spend
   where period = v_period;

  if v_spend >= v_cap then
    return jsonb_build_object('allowed', false, 'code', 'MONTHLY_CAP',
                              'message', '平台本月额度已用完，下月再来试试',
                              'remainingToday', greatest(v_limit - v_used, 0));
  end if;

  return jsonb_build_object('allowed', true, 'code', '',
                            'message', '', 'remainingToday', greatest(v_limit - v_used, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_credits：生成前预扣（幂等）
-- ---------------------------------------------------------------------------
create or replace function public.reserve_credits(
  p_amount   integer,
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
  v_balance integer;
  v_existing integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'balance', 0, 'code', 'UNAUTHORIZED');
  end if;

  -- 幂等：同一 job 已预扣过则直接返回当前余额
  select balance_after into v_existing
    from public.credit_transactions
   where ref_type = 'generate_spend' and ref_id = p_job_id::text;

  if found then
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
    return jsonb_build_object('ok', true, 'balance', coalesce(v_balance, 0), 'code', '', 'idempotent', true);
  end if;

  -- 行锁 + 余额校验
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
-- settle_generation：成功后记账（回填 token/成本 + 累加 monthly_spend）
-- ---------------------------------------------------------------------------
create or replace function public.settle_generation(
  p_job_id     uuid,
  p_tokens_in  integer default 0,
  p_tokens_out integer default 0,
  p_cost_cny   numeric  default 0,
  p_model      text     default '',
  p_app_id     uuid     default null,
  p_ms         integer  default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_period text := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM');
  v_provider text := '';
begin
  if p_job_id is null then
    return;
  end if;
  if v_uid is null then
    select user_id into v_uid from public.generation_jobs where id = p_job_id;
  end if;

  select provider into v_provider from public.model_profiles where id = p_model;

  update public.generation_jobs
     set status      = 'succeeded',
         app_id      = coalesce(p_app_id, app_id),
         tokens_in   = coalesce(p_tokens_in, 0),
         tokens_out  = coalesce(p_tokens_out, 0),
         cost_cny    = coalesce(p_cost_cny, 0),
         model       = coalesce(nullif(p_model, ''), model),
         finished_at = now()
   where id = p_job_id;

  -- 回填流水（预扣那条）与 apps
  update public.credit_transactions
     set tokens_in  = coalesce(p_tokens_in, 0),
         tokens_out = coalesce(p_tokens_out, 0),
         cost_cny   = coalesce(p_cost_cny, 0),
         model      = coalesce(nullif(p_model, ''), model)
   where ref_type = 'generate_spend' and ref_id = p_job_id::text;

  if p_app_id is not null then
    update public.apps
       set tokens_in     = coalesce(p_tokens_in, 0),
           tokens_out    = coalesce(p_tokens_out, 0),
           generation_ms = coalesce(p_ms, 0),
           model         = coalesce(nullif(p_model, ''), model)
     where id = p_app_id;
  end if;

  -- 累加月度支出
  insert into public.monthly_spend (period, model, provider, calls, tokens_in, tokens_out, cost_cny)
  values (v_period, coalesce(p_model, ''), coalesce(v_provider, ''), 1,
          coalesce(p_tokens_in, 0), coalesce(p_tokens_out, 0), coalesce(p_cost_cny, 0))
  on conflict (period) do update
    set calls      = public.monthly_spend.calls + 1,
        tokens_in  = public.monthly_spend.tokens_in  + excluded.tokens_in,
        tokens_out = public.monthly_spend.tokens_out + excluded.tokens_out,
        cost_cny   = public.monthly_spend.cost_cny   + excluded.cost_cny,
        model      = excluded.model,
        provider   = excluded.provider,
        updated_at = now();

  -- 每日计数
  if v_uid is not null then
    insert into public.generation_daily (user_id, day, count)
    values (v_uid, (now() at time zone 'Asia/Shanghai')::date, 1)
    on conflict (user_id, day) do update
      set count = public.generation_daily.count + 1;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- refund_generation：失败/取消全额退还（幂等，连续调用只退 1 次）
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
  v_amount  integer;
  v_balance integer;
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

-- ---------------------------------------------------------------------------
-- redeem_code：兑换码充值（积分码 / 套餐码）
-- 事务内 FOR UPDATE 锁定码行，status='unused' 才可兑；同用户同码不可重复。
-- ---------------------------------------------------------------------------
create or replace function public.redeem_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_code  text := upper(trim(coalesce(p_code, '')));
  v_row   public.redemption_codes%rowtype;
  v_plan  public.membership_plans%rowtype;
  v_balance integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'credits', 0, 'balance', 0,
                              'message', '请先登录后再兑换');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE', 'credits', 0, 'balance', 0,
                              'message', '请输入兑换码');
  end if;

  -- 行锁：并发下只有第一个事务能拿到 unused 状态
  select * into v_row from public.redemption_codes where code = v_code for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CODE', 'credits', 0, 'balance', 0,
                              'message', '兑换码不存在，请检查后重试');
  end if;

  if v_row.status = 'used' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_USED', 'credits', 0, 'balance', 0,
                              'message', '这个兑换码已经被用过了');
  end if;

  if v_row.status = 'disabled' then
    return jsonb_build_object('ok', false, 'code', 'DISABLED', 'credits', 0, 'balance', 0,
                              'message', '这个兑换码已被停用，请联系管理员');
  end if;

  if v_row.kind = 'invite' then
    return jsonb_build_object('ok', false, 'code', 'DISABLED', 'credits', 0, 'balance', 0,
                              'message', '这是邀请码，注册时才能使用');
  end if;

  if v_row.expires_at is not null and v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'EXPIRED', 'credits', 0, 'balance', 0,
                              'message', '这个兑换码已过期');
  end if;

  -- 入账积分
  if v_row.credits > 0 then
    v_balance := public.apply_credit(
      p_user_id  => v_uid,
      p_delta    => v_row.credits,
      p_reason   => 'redeem_code',
      p_ref_type => 'code',
      p_ref_id   => v_code,
      p_memo     => format('兑换码充值（批次 %s）', coalesce(nullif(v_row.batch_no, ''), '默认'))
    );
  else
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
  end if;

  -- 套餐码：开通/续期会员
  if v_row.kind = 'membership' and v_row.plan_id is not null then
    select * into v_plan from public.membership_plans where id = v_row.plan_id;
    if found and v_plan.enabled then
      insert into public.user_memberships (user_id, plan_id, started_at, expires_at, status)
      values (
        v_uid, v_plan.id, now(),
        case when coalesce(nullif(v_row.valid_days, 0), v_plan.duration_days) > 0
             then now() + (coalesce(nullif(v_row.valid_days, 0), v_plan.duration_days) || ' days')::interval
             else null end,
        'active'
      )
      on conflict (user_id) do update
        set plan_id    = excluded.plan_id,
            started_at = now(),
            expires_at = case
              when excluded.expires_at is null then null
              when public.user_memberships.expires_at is not null
                   and public.user_memberships.expires_at > now()
              then public.user_memberships.expires_at
                   + (coalesce(nullif(v_row.valid_days, 0), v_plan.duration_days) || ' days')::interval
              else excluded.expires_at
            end,
            status     = 'active',
            updated_at = now();
    end if;
  end if;

  update public.redemption_codes
     set status = 'used', used_by = v_uid, used_at = now()
   where code = v_code;

  return jsonb_build_object('ok', true, 'code', '', 'credits', v_row.credits,
                            'balance', coalesce(v_balance, 0),
                            'message', format('充值成功，到账 %s 积分', v_row.credits));
end;
$$;
