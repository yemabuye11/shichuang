import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import type { MembershipPlan } from '@/types/models';
import type { Json } from '@/types/database';

/**
 * 自助充值服务（野马个人收款码 + 后台确认到账）。
 *
 * - 老师端：getPaymentConfig() 拿收款码 + 引导文案；submitRequest() 提交凭证；
 * - 管理员：listRequests() / approveRequest() 走 SECURITY DEFINER RPC。
 *
 * 资金路径：approved 时由 admin_approve_recharge 经 apply_credit 加积分
 * （reason='recharge_self', ref_type='recharge'），与兑换码/管理员调整同源对账。
 */

const DEFAULT_TIP =
  '选套餐 → 扫下方码付款（备注你的账号名）→ 付款后点"我已付款"提交凭证 → 管理员核对后积分到账';

export interface PaymentConfig {
  wechatQrUrl: string;
  alipayQrUrl: string;
  tip: string;
}

/** 充值请求（真实模式下从 recharge_requests 表映射）。 */
export interface RechargeRequest {
  id: string;
  userId: string;
  nickname: string | null;
  planId: string | null;
  planName: string | null;
  amountCny: number;
  payMethod: 'wechat' | 'alipay';
  status: 'pending' | 'approved' | 'rejected';
  proofText: string | null;
  proofImageUrl: string | null;
  createdAt: string;
  handledAt: string | null;
}

/**
 * 读取收款码 + 引导文案（system_config.payment）。
 *
 * - 真实模式：rpc('get_system_config', { p_key: 'payment' });
 * - mock 模式：mockStore.getPaymentConfig()。
 */
export async function getPaymentConfig(): Promise<PaymentConfig> {
  if (isMockMode()) {
    return mockStore.getPaymentConfig();
  }
  const sb = getSupabase();
  if (!sb) return { wechatQrUrl: '', alipayQrUrl: '', tip: DEFAULT_TIP };

  const { data, error } = await sb.rpc('get_system_config', { p_key: 'payment' });
  if (error) {
    console.warn('[recharge] 读取收款码配置失败，使用占位', error.message);
    return { wechatQrUrl: '', alipayQrUrl: '', tip: DEFAULT_TIP };
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    wechatQrUrl: typeof raw.wechatQrUrl === 'string' ? raw.wechatQrUrl : '',
    alipayQrUrl: typeof raw.alipayQrUrl === 'string' ? raw.alipayQrUrl : '',
    tip: typeof raw.tip === 'string' && raw.tip.length > 0 ? raw.tip : DEFAULT_TIP,
  };
}

/** 复用 creditService.listPlans（套餐档位）。 */
export async function listPlans(): Promise<MembershipPlan[]> {
  const { listPlans: listPlansFromCredit } = await import('./creditService');
  return listPlansFromCredit();
}

/**
 * 老师端提交一条充值请求（凭证）。
 *
 * @param input 套餐 / 金额 / 付款方式 / 备注 / 凭证图链接。
 */
export async function submitRequest(input: {
  planId: string;
  amountCny: number;
  payMethod: 'wechat' | 'alipay';
  proofText: string;
  proofImageUrl: string | null;
}): Promise<{ id: string }> {
  if (!input.planId) throw new AppError('VALIDATE_FAILED', '请选择套餐');
  if (!(input.amountCny > 0)) throw new AppError('VALIDATE_FAILED', '金额必须大于 0');
  if (input.payMethod !== 'wechat' && input.payMethod !== 'alipay') {
    throw new AppError('VALIDATE_FAILED', '付款方式无效');
  }

  if (isMockMode()) {
    const req = await mockStore.addRechargeRequest(input);
    return { id: req.id };
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '请先登录后再提交充值请求');

  const { data, error } = await sb
    .from('recharge_requests')
    .insert({
      user_id: uid,
      plan_id: input.planId,
      amount_cny: Math.round(input.amountCny * 100) / 100,
      pay_method: input.payMethod,
      proof_text: input.proofText.trim() || null,
      proof_image_url: input.proofImageUrl?.trim() || null,
    })
    .select('id')
    .single();
  if (error) throw new AppError('UNKNOWN', '提交失败，请稍后重试', error);
  return { id: String(data?.id ?? '') };
}

// ---------------------------------------------------------------------------
// 管理员：列出 / 确认 / 拒绝
// ---------------------------------------------------------------------------

/** 把 RPC 返回的一行规整为 `RechargeRequest` 视图模型。 */
function toRechargeRequest(row: {
  id: string;
  user_id: string;
  nickname: string | null;
  plan_id: string | null;
  plan_name: string | null;
  amount_cny: number;
  pay_method: string;
  status: string;
  proof_text: string | null;
  proof_image_url: string | null;
  created_at: string;
  handled_at: string | null;
}): RechargeRequest {
  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    planId: row.plan_id,
    planName: row.plan_name,
    amountCny: Number(row.amount_cny ?? 0),
    payMethod: (row.pay_method === 'alipay' ? 'alipay' : 'wechat'),
    status: (row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending'),
    proofText: row.proof_text,
    proofImageUrl: row.proof_image_url,
    createdAt: row.created_at,
    handledAt: row.handled_at,
  };
}

/**
 * 管理员：列出充值请求（默认 pending，≤50）。
 *
 * ⚠️ 后端 `admin_list_recharge` 是 `returns table (id uuid, ...)` 的 SECURITY DEFINER RPC。
 * PL/pgSQL 会把返回列名声明成同名变量，函数体里**任何**裸 `id` 都会和 `profiles.id`
 * 冲突并抛 `column reference "id" is ambiguous` (42702)。
 * 改动 SQL（见 `0042_fix_admin_rpc_id_ambiguity.sql`）时必须用表别名限定，如 `pr.id`。
 */
export async function listRequests(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending'): Promise<RechargeRequest[]> {
  if (isMockMode()) {
    const filter = status === 'all' ? null : status;
    return mockStore.listRechargeRequests(filter) as RechargeRequest[];
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data, error } = await sb.rpc('admin_list_recharge', {
    p_status: status === 'all' ? null : status,
    p_limit: 50,
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  return ((data ?? []) as Parameters<typeof toRechargeRequest>[0][]).map(toRechargeRequest);
}

/**
 * 老师端：列出「我提交的」充值请求（走 RLS，仅返回自己的行）。
 *
 * RLS 策略 `recharge_requests_select_self` 保证非管理员只能读到自己提交的请求。
 * 老师端历史不显示昵称（自己看自己）；套餐名走 planId 兜底（mock 模式会注入 planName）。
 */
export async function listMyRequests(): Promise<RechargeRequest[]> {
  if (isMockMode()) {
    return mockStore.listRechargeRequests(null) as RechargeRequest[];
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

  const { data, error } = await sb
    .from('recharge_requests')
    .select('id, user_id, plan_id, amount_cny, pay_method, status, proof_text, proof_image_url, created_at, handled_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new AppError('UNKNOWN', '读取充值记录失败', error);

  type Row = {
    id: string;
    user_id: string;
    plan_id: string | null;
    amount_cny: number;
    pay_method: string;
    status: string;
    proof_text: string | null;
    proof_image_url: string | null;
    created_at: string;
    handled_at: string | null;
  };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    nickname: null,
    planId: r.plan_id,
    planName: null,
    amountCny: Number(r.amount_cny ?? 0),
    payMethod: (r.pay_method === 'alipay' ? 'alipay' : 'wechat'),
    status: (r.status === 'approved' || r.status === 'rejected' ? r.status : 'pending'),
    proofText: r.proof_text,
    proofImageUrl: r.proof_image_url,
    createdAt: r.created_at,
    handledAt: r.handled_at,
  }));
}

/**
 * 管理员：确认 / 拒绝一条充值请求。
 *
 * @param id 请求 ID。
 * @param ok true=确认到账（加积分），false=拒绝。
 */
export async function approveRequest(id: string, ok: boolean): Promise<{ ok: boolean; balance?: number; message?: string }> {
  if (isMockMode()) {
    await mockStore.approveRechargeRequest(id, ok);
    return { ok: true, message: ok ? '已确认到账（演示）' : '已拒绝（演示）' };
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data, error } = await sb.rpc('admin_approve_recharge', { p_id: id, p_ok: ok });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    ok: raw.ok === true,
    balance: Number(raw.balance ?? 0),
    message: String(raw.message ?? ''),
  };
}

/**
 * 管理员：保存收款码 + 引导文案（写入 system_config.payment）。
 *
 * @param cfg 新的配置。
 */
export async function savePaymentConfig(cfg: PaymentConfig): Promise<void> {
  const value: Json = {
    wechatQrUrl: cfg.wechatQrUrl.trim(),
    alipayQrUrl: cfg.alipayQrUrl.trim(),
    tip: cfg.tip.trim() || DEFAULT_TIP,
  };
  if (isMockMode()) {
    await mockStore.setPaymentConfig({ ...cfg, tip: cfg.tip.trim() || DEFAULT_TIP });
    return;
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.rpc('admin_set_system_config', { p_key: 'payment', p_value: value });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}