import { getSupabase } from './supabaseClient';
import { AppError, codeFromMessage } from './http/errors';
import { passwordProvider } from './authProvider/password';
import { inviteProvider } from './authProvider/invite';
import { phoneProvider } from './authProvider/phone';
import { wechatProvider } from './authProvider/wechat';
import { getPublicConfig } from './systemConfigService';
import { toAppType } from './mappers';
import type { AuthPayload, AuthProvider, AuthProviderId, AuthResult } from './authProvider/types';
import type { CurrentUser, Profile } from '@/types/models';
import { toCreditAccount, toProfile, toUserMembership } from './mappers';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';

/**
 * 认证服务（前端唯一入口）。
 *
 * 设计要点：
 * - Provider 按 `system_config.auth.providers` 动态注册，开关只改配置；
 * - P0 默认 `password` + `invite`；`phone` / `wechat` 已建文件并在调用时抛「暂未启用」；
 * - MOCK 模式（未配置 Supabase）下走本地账本，保证主链路可演示。
 */

/** 全部已实现的 Provider（顺序即 UI 展示顺序）。 */
const ALL_PROVIDERS: readonly AuthProvider[] = [
  passwordProvider,
  inviteProvider,
  phoneProvider,
  wechatProvider,
];

/**
 * 获取按服务端配置排序的 Provider 列表。
 *
 * @returns 已实现的全部 Provider（`enabled` 由配置决定）。
 */
export async function getProviders(): Promise<AuthProvider[]> {
  let enabledIds: string[] = ['password', 'invite'];
  try {
    const cfg = await getPublicConfig();
    if (cfg.auth.providers.length > 0) enabledIds = cfg.auth.providers;
  } catch {
    /* 配置读取失败时用默认值 */
  }

  const ordered = [...ALL_PROVIDERS].sort((a, b) => {
    const ia = enabledIds.indexOf(a.id);
    const ib = enabledIds.indexOf(b.id);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return ordered.map((p) => ({ ...p, enabled: enabledIds.includes(p.id) }));
}

/** 仅返回已启用的 Provider。 */
export async function getEnabledProviders(): Promise<AuthProvider[]> {
  return (await getProviders()).filter((p) => p.enabled);
}

/**
 * 按 id 调用登录。
 *
 * @param id Provider 标识。
 * @param payload 登录载荷。
 */
export async function signIn(id: AuthProviderId, payload: AuthPayload): Promise<AuthResult> {
  const provider = ALL_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new AppError('NOT_ENABLED', '该登录方式暂未启用');
  if (!provider.enabled) throw new AppError('NOT_ENABLED', `${provider.label}暂未启用`);
  try {
    return await provider.signIn(payload);
  } catch (err) {
    throw normalize(err);
  }
}

/**
 * 按 id 调用注册。
 *
 * @param id Provider 标识。
 * @param payload 注册载荷。
 */
export async function signUp(id: AuthProviderId, payload: AuthPayload): Promise<AuthResult> {
  const provider = ALL_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new AppError('NOT_ENABLED', '该登录方式暂未启用');
  if (!provider.enabled) throw new AppError('NOT_ENABLED', `${provider.label}暂未启用`);
  try {
    return await provider.signUp(payload);
  } catch (err) {
    throw normalize(err);
  }
}

/** 退出登录。 */
export async function signOut(): Promise<void> {
  if (isMockMode()) {
    mockStore.signOutLocal();
    return;
  }
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw new AppError('UNKNOWN', '退出登录失败，请重试', error);
}

/**
 * 获取当前登录用户的完整视图（资料 + 积分账户 + 会员）。
 *
 * @returns 未登录返回 `null`。
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (isMockMode()) {
    const st = await mockStore.load();
    if (!st.profile) return null;
    return {
      profile: st.profile,
      account: st.account,
      membership: st.membership,
    };
  }

  const sb = getSupabase();
  if (!sb) return null;

  const { data: sessionData } = await sb.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;

  const [{ data: profileRow }, { data: accountRow }, { data: membershipRow }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('credit_accounts').select('*').eq('user_id', user.id).maybeSingle(),
    sb.from('user_memberships').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  const profile = toProfile(profileRow);
  if (!profile) return null;

  return {
    profile,
    account: toCreditAccount(accountRow),
    membership: toUserMembership(membershipRow),
  };
}

/**
 * 更新当前用户资料。
 *
 * @param patch 要更新的字段。
 */
export async function updateProfile(
  patch: Partial<Pick<Profile, 'nickname' | 'subject' | 'grade' | 'school'>>,
): Promise<Profile> {
  if (isMockMode()) {
    const st = await mockStore.load();
    if (st.profile) {
      st.profile = { ...st.profile, ...patch };
      await mockStore.persist();
      return st.profile;
    }
    throw new AppError('UNAUTHORIZED', '请先登录');
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '登录状态已失效，请重新登录');

  const { data, error } = await sb
    .from('profiles')
    .update({
      ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.grade !== undefined ? { grade: patch.grade } : {}),
      ...(patch.school !== undefined ? { school: patch.school } : {}),
    })
    .eq('id', uid)
    .select('*')
    .single();

  if (error) throw new AppError('FORBIDDEN', error.message, error);
  const profile = toProfile(data);
  if (!profile) throw new AppError('UNKNOWN', '保存失败，请重试');
  return profile;
}

/**
 * 订阅登录态变化。
 *
 * @param cb 变化回调。
 * @returns 取消订阅函数。
 */
export function onAuthStateChange(cb: (userId: string | null) => void): () => void {
  if (isMockMode()) return () => undefined;
  const sb = getSupabase();
  if (!sb) return () => undefined;
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    cb(session?.user?.id ?? null);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * 判断当前用户是否为管理员（供 RequireAuth 使用）。
 *
 * @returns `true` 表示 role='admin'。
 */
export async function isAdmin(): Promise<boolean> {
  const me = await getCurrentUser();
  return me?.profile.role === 'admin';
}

/** 把底层异常规整成 `AppError`，并尽量识别触发器抛出的业务错误码。 */
function normalize(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err ?? '');
  return new AppError(codeFromMessage(message), message, err);
}

/** 导出 `toAppType` 便于上层复用（避免页面直接引用 mappers）。 */
export { toAppType };

/** 默认聚合导出（兼容 `import authService from '@/services/authService'` 写法）。 */
export const authService = {
  getProviders,
  getEnabledProviders,
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  updateProfile,
  onAuthStateChange,
  isAdmin,
};

export type { AuthProvider, AuthProviderId, AuthResult, AuthPayload } from './authProvider/types';
