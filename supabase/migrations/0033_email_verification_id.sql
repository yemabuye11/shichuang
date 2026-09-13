-- ---------------------------------------------------------------------------
-- 0033：给 email_verifications 补主键 id
--
-- BUG：0032 建表时漏了 id 列，但 verify-email-code 用 .eq('id', row.id) 去标记
--      consumed=true（Edge 侧 index.ts:93）。缺列导致 UPDATE 必然失败 →
--      返回 500「验证码核销失败，请重试」；且注册触发器依赖 consumed 记录放行，
--      结果是谁都注册不了（P0 致命）。
--
-- 本迁移为已存在的表补上 id 主键；全新安装时 0032 已直接带 id，本文件为空操作。
-- ---------------------------------------------------------------------------

alter table public.email_verifications
  add column if not exists id uuid default gen_random_uuid();

-- 若还没有主键则补上（幂等）
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.email_verifications'::regclass
       and contype = 'p'
  ) then
    alter table public.email_verifications
      add constraint email_verifications_pkey primary key (id);
  end if;
end
$$;
