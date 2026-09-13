import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { toPlan, toRedemptionCode, toReportItem, toAdminUser } from './mappers';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import { generateCode, uuid } from '@/utils/hash';
import { CNY_PER_CREDIT } from '@/config/creditRules';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import type {
  AdminStats,
  MembershipPlan,
  RedemptionCode,
  ReportItem,
} from '@/types/models';
import type { RedemptionStatus, ReportStatus } from '@/types/enums';

/**
 * 管理员服务（Q10 极简三功能 + 客户新增要求）：
 * 1. 定义套餐档位（`membership_plans`）；
 * 2. 批量生成并导出兑换码、查看已用未用；
 * 3. 手动给指定用户加减积分（留操作人与备注，便于对账）；
 * 4. 应用下架/恢复、举报处理、看板、模型与应用类型配置。
 *
 * 权限：全部 RPC 内部校验 `profiles.role = 'admin'`，非管理员会收到 42501。
 */

export interface AdminUserView {
  id: string;
  nickname: string;
  role: string;
  email: string | null;
  balance: number;
  planId: string | null;
  generationCount: number;
  createdAt: string;
}

/**
 * 取得已连接的客户端。
 *
 * @throws {AppError} 未配置后端或处于 MOCK 模式时抛出。
 */
function requireBackend(): SupabaseClient<Database> {
  const sb = getSupabase();
  if (!sb || isMockMode()) {
    throw new AppError('FORBIDDEN', '演示模式下无法操作后台，请先连接云端服务');
  }
  return sb;
}

// ---------------------------------------------------------------------------
// 兑换码
// ---------------------------------------------------------------------------

/**
 * 批量生成兑换码。
 *
 * @param input 面额 / 张数 / 类型 / 套餐 / 有效期 / 批次备注。
 * @returns 生成的码列表（可直接复制导出）。
 */
export async function createCodes(input: {
  credits: number;
  count: number;
  kind?: 'credit' | 'invite' | 'membership';
  planId?: string;
  validDays?: number;
  batchNo?: string;
  expiresAt?: string | null;
  memo?: string;
}): Promise<string[]> {
  if (isMockMode()) {
    await mockStore.load();
    const now = new Date().toISOString();
    const batchNo = input.batchNo?.trim() || `DEMO-${now.slice(0, 10).replace(/-/g, '')}`;
    const codes: RedemptionCode[] = Array.from({ length: Math.min(Math.max(Math.round(input.count), 1), 2000) }, () => ({
      code: generateCode(),
      kind: input.kind ?? 'credit',
      planId: input.planId ?? null,
      credits: Math.max(Math.round(input.credits), 0),
      validDays: input.validDays ?? 0,
      batchNo,
      status: 'unused' as RedemptionStatus,
      usedBy: null,
      usedAt: null,
      expiresAt: input.expiresAt ?? null,
      createdBy: mockStore.current().profile?.id ?? null,
      createdAt: now,
      memo: input.memo ?? '',
    }));
    await mockStore.addCodes(codes);
    return codes.map((c) => c.code);
  }

  const sb = requireBackend();
  const { data, error } = await sb.rpc('admin_create_codes', {
    p_credits: Math.max(Math.round(input.credits), 0),
    p_count: Math.min(Math.max(Math.round(input.count), 1), 2000),
    p_kind: input.kind ?? 'credit',
    p_plan_id: input.planId ?? null,
    p_valid_days: input.validDays ?? 0,
    p_batch_no: input.batchNo ?? null,
    p_expires_at: input.expiresAt ?? null,
    p_memo: input.memo ?? '',
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  return ((data ?? []) as { code: string }[]).map((r) => r.code);
}

/**
 * 查询兑换码（已用 / 未用 / 批次过滤）。
 *
 * @param filter 过滤条件。
 */
export async function listCodes(filter: {
  kind?: string;
  status?: string;
  batchNo?: string;
  offset?: number;
  limit?: number;
} = {}): Promise<{ items: RedemptionCode[]; total: number }> {
  if (isMockMode()) {
    await mockStore.load();
    const items = mockStore.listCodes((filter.status ?? '') as RedemptionStatus | '');
    return { items, total: items.length };
  }
  const sb = requireBackend();
  const { data, error } = await sb.rpc('admin_list_codes', {
    p_kind: filter.kind ?? null,
    p_status: filter.status ?? null,
    p_batch_no: filter.batchNo ?? null,
    p_offset: filter.offset ?? 0,
    p_limit: filter.limit ?? 100,
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  const rows = (data ?? []) as Parameters<typeof toRedemptionCode>[0][];
  const items = rows.map(toRedemptionCode);
  return { items, total: rows.length > 0 ? Number(rows[0].total_count ?? items.length) : 0 };
}

/**
 * 停用一张未使用的兑换码。
 *
 * @param code 兑换码。
 */
export async function disableCode(code: string): Promise<void> {
  if (isMockMode()) {
    await mockStore.load();
    await mockStore.setCodeStatus(code, 'disabled');
    return;
  }
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_disable_code', { p_code: code.trim().toUpperCase() });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

// ---------------------------------------------------------------------------
// 积分调整
// ---------------------------------------------------------------------------

/**
 * 手动给指定用户加减积分。
 *
 * @param userId 目标用户 UUID。
 * @param delta 变动量（正=加，负=减）。
 * @param memo 备注（写入流水，便于对账）。
 * @returns 调整后的余额。
 */
export async function adjustCredits(userId: string, delta: number, memo: string): Promise<number> {
  if (delta === 0) throw new AppError('VALIDATE_FAILED', '调整数量不能为 0');
  if (!memo.trim()) throw new AppError('VALIDATE_FAILED', '请填写备注，方便以后对账');

  if (isMockMode()) {
    await mockStore.load();
    return mockStore.applyCredit(Math.round(delta), 'admin_adjust', memo.trim(), {
      refType: 'admin_adjust',
      refId: uuid(),
    });
  }

  const sb = requireBackend();
  const { data, error } = await sb.rpc('admin_adjust_credits', {
    p_user_id: userId,
    p_delta: Math.round(delta),
    p_memo: memo.trim(),
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  const raw = (data ?? {}) as Record<string, unknown>;
  if (raw.ok !== true) throw new AppError('FORBIDDEN', String(raw.message ?? '调整失败，可能是余额不足'));
  return Number(raw.balance ?? 0);
}

/**
 * 搜索用户（用于挑人加积分）。
 *
 * @param q 昵称关键词。
 * @param offset 偏移量。
 * @param limit 每页条数。
 */
export async function listUsers(
  q = '',
  offset = 0,
  limit = 50,
): Promise<{ items: AdminUserView[]; total: number }> {
  if (isMockMode()) {
    await mockStore.load();
    const st = mockStore.current();
    const me = st.profile;
    const items: AdminUserView[] = me
      ? [
          {
            id: me.id,
            nickname: me.nickname,
            role: me.role,
            email: null,
            balance: st.account.balance,
            planId: st.membership?.planId ?? null,
            generationCount: 0,
            createdAt: me.createdAt,
          },
        ]
      : [];
    return { items, total: items.length };
  }
  const sb = requireBackend();
  const { data, error } = await sb.rpc('admin_list_users', {
    p_q: q || null,
    p_offset: offset,
    p_limit: Math.min(Math.max(Math.round(limit), 1), 50),
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  const rows = (data ?? []) as Parameters<typeof toAdminUser>[0][];
  const items = rows.map(toAdminUser);
  return { items, total: rows.length > 0 ? Number(rows[0].total_count ?? items.length) : 0 };
}

// ---------------------------------------------------------------------------
// 套餐档位
// ---------------------------------------------------------------------------

/** 列出全部套餐档位（含已停用）。 */
export async function listPlans(): Promise<MembershipPlan[]> {
  if (isMockMode()) return (await mockStore.load()).plans;
  const sb = requireBackend();
  const { data, error } = await sb
    .from('membership_plans')
    .select('*')
    .order('sort_order', { ascending: true });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  return ((data ?? []) as Parameters<typeof toPlan>[0][]).map(toPlan);
}

/**
 * 新增或更新一个套餐档位。
 *
 * @param plan 套餐定义。
 */
export async function upsertPlan(plan: {
  id: string;
  name: string;
  credits: number;
  durationDays: number;
  priceCny: number;
  description?: string;
  sortOrder?: number;
}): Promise<void> {
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_upsert_plan', {
    p_id: plan.id.trim(),
    p_name: plan.name.trim(),
    p_credits: Math.max(Math.round(plan.credits), 0),
    p_duration_days: Math.max(Math.round(plan.durationDays), 0),
    p_price_cny: Number(plan.priceCny) || 0,
    p_description: plan.description ?? '',
    p_sort_order: plan.sortOrder ?? 0,
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

/**
 * 启用 / 停用一个套餐档位。
 *
 * @param id 套餐 ID。
 * @param enabled 是否启用。
 */
export async function setPlanEnabled(id: string, enabled: boolean): Promise<void> {
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_set_plan_enabled', { p_id: id, p_enabled: enabled });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

// ---------------------------------------------------------------------------
// 模型与应用类型配置（客户要求：可配置多家 Key / 模型 ID / 单价 / 按类型路由）
// ---------------------------------------------------------------------------

export interface ModelConfigInput {
  id: string;
  provider: 'deepseek' | 'qwen' | 'glm' | 'doubao';
  modelId: string;
  displayName: string;
  apiBase?: string;
  pricing?: { input: number; cachedInput: number; output: number; peakMultiplier: number };
  maxOutputTokens?: number;
  creditsPerCall?: number;
  isDefault?: boolean;
  enabled?: boolean;
  sortOrder?: number;
}

/**
 * 新增或更新一个模型配置。
 *
 * ⚠️ API Key 不入库，只在 Supabase Secrets 中配置（见 .env.example 第二部分）。
 *
 * @param model 模型配置。
 */
export async function upsertModel(model: ModelConfigInput): Promise<void> {
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_upsert_model', {
    p_id: model.id.trim(),
    p_provider: model.provider,
    p_model_id: model.modelId.trim(),
    p_display_name: model.displayName.trim(),
    p_api_base: model.apiBase ?? '',
    p_pricing: (model.pricing ?? null) as never,
    p_max_output_tokens: model.maxOutputTokens ?? 8000,
    p_credits_per_call: model.creditsPerCall ?? 1,
    p_is_default: model.isDefault ?? false,
    p_enabled: model.enabled ?? true,
    p_sort_order: model.sortOrder ?? 0,
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

/**
 * 配置某个应用类型的积分成本与模型路由。
 *
 * @param input 类型配置。
 */
export async function upsertAppType(input: {
  appType: string;
  label: string;
  creditCost: number;
  modelOverride?: string | null;
  enabled?: boolean;
}): Promise<void> {
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_upsert_app_type', {
    p_app_type: input.appType,
    p_label: input.label,
    p_credit_cost: Math.max(Math.round(input.creditCost), 0),
    p_model_override: input.modelOverride ?? null,
    p_enabled: input.enabled ?? true,
  });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

// ---------------------------------------------------------------------------
// 应用治理与看板
// ---------------------------------------------------------------------------

/**
 * 下架应用。
 *
 * @param appId 应用 UUID。
 * @param reason 下架原因（写入简介，便于作者理解）。
 */
export async function takedown(appId: string, reason = ''): Promise<void> {
  if (isMockMode()) {
    await mockStore.load();
    await mockStore.setAppStatus(appId, 'taken_down');
    return;
  }
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_takedown', { p_app_id: appId, p_reason: reason });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

/** 恢复应用为草稿。 */
export async function restore(appId: string): Promise<void> {
  if (isMockMode()) {
    await mockStore.load();
    await mockStore.setAppStatus(appId, 'draft');
    return;
  }
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_restore', { p_app_id: appId });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

/**
 * 举报列表。
 *
 * @param status 过滤状态。
 */
export async function listReports(status = 'pending'): Promise<ReportItem[]> {
  if (isMockMode()) {
    await mockStore.load();
    return mockStore.listReports((status || '') as ReportStatus | '');
  }
  const sb = requireBackend();
  const { data, error } = await sb.rpc('admin_list_reports', { p_status: status });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  return ((data ?? []) as Parameters<typeof toReportItem>[0][]).map(toReportItem);
}

/**
 * 处理举报。
 *
 * @param reportId 举报 ID。
 * @param action `handled`（已处理）或 `dismissed`（忽略）。
 */
export async function handleReport(reportId: number, action: 'handled' | 'dismissed' = 'handled'): Promise<void> {
  if (isMockMode()) {
    await mockStore.load();
    await mockStore.setReportStatus(String(reportId), action);
    return;
  }
  const sb = requireBackend();
  const { error } = await sb.rpc('admin_handle_report', { p_report_id: reportId, p_action: action });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
}

/** 管理员看板。 */
export async function stats(): Promise<AdminStats> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const today = new Date().toISOString().slice(0, 10);
    const mine = st.apps.filter((a) => a.authorId === (st.profile?.id ?? 'mock-user'));
    const gensToday = st.ledger.filter(
      (l) => l.reason === 'generate_spend' && l.createdAt.slice(0, 10) === today,
    ).length;
    const spend = st.apps.reduce((sum, a) => sum + (a.tokensIn + a.tokensOut), 0);
    const topApps = [...st.apps]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 5)
      .map((a) => ({ id: a.id, title: a.title, viewCount: a.viewCount, likeCount: a.likeCount }));

    return {
      users: Math.max(st.profile ? 1 : 0, new Set(st.apps.map((a) => a.authorId)).size),
      apps: st.apps.length,
      published: st.apps.filter((a) => a.status === 'published').length,
      gensToday: gensToday + mine.filter((a) => a.createdAt.slice(0, 10) === today).length,
      // 演示口径：按 token 量与内部对账单价估算（真实场景读 monthly_spend 表）
      spendMonthCny: Math.round(spend * 0.003 * CNY_PER_CREDIT * 100) / 100,
      topApps,
    };
  }

  const sb = requireBackend();
  const { data, error } = await sb.rpc('admin_stats');
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  const raw = (data ?? {}) as Record<string, unknown>;
  const topApps = Array.isArray(raw.topApps) ? (raw.topApps as AdminStats['topApps']) : [];
  return {
    users: Number(raw.users ?? 0),
    apps: Number(raw.apps ?? 0),
    published: Number(raw.published ?? 0),
    gensToday: Number(raw.gensToday ?? 0),
    spendMonthCny: Number(raw.spendMonthCny ?? 0),
    topApps: topApps.map((a) => ({
      id: String(a.id),
      title: String(a.title ?? ''),
      viewCount: Number(a.viewCount ?? 0),
      likeCount: Number(a.likeCount ?? 0),
    })),
  };
}
