-- =============================================================================
-- 0045_owner_credit_grant.sql
-- 站长（野马）本人账号手工补积分 —— 一次性，可重复执行（同一 ref_id 只补一次）
--
-- 背景：客户反馈「我没积分了，消耗积分太猛了」。
--   站长本人要天天试用、验收、录演示视频，积分被自己生成耗光了，
--   而平台「永不做在线支付」，补积分只能走两条路：
--     ① 管理后台 → 代充值页（推荐，日常用这个）
--     ② 本文件：在 Supabase SQL Editor 里粘一次，直接到账
--
-- 用法（3 步）：
--   1) 把下面 v_email 改成你的登录邮箱（注册「师创」时用的那个）；
--   2) 想改数量就改 v_amount（默认 2000，按 0044 新价约够 250~330 次文档生成）；
--   3) 整段粘进 Supabase SQL Editor → Run。
--
-- 幂等：ref_id 固定为 'grant:2026-09-owner'，已补过会 raise notice 后直接跳过，
--       反复粘贴不会重复加。想再补一次就把 ref_id 改个号（如 'grant:2026-09-owner-2'）。
--
-- 依赖：0044 已把 admin_adjust_credits 改成 numeric；本文件不走那个 RPC
--       （SQL Editor 里 auth.uid() 为 null，会撞「仅管理员可调整积分」），
--       直接调内部函数 public.apply_credit(numeric) —— 该函数是 security definer，
--       会同步写 credit_accounts 余额 + credit_lots 批次 + credit_transactions 流水。
-- =============================================================================

do $$
declare
  v_email  text    := '这里改成你的登录邮箱@example.com';  -- ← 改这里
  v_amount numeric := 2000;                                -- ← 想加多少改这里
  v_ref_id text    := 'grant:2026-09-owner';               -- ← 再补一次就改个号
  v_uid    uuid;
  v_bal    numeric;
begin
  if v_email like '这里改成%' or position('@' in v_email) = 0 then
    raise exception '请先把 v_email 改成你真实的登录邮箱（当前是占位符：%）', v_email;
  end if;

  select id into v_uid
    from auth.users
   where lower(email) = lower(v_email)
   limit 1;

  if v_uid is null then
    raise exception '没找到邮箱 % 对应的账号，请确认邮箱是否写对（区分大小写不敏感，但不能有空格）', v_email;
  end if;

  if exists (
    select 1 from public.credit_transactions
     where ref_type = 'admin' and ref_id = v_ref_id
  ) then
    raise notice '该笔补助（%）已经发过了，本次跳过，未重复加积分。', v_ref_id;
    return;
  end if;

  v_bal := public.apply_credit(
    p_user_id  => v_uid,
    p_delta    => v_amount,
    p_reason   => 'admin_adjust',
    p_ref_type => 'admin',
    p_ref_id   => v_ref_id,
    p_memo     => '站长本人试用补积分（迁移 0045）'
  );

  raise notice '已给 % 补 % 积分，当前余额 %', v_email, v_amount, v_bal;
end $$;

-- ---------------------------------------------------------------------------
-- 顺手自查（跑完把上面 do 块注释掉、单独跑这段就能看结果）
-- ---------------------------------------------------------------------------
-- select u.email, a.balance, a.total_earned, a.total_used
--   from public.credit_accounts a
--   join auth.users u on u.id = a.user_id
--  order by a.balance desc;
--
-- select created_at, delta, balance_after, memo
--   from public.credit_transactions
--  where ref_type = 'admin'
--  order by created_at desc
--  limit 10;

-- =============================================================================
-- 给站长看的「以后不想跑 SQL 怎么办」
--   管理后台 → 「代充值」Tab（0042 刚修好 column reference id is ambiguous 的报错）
--   → 选用户 → 填数量 → 备注 → 确认。走的是同一个 apply_credit，效果完全一样。
--   本文件只是「账号积分被耗光、登不进去或后台还没修好」时的应急通道。
-- =============================================================================
