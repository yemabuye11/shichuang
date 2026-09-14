-- =============================================================================
-- 0035_content_library_market.sql
-- T09 内容市场机制：老师公开生成产物到内容库，他人下载花积分、原作者得一半。
--
-- 业务规则：
--   - 文档类生成成功后自动沉淀到 doc_library（沿用 0017 deposit_doc_library）；
--   - 原作者可把沉淀记录设为公开（set_doc_library_public）；
--   - 其他登录教师下载公开内容（download_library_doc）：
--       * 下载价 = doc_library.download_credits，为 0 时兜底取 app_type_profiles.credit_cost；
--       * 下载者扣 price（reason='content_download_spend'），原作者得 floor(price/2)
--         （reason='content_download_reward'）；
--       * 余额不足时 apply_credit 抛 INSUFFICIENT_CREDITS，自然传播使 RPC 报错，前端捕获即可。
--
-- 红线（与 0017 / 0034 / 0008 一致）：
--   - 积分数值只来自 app_type_profiles.credit_cost，代码绝不写死价格；
--   - RLS 全表开启不被破坏，新 RPC 一律 SECURITY DEFINER + set search_path=public + 身份校验；
--   - 不加任何新依赖。
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. 枚举补充：积分流水原因（幂等）
-- ---------------------------------------------------------------------------
do $$
begin
  alter type public.ledger_reason_enum add value if not exists 'content_download_spend';
exception
  when others then null;
end $$;

do $$
begin
  alter type public.ledger_reason_enum add value if not exists 'content_download_reward';
exception
  when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 1. doc_library 加列（均 if not exists，幂等）
--     owner_nickname / title：公开显示用（作者昵称 + 内容标题）；
--     download_count：下载次数统计；
--     download_credits：下载定价（生成公开时由调用方写入 app_type_profiles.credit_cost，
--                       为 0 时由 download_library_doc 兜底取 app_type_profiles）。
-- ---------------------------------------------------------------------------
alter table public.doc_library
  add column if not exists owner_nickname text not null default '';

alter table public.doc_library
  add column if not exists title text not null default '';

alter table public.doc_library
  add column if not exists download_count integer not null default 0;

alter table public.doc_library
  add column if not exists download_credits integer not null default 0;

comment on column public.doc_library.owner_nickname is '作者昵称快照（公开内容市场展示用）';
comment on column public.doc_library.title is '内容标题快照（公开内容市场展示用）';
comment on column public.doc_library.download_count is '被下载次数累计';
comment on column public.doc_library.download_credits is '下载定价；为 0 时由 download_library_doc 兜底取 app_type_profiles.credit_cost';

-- ---------------------------------------------------------------------------
-- 2. 扩展 deposit_doc_library：新增 p_owner_nickname / p_title
--     （保留 on conflict (doc_id) do nothing，重跑不灌水）
-- ---------------------------------------------------------------------------
create or replace function public.deposit_doc_library(
  p_doc_id              uuid,
  p_owner_id            uuid,
  p_category            text default 'doc',
  p_doc_type            text default null,
  p_subject             text default '',
  p_grade               text default '',
  p_textbook_version_id uuid default null,
  p_keywords            text[] default '{}',
  p_is_public           boolean default false,
  p_owner_nickname      text default '',
  p_title               text default '',
  p_download_credits    integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.doc_library (
    owner_id, doc_id, category, doc_type, subject, grade,
    textbook_version_id, keywords, is_public, owner_nickname, title,
    download_credits
  ) values (
    p_owner_id, p_doc_id, p_category, p_doc_type,
    coalesce(p_subject, ''), coalesce(p_grade, ''),
    p_textbook_version_id, coalesce(p_keywords, '{}'::text[]),
    coalesce(p_is_public, false),
    coalesce(p_owner_nickname, ''), coalesce(p_title, ''),
    coalesce(p_download_credits, 0)
  )
  on conflict (doc_id) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.deposit_doc_library(
  uuid, uuid, text, text, text, text, uuid, text[], boolean, text, text, integer
) from public;
grant execute on function public.deposit_doc_library(
  uuid, uuid, text, text, text, text, uuid, text[], boolean, text, text, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. RPC：原作者设置某条沉淀记录是否公开（可补标题/昵称）
-- ---------------------------------------------------------------------------
create or replace function public.set_doc_library_public(
  p_doc_id         uuid,
  p_is_public      boolean,
  p_title          text default '',
  p_owner_nickname text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update public.doc_library
     set is_public      = p_is_public,
         title          = coalesce(nullif(p_title, ''), title),
         owner_nickname = coalesce(nullif(p_owner_nickname, ''), owner_nickname)
   where doc_id = p_doc_id
     and owner_id = (select auth.uid());

  if not found then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object('ok', true, 'is_public', p_is_public);
end;
$$;

revoke all on function public.set_doc_library_public(uuid, boolean, text, text) from public;
grant execute on function public.set_doc_library_public(uuid, boolean, text, text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC：下载公开内容（扣下载者、奖原作者、累加下载次数、返回产物 URL）
-- ---------------------------------------------------------------------------
create or replace function public.download_library_doc(
  p_doc_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner          uuid;
  v_download_credits integer;
  v_doc_type       text;
  v_price          integer;
  v_reward         integer;
  v_doc_json_url   text;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;

  -- 仅允许下载公开内容
  select owner_id, download_credits, doc_type
    into v_owner, v_download_credits, v_doc_type
    from public.doc_library
   where doc_id = p_doc_id
     and is_public;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- 自己不能下载自己
  if v_owner = (select auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'SELF_DOWNLOAD');
  end if;

  -- 定价：download_credits 非 0 优先；否则兜底取 app_type_profiles.credit_cost；再否则 1
  v_price := coalesce(
    nullif(v_download_credits, 0),
    (
      select credit_cost
        from public.app_type_profiles
       where app_type = v_doc_type::public.app_type_enum
    ),
    1
  );
  v_reward := floor(v_price / 2);

  -- 扣下载者（余额不足时 apply_credit 抛 INSUFFICIENT_CREDITS，自然传播使 RPC 报错）
  perform public.apply_credit(
    p_user_id  => (select auth.uid()),
    p_delta    => -v_price,
    p_reason   => 'content_download_spend',
    p_ref_type => 'library',
    p_ref_id   => p_doc_id::text,
    p_memo     => '下载内容库资源'
  );

  -- 奖原作者
  perform public.apply_credit(
    p_user_id  => v_owner,
    p_delta    => v_reward,
    p_reason   => 'content_download_reward',
    p_ref_type => 'library',
    p_ref_id   => p_doc_id::text,
    p_memo     => '内容被下载奖励'
  );

  -- 累加下载次数
  update public.doc_library
     set download_count = download_count + 1
   where doc_id = p_doc_id;

  -- 取产物 URL
  select doc_json_url into v_doc_json_url
    from public.apps
   where id = p_doc_id;

  return jsonb_build_object(
    'ok', true,
    'doc_json_url', v_doc_json_url,
    'price', v_price,
    'reward', v_reward
  );
end;
$$;

revoke all on function public.download_library_doc(uuid) from public;
grant execute on function public.download_library_doc(uuid) to service_role, authenticated;
