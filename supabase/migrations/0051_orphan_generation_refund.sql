-- 0051_orphan_generation_refund.sql
-- 任务行尚未成功写入时，按原预扣金额执行幂等退款。

create or replace function public.refund_orphan_generation(
  p_user_id       uuid,
  p_job_id        uuid,
  p_amount        numeric,
  p_error_code    text default '',
  p_error_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
begin
  if p_user_id is null or p_job_id is null or coalesce(p_amount, 0) <= 0 then
    return jsonb_build_object('refunded', false, 'balance', 0);
  end if;

  if exists (
    select 1 from public.credit_transactions
     where ref_type = 'generate_refund' and ref_id = p_job_id::text
  ) then
    select balance into v_balance from public.credit_accounts where user_id = p_user_id;
    return jsonb_build_object('refunded', false, 'balance', coalesce(v_balance, 0), 'idempotent', true);
  end if;

  v_balance := public.apply_credit(
    p_user_id  => p_user_id,
    p_delta    => p_amount,
    p_reason   => 'generate_refund',
    p_ref_type => 'generate_refund',
    p_ref_id   => p_job_id::text,
    p_memo     => format('生成任务创建失败退还（%s）', coalesce(nullif(p_error_code, ''), '未知原因'))
  );

  return jsonb_build_object('refunded', true, 'balance', coalesce(v_balance, 0), 'idempotent', false);
end;
$$;

grant execute on function public.refund_orphan_generation(uuid, uuid, numeric, text, text)
  to service_role;
