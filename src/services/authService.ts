import { getSupabase } from './supabaseClient';
import { AppError, codeFromMessage } from './http/errors';
import { ROUTES } from '@/config/routes';
import { passwordProvider } from './authProvider/password';
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
 * - P0 默认 `password`（注册走邮箱验证码两步校验）；`phone` / `wechat` 已建文件并在调用时抛「暂未启用」；
 * - MOCK 模式（未配置 Supabase）下走本地账本，保证主链路可演示。
 */

/** 全部已实现的 Provider（顺序即 UI 展示顺序）。 */
const ALL_PROVIDERS: readonly AuthProvider[] = [
  passwordProvider,
  phoneProvider,
  wechatProvider,
];

/**
 * 获取按服务端配置排序的 Provider 列表。
 *
 * @returns 已实现的全部 Provider（`enabled` 由配置决定）。
 */
export async function getProviders(): Promise<AuthProvider[]> {
  let enabledIds: string[] = ['password'];
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

/**
 * 取出 Edge Function 返回的真实错误文案。
 *
 * `functions.invoke` 在非 2xx 时只给一句通用的
 * "Edge Function returned a non-2xx status code"，真正的中文提示
 * （如「验证码发送太频繁，请稍后再试」）藏在 `error.context`（原始 Response）里。
 * 这里把它解析出来，避免用户在页面上只看到一句没用的英文。
 */
async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const res = (error as { context?: Response } | null)?.context;
  try {
    if (res && typeof res.json === 'function') {
      const body = (await res.json()) as { message?: string };
      if (body?.message) return body.message;
    }
  } catch {
    /* 解析失败就用兜底文案 */
  }
  const msg = (error as { message?: string } | null)?.message;
  return msg && !/non-2xx/i.test(msg) ? msg : fallback;
}

/** 请求向指定邮箱发送 6 位验证码（注册前置校验）。 */
export async function requestEmailCode(email: string): Promise<{ dev?: boolean; devCode?: string }> {
  if (isMockMode()) return {};
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data, error } = await sb.functions.invoke('request-email-code', { body: { email: email.trim().toLowerCase() } });
  if (error) throw new AppError('UNKNOWN', await edgeErrorMessage(error, '验证码发送失败，请稍后再试'), error);
  return (data ?? {}) as { dev?: boolean; devCode?: string };
}

/** 校验指定邮箱的 6 位验证码（注册前置校验）。 */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  if (isMockMode()) return;
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.functions.invoke('verify-email-code', { body: { email: email.trim().toLowerCase(), code } });
  if (error) throw new AppError('CODE_INVALID', await edgeErrorMessage(error, '验证码不正确或已过期'), error);
}

/**
 * 拼接「忘记密码」邮件的回跳地址（Supabase 要求必须是绝对地址）。
 *
 * 站点部署在 GitHub Pages 项目页（`BASE_URL='/shichuang/'`），本地 dev 为 `'/'`，
 * 所以**不能硬编码域名**，统一由 `window.location.origin` 拼出来：
 * - 线上：`https://yemabuye11.github.io/shichuang/reset`
 * - 本地：`http://localhost:5173/reset`
 */
function buildPasswordResetRedirect(): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${window.location.origin}${base}${ROUTES.RESET}`;
}

/**
 * 请求向指定邮箱发送「重置密码」邮件。
 *
 * 直接使用 Supabase 自带的邮件能力（`auth.resetPasswordForEmail`），
 * 不需要任何第三方邮件服务、不需要自有域名。
 * 免费额度约 4 封/小时，试点阶段足够。
 *
 * 注意：出于安全，Supabase 对不存在的邮箱同样返回成功（避免账号枚举），
 * 所以调用方不能靠「成功」判断邮箱是否已注册。
 *
 * @param email 注册时使用的邮箱。
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (isMockMode()) return;
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: buildPasswordResetRedirect(),
  });
  if (!error) return;

  // Supabase 的限流原文是英文（如 "email rate limit exceeded"），这里换成教师能看懂的中文。
  const raw = error.message ?? '';
  const rateLimited = /rate[_ ]limit|security purposes|过于频繁|稍后再试/i.test(raw);
  throw new AppError(
    'UNKNOWN',
    rateLimited
      ? '发送太频繁了（每小时有次数限制），请过一会儿再试'
      : '重置密码邮件发送失败，请稍后重试',
    error,
  );
}

/**
 * 从「重置密码」邮件链接中恢复会话，供 `/reset` 页判断链接是否仍有效。
 *
 * 兼容两种 flow，不能只写一种：
 * 1. **PKCE**（客户端配置了 `flowType: 'pkce'`）：链接形如 `?code=xxx`，
 *    必须手动 `exchangeCodeForSession()` 才能拿到 session；
 * 2. **Implicit / hash**（当前 `supabaseClient.ts` 的默认 flow）：
 *    链接形如 `#access_token=xxx&type=recovery`，客户端 `detectSessionInUrl`
 *    会在初始化时自动解析，直接 `getSession()` 即可。
 *
 * 另外，链接过期时 Supabase 会带上 `?error=…&error_description=…`，此时直接判为失效。
 *
 * @returns `true` 表示已拿到可用于改密码的会话。
 */
export async function restoreRecoverySession(): Promise<boolean> {
  if (isMockMode()) return false;
  const sb = getSupabase();
  if (!sb) return false;

  const search = window.location.search;
  const params = new URLSearchParams(search);
  // implicit flow 下 Supabase 把错误放在 hash 里（#error_code=otp_expired&error_description=…），
  // PKCE 下则放在 search 里，两边都要看。
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = params.get('code');
  const hasUrlError =
    params.has('error') ||
    params.has('error_description') ||
    hashParams.has('error') ||
    hashParams.has('error_code');

  try {
    // 链接本身已经带错误（如 otp_expired）→ 无需再尝试换 session
    if (hasUrlError) return false;

    if (code) {
      const { error } = await sb.auth.exchangeCodeForSession(search);
      if (error) return false;
    }

    const { data } = await sb.auth.getSession();
    return Boolean(data.session?.user);
  } catch {
    return false;
  } finally {
    // 无论成功与否都清掉 URL 上的 code / hash：
    // 否则用户刷新时会拿一个已用过的 code 再换一次 session，被判为「链接失效」。
    clearRecoveryParamsFromUrl();
  }
}

/**
 * 清掉地址栏里的恢复参数（`code` / `error*` / hash），只保留路径与其余查询串。
 *
 * 失败不影响主流程（个别浏览器或内嵌 WebView 可能限制 history API）。
 */
function clearRecoveryParamsFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    let touched = false;
    for (const key of ['code', 'error', 'error_code', 'error_description']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        touched = true;
      }
    }
    if (url.hash) {
      url.hash = '';
      touched = true;
    }
    if (touched) {
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    }
  } catch {
    /* 浏览器不支持时忽略 */
  }
}

/**
 * 用邮箱验证码重置密码（代码式，替代 Supabase 的邮件链接式）。
 *
 * 直接调 `reset-password` Edge Function：服务端独立校验验证码（不信任前端
 * 已验证状态），校验通过后用 service_role 改密并消费验证码。全流程不离开本页，
 * 教师不用来回切邮件、不点链接。
 *
 * 安全由「邮箱持有」保证，与注册验证码同源（同一张 `email_verifications` 表、
 * 同一套限流、同一套 `SECRET_SALT` 哈希）。
 *
 * @param email 注册邮箱。
 * @param code 6 位邮箱验证码。
 * @param newPassword 新密码（≥8 位，服务端也会再卡一道）。
 */
export async function resetPasswordWithCode(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  if (isMockMode()) throw new AppError('NETWORK', '演示模式不支持找回密码，请配置云端服务后再试');
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.functions.invoke('reset-password', {
    body: { email: email.trim().toLowerCase(), code, newPassword },
  });
  if (error) throw new AppError('UNKNOWN', await edgeErrorMessage(error, '密码重置失败，请稍后重试'), error);
}

/**
 * 在恢复会话下设置新密码。
 *
 * 只能在上一步 {@link restoreRecoverySession} 返回 `true` 后调用，
 * 否则 Supabase 会以 401 拒绝（普通会话无权重改密码）。
 *
 * @param newPassword 新密码（调用方需先校验长度，Supabase 默认最少 6 位）。
 */
export async function updatePassword(newPassword: string): Promise<void> {
  if (isMockMode()) throw new AppError('NETWORK', '演示模式不支持找回密码，请配置云端服务后再试');
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (!error) return;

  const raw = error.message ?? '';
  const sessionExpired = /jwt|token|session|expired|Auth session/i.test(raw);
  throw new AppError(
    'UNKNOWN',
    sessionExpired
      ? '重置链接已失效或已过期，请重新申请'
      : '密码修改失败，请稍后重试',
    error,
  );
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
  requestEmailCode,
  verifyEmailCode,
  resetPasswordWithCode,
  requestPasswordReset,
  restoreRecoverySession,
  updatePassword,
  signOut,
  getCurrentUser,
  updateProfile,
  onAuthStateChange,
  isAdmin,
};

export type { AuthProvider, AuthProviderId, AuthResult, AuthPayload } from './authProvider/types';
