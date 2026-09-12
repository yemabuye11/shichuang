import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { toCreditAccount, toLedgerItem } from './mappers';
import type { CreditAccount, LedgerItem, MembershipPlan } from '@/types/models';
import type { RedeemResult } from '@/types/api';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import { SQUARE_PAGE_SIZE } from '@/config/creditRules';

/**
 * 积分服务：余额 / 流水 / 预估 / 兑换码充值。
 *
 * 红线（ARCHITECTURE.md §8.7）：所有写操作只经 SECURITY DEFINER RPC，
 * 前端**绝不自行判断余额是否够**（只用于展示预估），以服务端结果为准。
 */

/**
 * 获取我的积分账户。
 *
 * @returns 账户；未登录返回 `null`。
 */
export async function getBalance(): Promise<CreditAccount | null> {
  if (isMockMode()) {
    const st = await mockStore.load();
    return st.profile ? st.account : null;
  }

  const sb = getSupabase();
  if (!sb) return null;
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) return null;

  const { data, error } = await sb.from('credit_accounts').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw new AppError('UNKNOWN', '读取积分失败，请重试', error);
  return data ? toCreditAccount(data) : null;
}

/**
 * 获取积分流水（分页）。
 *
 * @param offset 偏移量。
 * @param limit 每页条数。
 */
export async function listLedger(offset = 0, limit = 30): Promise<LedgerItem[]> {
  if (isMockMode()) {
    const st = await mockStore.load();
    return st.ledger.slice(offset, offset + limit);
  }

  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('credit_transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new AppError('UNKNOWN', '读取积分明细失败，请重试', error);
  return (data ?? []).map(toLedgerItem);
}

/**
 * 生成前预估积分（P0-F2）。
 *
 * @param appType 应用类型。
 * @param model 模型 key（可空）。
 */
export async function estimateCost(appType: string, model?: string): Promise<number> {
  if (isMockMode()) {
    const { getAppTypeCost } = await import('@/config/constants');
    return getAppTypeCost(appType);
  }
  const sb = getSupabase();
  if (!sb) {
    const { getAppTypeCost } = await import('@/config/constants');
    return getAppTypeCost(appType);
  }
  const { data, error } = await sb.rpc('estimate_cost', { p_app_type: appType, p_model: model ?? null });
  if (error) {
    const { getAppTypeCost } = await import('@/config/constants');
    return getAppTypeCost(appType);
  }
  return Number(data ?? 1);
}

/**
 * 生成前三查：日限 / 并发 / 月度阀。
 *
 * @returns 允许与否及剩余次数。
 */
export async function checkAllowed(): Promise<{
  allowed: boolean;
  code: string;
  message: string;
  remainingToday: number;
}> {
  if (isMockMode()) {
    return { allowed: true, code: '', message: '', remainingToday: 30 };
  }
  const sb = getSupabase();
  if (!sb) return { allowed: true, code: '', message: '', remainingToday: 30 };

  const { data, error } = await sb.rpc('check_generation_allowed');
  if (error) return { allowed: true, code: '', message: '', remainingToday: 30 };
  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    allowed: raw.allowed !== false,
    code: String(raw.code ?? ''),
    message: String(raw.message ?? ''),
    remainingToday: Number(raw.remainingToday ?? 0),
  };
}

/**
 * 兑换码充值（P0-F5）。
 *
 * @param code 兑换码（大小写不敏感，内部转大写）。
 */
export async function redeem(code: string): Promise<RedeemResult> {
  const cleaned = (code ?? '').trim().toUpperCase();
  if (!cleaned) {
    return { ok: false, code: 'INVALID_CODE', credits: 0, balance: 0, message: '请输入兑换码' };
  }

  if (isMockMode()) {
    await mockStore.load();
    // 演示用固定码：SC50（+50）/ SC200（+200）；其余提示无效
    const table: Record<string, number> = { SC50: 50, SC200: 200, SC500: 500 };
    const credits = table[cleaned];
    if (!credits) {
      return { ok: false, code: 'INVALID_CODE', credits: 0, balance: 0, message: '兑换码不存在（演示码：SC50 / SC200 / SC500）' };
    }
    const balance = mockStore.applyCredit(credits, 'redeem_code', `兑换码充值（${cleaned}）`, {
      refType: 'code',
      refId: cleaned,
    });
    return { ok: true, code: '', credits, balance, message: `充值成功，到账 ${credits} 积分` };
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

  const { data, error } = await sb.rpc('redeem_code', { p_code: cleaned });
  if (error) throw new AppError('UNKNOWN', '兑换失败，请稍后重试', error);

  const raw = (data ?? {}) as Record<string, unknown>;
  return {
    ok: raw.ok === true,
    code: String(raw.code ?? ''),
    credits: Number(raw.credits ?? 0),
    balance: Number(raw.balance ?? 0),
    message: String(raw.message ?? ''),
  };
}

/**
 * 获取会员套餐档位（公开的 enabled 档位）。
 *
 * @returns 套餐列表。
 */
export async function listPlans(): Promise<MembershipPlan[]> {
  if (isMockMode()) {
    return (await mockStore.load()).plans;
  }
  const sb = getSupabase();
  if (!sb) return (await mockStore.load()).plans;
  const { data, error } = await sb
    .from('membership_plans')
    .select('*')
    .eq('enabled', true)
    .order('sort_order', { ascending: true });
  if (error) return [];
  const { toPlan } = await import('./mappers');
  return (data ?? []).map(toPlan);
}

/** 我的积分页一次拿全（账户 + 会员 + 最近流水）。 */
export async function getCreditBoard(): Promise<{
  account: CreditAccount | null;
  ledger: LedgerItem[];
  pageLimit: number;
}> {
  const [account, ledger] = await Promise.all([getBalance(), listLedger(0, 20)]);
  return { account, ledger, pageLimit: SQUARE_PAGE_SIZE };
}

/** 兼容命名导出（避免与 types/models 的类型名冲突）。 */
export type { CreditAccount, LedgerItem, MembershipPlan };
export type RedeemCodeResult = RedeemResult;
