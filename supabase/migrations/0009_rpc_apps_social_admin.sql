-- =============================================================================
-- 0009_rpc_apps_social_admin.sql
-- 应用 CRUD / 发布 / 点赞 / 举报 / 广场列表 / 管理员后台
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 我的应用：当前用户的积分账户 + 会员（一次往返拿全，省请求）
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
begin
  if v_uid is null then
    return jsonb_build_object('balance', 0, 'totalEarned', 0, 'totalUsed', 0, 'membership', null);
  end if;

  return jsonb_build_object(
    'balance',     coalesce((select balance from public.credit_accounts where user_id = v_uid), 0),
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
-- publish_app：发布到广场（校验作者 + html 就绪 + 发奖励，每日上限 10）
-- ---------------------------------------------------------------------------
create or replace function public.publish_app(
  p_app_id     uuid,
  p_title      text default null,
  p_summary    text default null,
  p_subject    text default null,
  p_grade      text default null,
  p_cover_kind text default 'auto',
  p_cover_seed text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_app     public.apps%rowtype;
  v_reward  integer := 0;
  v_cap     integer := 10;
  v_used    integer := 0;
  v_balance integer;
begin
  select * into v_app from public.apps where id = p_app_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'appId', p_app_id, 'rewardCredits', 0, 'balance', 0,
                              'message', '应用不存在');
  end if;
  if v_app.author_id <> v_uid then
    return jsonb_build_object('ok', false, 'appId', p_app_id, 'rewardCredits', 0, 'balance', 0,
                              'message', '只能发布自己的应用');
  end if;
  if v_app.html_status <> 'ready' then
    return jsonb_build_object('ok', false, 'appId', p_app_id, 'rewardCredits', 0, 'balance', 0,
                              'message', '应用内容还在发布中，请稍候再试');
  end if;

  update public.apps
     set title      = coalesce(nullif(trim(p_title), ''), title),
         summary    = coalesce(p_summary, summary),
         subject    = coalesce(p_subject, subject),
         grade      = coalesce(p_grade, grade),
         cover_kind = coalesce(p_cover_kind, cover_kind),
         cover_seed = coalesce(nullif(trim(p_cover_seed), ''), cover_seed, id::text),
         status     = 'published',
         published_at = coalesce(published_at, now())
   where id = p_app_id;

  -- 发布奖励（每日上限）
  v_reward := coalesce((select (value ->> 'publishReward')::integer
                          from public.system_config where key = 'credit'), 2);
  v_cap    := coalesce((select (value ->> 'publishRewardDailyCap')::integer
                          from public.system_config where key = 'credit'), 10);

  select count(*) into v_used
    from public.credit_transactions
   where user_id = v_uid
     and reason = 'publish_reward'
     and created_at >= (now() at time zone 'Asia/Shanghai')::date;

  if v_used < v_cap then
    v_balance := public.apply_credit(
      p_user_id  => v_uid,
      p_delta    => v_reward,
      p_reason   => 'publish_reward',
      p_ref_type => 'app',
      p_ref_id   => p_app_id::text,
      p_memo     => '发布应用奖励'
    );
  else
    v_reward := 0;
    select balance into v_balance from public.credit_accounts where user_id = v_uid;
  end if;

  insert into public.events (name, user_id, app_id, props)
  values ('publish', v_uid, p_app_id, jsonb_build_object('reward', v_reward));

  return jsonb_build_object('ok', true, 'appId', p_app_id, 'rewardCredits', v_reward,
                            'balance', coalesce(v_balance, 0), 'message', '发布成功');
end;
$$;

-- ---------------------------------------------------------------------------
-- unpublish_app / rename_app / delete_app / duplicate_app
-- ---------------------------------------------------------------------------

create or replace function public.unpublish_app(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.apps
     set status = 'draft', published_at = null
   where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能下架自己的应用');
  end if;
  return jsonb_build_object('ok', true, 'message', '已取消发布');
end;
$$;

create or replace function public.rename_app(p_app_id uuid, p_title text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_title), '') = '' then
    return jsonb_build_object('ok', false, 'message', '标题不能为空');
  end if;
  update public.apps
     set title = trim(p_title)
   where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能修改自己的应用');
  end if;
  return jsonb_build_object('ok', true, 'message', '已保存');
end;
$$;

create or replace function public.delete_app(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.apps where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能删除自己的应用');
  end if;
  return jsonb_build_object('ok', true, 'message', '已删除');
end;
$$;

create or replace function public.duplicate_app(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_id uuid;
  v_src    public.apps%rowtype;
begin
  select * into v_src from public.apps where id = p_app_id and author_id = auth.uid();
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能复制自己的应用');
  end if;

  insert into public.apps (
    author_id, title, summary, app_type, subject, grade, textbook, duration, difficulty,
    prompt_raw, prompt_enhanced, model, prompt_version,
    html_url, html_status, html_size_bytes, html_sha256, html_version,
    cover_kind, cover_seed, cover_url, status, parent_app_id
  ) values (
    v_src.author_id, v_src.title || ' 的副本', v_src.summary, v_src.app_type,
    v_src.subject, v_src.grade, v_src.textbook, v_src.duration, v_src.difficulty,
    v_src.prompt_raw, v_src.prompt_enhanced, v_src.model, v_src.prompt_version,
    v_src.html_url, v_src.html_status, v_src.html_size_bytes, v_src.html_sha256, v_src.html_version,
    'auto', gen_random_uuid()::text, null, 'draft', v_src.id
  ) returning id into v_new_id;

  update public.apps set remix_count = remix_count + 1 where id = p_app_id;

  return jsonb_build_object('ok', true, 'appId', v_new_id, 'message', '已复制');
end;
$$;

-- ---------------------------------------------------------------------------
-- toggle_like
-- ---------------------------------------------------------------------------
create or replace function public.toggle_like(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_liked boolean;
  v_count integer;
begin
  if v_uid is null then
    return jsonb_build_object('liked', false, 'likeCount',
           coalesce((select like_count from public.apps where id = p_app_id), 0));
  end if;

  if exists (select 1 from public.app_likes where app_id = p_app_id and user_id = v_uid) then
    delete from public.app_likes where app_id = p_app_id and user_id = v_uid;
    v_liked := false;
  else
    insert into public.app_likes (app_id, user_id) values (p_app_id, v_uid);
    v_liked := true;
  end if;

  select like_count into v_count from public.apps where id = p_app_id;
  return jsonb_build_object('liked', v_liked, 'likeCount', coalesce(v_count, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- record_app_view（service_role only；由 Edge Function 调用）
-- ---------------------------------------------------------------------------
create or replace function public.record_app_view(
  p_app_id      uuid,
  p_viewer_hash text,
  p_day         date default current_date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted boolean := false;
begin
  insert into public.app_views (app_id, viewer_hash, view_date)
  values (p_app_id, p_viewer_hash, coalesce(p_day, current_date))
  on conflict (app_id, viewer_hash, view_date) do nothing;

  v_inserted := found;

  if v_inserted then
    update public.apps set view_count = view_count + 1 where id = p_app_id;
  end if;

  return v_inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- report_app（匿名可举报）
-- ---------------------------------------------------------------------------
create or replace function public.report_app(
  p_app_id        uuid,
  p_reason        text,
  p_detail        text default '',
  p_reporter_hash text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_reason), '') = '' then
    return jsonb_build_object('ok', false, 'message', '请选择举报原因');
  end if;
  insert into public.reports (app_id, reporter_id, reporter_hash, reason, detail)
  values (p_app_id, auth.uid(), coalesce(p_reporter_hash, ''), trim(p_reason), coalesce(p_detail, ''));
  return jsonb_build_object('ok', true, 'message', '举报已提交，我们会尽快处理');
end;
$$;

-- ---------------------------------------------------------------------------
-- list_square：服务端分页（每页 ≤24）/ 搜索 / 过滤 / 排序
-- ---------------------------------------------------------------------------
create or replace function public.list_square(
  p_type    text default null,
  p_subject text default null,
  p_grade   text default null,
  p_sort    text default 'latest',
  p_q       text default null,
  p_offset  integer default 0,
  p_limit   integer default 24
)
returns table (
  id                uuid,
  title             text,
  summary           text,
  app_type          public.app_type_enum,
  subject           text,
  grade             text,
  cover_kind        text,
  cover_seed        text,
  cover_url         text,
  status            public.app_status_enum,
  published_at      timestamptz,
  view_count        integer,
  like_count        integer,
  author_id         uuid,
  author_nickname   text,
  author_avatar_seed text,
  liked_by_me       boolean,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 24);
  v_uid   uuid := auth.uid();
begin
  return query
  with filtered as (
    select a.*
      from public.apps a
     where a.status = 'published'
       and (p_type    is null or p_type    = '' or a.app_type::text = p_type)
       and (p_subject is null or p_subject = '' or a.subject = p_subject)
       and (p_grade   is null or p_grade   = '' or a.grade   = p_grade)
       and (
         p_q is null or p_q = ''
         or a.title ilike '%' || p_q || '%'
         or a.summary ilike '%' || p_q || '%'
         or a.prompt_raw ilike '%' || p_q || '%'
       )
  )
  select
    f.id, f.title, f.summary, f.app_type, f.subject, f.grade,
    f.cover_kind, f.cover_seed, f.cover_url, f.status, f.published_at,
    f.view_count, f.like_count,
    f.author_id,
    p.nickname,
    p.avatar_seed,
    (v_uid is not null and exists (
      select 1 from public.app_likes l where l.app_id = f.id and l.user_id = v_uid
    )),
    (count(*) over())::bigint
  from filtered f
  left join public.profiles p on p.id = f.author_id
  order by
    case when p_sort = 'hottest' then f.view_count end desc nulls last,
    case when p_sort = 'liked'   then f.like_count end desc nulls last,
    f.published_at desc nulls last,
    f.created_at desc
  limit v_limit
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：批量生成兑换码（可指定面额 / 张数 / 类型 / 套餐 / 有效期）
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_codes(
  p_credits    integer default 0,
  p_count      integer default 10,
  p_batch_no   text default null,
  p_expires_at timestamptz default null,
  p_kind       text default 'credit',
  p_plan_id    text default null,
  p_valid_days integer default 0,
  p_prefix     text default '',
  p_memo       text default ''
)
returns table (code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_kind   public.redemption_kind_enum;
  v_batch  text;
  v_i      integer;
  v_code   text;
  v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_credits integer := greatest(coalesce(p_credits, 0), 0);
begin
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
    raise exception '仅管理员可生成兑换码' using errcode = '42501';
  end if;

  v_kind  := coalesce(p_kind, 'credit')::public.redemption_kind_enum;
  v_batch := coalesce(nullif(trim(p_batch_no), ''), to_char(now(), 'YYYYMMDD-HH24MI'));

  for v_i in 1..greatest(least(coalesce(p_count, 10), 2000), 1) loop
    loop
      v_code := upper(coalesce(p_prefix, '')) || (
        select string_agg(substr(v_chars, 1 + (random() * (length(v_chars) - 1))::int, 1), '')
          from generate_series(1, 10)
      );
      exit when not exists (select 1 from public.redemption_codes r where r.code = v_code);
    end loop;

    insert into public.redemption_codes
      (code, kind, plan_id, credits, valid_days, batch_no, expires_at, created_by, memo)
    values
      (v_code, v_kind, p_plan_id, v_credits, greatest(coalesce(p_valid_days, 0), 0),
       v_batch, p_expires_at, v_uid, coalesce(p_memo, ''));

    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：查看兑换码（已用/未用）
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
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
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

create or replace function public.admin_disable_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可停用兑换码' using errcode = '42501';
  end if;
  update public.redemption_codes set status = 'disabled'
   where code = upper(trim(p_code)) and status = 'unused';
  if not found then
    return jsonb_build_object('ok', false, 'message', '只能停用未使用的兑换码');
  end if;
  return jsonb_build_object('ok', true, 'message', '已停用');
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：手动给指定用户加减积分（留操作人与备注，便于对账）
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
  if not exists (select 1 from public.profiles where id = v_uid and role = 'admin') then
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
-- 管理员：用户列表（用于挑人加积分）
-- ---------------------------------------------------------------------------
create or replace function public.admin_list_users(
  p_q      text default null,
  p_offset integer default 0,
  p_limit  integer default 50
)
returns table (
  id          uuid,
  nickname    text,
  role        public.user_role_enum,
  balance     integer,
  plan_id     text,
  created_at  timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看用户' using errcode = '42501';
  end if;

  return query
  select p.id, p.nickname, p.role, coalesce(c.balance, 0), m.plan_id, p.created_at,
         (count(*) over())::bigint
    from public.profiles p
    left join public.credit_accounts c on c.user_id = p.id
    left join public.user_memberships m on m.user_id = p.id
   where (p_q is null or p_q = '' or p.nickname ilike '%' || p_q || '%')
   order by p.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：套餐档位维护
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_plan(
  p_id           text,
  p_name         text,
  p_credits      integer,
  p_duration_days integer,
  p_price_cny    numeric,
  p_description  text default '',
  p_sort_order   integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护套餐' using errcode = '42501';
  end if;

  insert into public.membership_plans (id, name, credits, duration_days, price_cny, description, sort_order)
  values (p_id, p_name, greatest(coalesce(p_credits, 0), 0),
          greatest(coalesce(p_duration_days, 0), 0), coalesce(p_price_cny, 0),
          coalesce(p_description, ''), coalesce(p_sort_order, 0))
  on conflict (id) do update
    set name = excluded.name, credits = excluded.credits,
        duration_days = excluded.duration_days, price_cny = excluded.price_cny,
        description = excluded.description, sort_order = excluded.sort_order,
        updated_at = now();

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.admin_set_plan_enabled(p_id text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护套餐' using errcode = '42501';
  end if;
  update public.membership_plans set enabled = coalesce(p_enabled, true), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：模型配置维护（后台可配多家 Key / 模型 ID / 单价 / 路由）
-- 说明：API Key 不入库，只存在 Supabase Secrets。
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_model(
  p_id               text,
  p_provider         text,
  p_model_id         text,
  p_display_name     text,
  p_api_base         text default '',
  p_pricing          jsonb default '{}'::jsonb,
  p_max_output_tokens integer default 8000,
  p_credits_per_call integer default 1,
  p_is_default       boolean default false,
  p_enabled          boolean default true,
  p_sort_order       integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护模型配置' using errcode = '42501';
  end if;

  if coalesce(p_is_default, false) then
    update public.model_profiles set is_default = false where is_default;
  end if;

  insert into public.model_profiles
    (id, provider, model_id, display_name, api_base, pricing,
     max_output_tokens, credits_per_call, is_default, enabled, sort_order)
  values
    (p_id, p_provider, p_model_id, p_display_name, coalesce(p_api_base, ''), coalesce(p_pricing, '{}'::jsonb),
     coalesce(p_max_output_tokens, 8000), coalesce(p_credits_per_call, 1),
     coalesce(p_is_default, false), coalesce(p_enabled, true), coalesce(p_sort_order, 0))
  on conflict (id) do update
    set provider = excluded.provider, model_id = excluded.model_id,
        display_name = excluded.display_name, api_base = excluded.api_base,
        pricing = case when coalesce(p_pricing, '{}'::jsonb) = '{}'::jsonb
                       then public.model_profiles.pricing else excluded.pricing end,
        max_output_tokens = excluded.max_output_tokens,
        credits_per_call = excluded.credits_per_call,
        is_default = excluded.is_default,
        enabled = excluded.enabled,
        sort_order = excluded.sort_order,
        updated_at = now();

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：应用类型积分与模型路由配置
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_app_type(
  p_app_type      text,
  p_label         text,
  p_credit_cost   integer,
  p_model_override text default null,
  p_enabled       boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可维护应用类型配置' using errcode = '42501';
  end if;

  update public.app_type_profiles
     set label = coalesce(nullif(trim(p_label), ''), label),
         credit_cost = greatest(coalesce(p_credit_cost, credit_cost), 0),
         model_override = p_model_override,
         enabled = coalesce(p_enabled, true)
   where app_type = p_app_type::public.app_type_enum;

  return jsonb_build_object('ok', true, 'appType', p_app_type);
end;
$$;

-- ---------------------------------------------------------------------------
-- 管理员：下架 / 恢复 / 举报处理 / 看板
-- ---------------------------------------------------------------------------

create or replace function public.admin_takedown(p_app_id uuid, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可下架应用' using errcode = '42501';
  end if;
  update public.apps
     set status = 'taken_down', summary = coalesce(nullif(trim(p_reason), ''), summary)
   where id = p_app_id;
  return jsonb_build_object('ok', true, 'message', '已下架');
end;
$$;

create or replace function public.admin_restore(p_app_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可恢复应用' using errcode = '42501';
  end if;
  update public.apps set status = 'draft' where id = p_app_id;
  return jsonb_build_object('ok', true, 'message', '已恢复为草稿');
end;
$$;

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
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
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

create or replace function public.admin_handle_report(
  p_report_id bigint,
  p_action    text default 'handled'   -- handled | dismissed
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可处理举报' using errcode = '42501';
  end if;
  update public.reports
     set status = p_action::public.report_status_enum,
         handled_by = auth.uid(),
         handled_at = now()
   where id = p_report_id;
  return jsonb_build_object('ok', true, 'message', '已处理');
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_period text := to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM');
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '仅管理员可查看统计' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users',     (select count(*) from public.profiles),
    'apps',      (select count(*) from public.apps),
    'published', (select count(*) from public.apps where status = 'published'),
    'gensToday', (
      select coalesce(sum(count), 0) from public.generation_daily
       where day = (now() at time zone 'Asia/Shanghai')::date
    ),
    'spendMonthCny', (
      select coalesce(sum(cost_cny), 0) from public.monthly_spend where period = v_period
    ),
    'topApps', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object(
                 'id', a.id, 'title', a.title,
                 'viewCount', a.view_count, 'likeCount', a.like_count
               ) as x
          from public.apps a
         where a.status = 'published'
         order by a.view_count desc, a.like_count desc
         limit 10
      ) t
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_public_config：未登录也可调用的白名单配置
-- ---------------------------------------------------------------------------
create or replace function public.get_public_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_brand jsonb := '{}'::jsonb;
  v_auth  jsonb := '{}'::jsonb;
  v_credit jsonb := '{}'::jsonb;
  v_square jsonb := '{}'::jsonb;
  v_types jsonb := '[]'::jsonb;
begin
  select value into v_brand  from public.system_config where key = 'brand';
  select value into v_auth   from public.system_config where key = 'auth';
  select value into v_credit from public.system_config where key = 'credit';
  select value into v_square from public.system_config where key = 'square';

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', t.app_type,
           'label', t.label,
           'creditCost', t.credit_cost,
           'enabled', t.enabled,
           'sortOrder', t.sort_order
         ) order by t.sort_order), '[]'::jsonb)
    into v_types
    from public.app_type_profiles t
   where t.enabled;

  return jsonb_build_object(
    'brand',  coalesce(v_brand, '{}'::jsonb),
    'auth',   coalesce(v_auth, '{}'::jsonb),
    'credit', coalesce(v_credit, '{}'::jsonb),
    'square', coalesce(v_square, '{}'::jsonb),
    'appTypes', v_types
  );
end;
$$;
