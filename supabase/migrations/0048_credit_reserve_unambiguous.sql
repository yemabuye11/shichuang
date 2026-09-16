-- 0048_credit_reserve_unambiguous.sql
-- 目的：移除旧的 integer 重载，避免 PostgREST 调用 reserve_credits 时出现
--       函数签名不明确。0039 的 numeric 版本兼容整数与小数积分。
-- 幂等：drop if exists 可重复执行；numeric 版本由 0039 提供。

drop function if exists public.reserve_credits(integer, uuid, text, text);

grant execute on function public.reserve_credits(numeric, uuid, text, text)
  to anon, authenticated, service_role;
