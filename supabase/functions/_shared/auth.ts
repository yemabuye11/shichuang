/**
 * 从请求中解析调用者身份。
 */

import { AppError } from './errors.ts';
import { adminClient } from './supabaseAdmin.ts';

export interface Caller {
  /** 用户 UUID。 */
  userId: string;
  /** 原始 JWT（用于以用户身份调用 RLS 受保护的资源）。 */
  token: string;
}

/**
 * 校验 `Authorization: Bearer <jwt>` 并返回调用者。
 *
 * @param req 原始请求。
 * @throws {AppError} 未携带或 token 无效时抛 `UNAUTHORIZED`。
 */
export async function requireUser(req: Request): Promise<Caller> {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new AppError('UNAUTHORIZED', '缺少登录凭证，请先登录', { retryable: false });
  }

  const token = match[1].trim();
  const sb = adminClient();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    throw new AppError('UNAUTHORIZED', '登录状态已失效，请重新登录', { retryable: false });
  }
  return { userId: data.user.id, token };
}

/**
 * 尝试解析调用者；失败返回 `null`（用于匿名可用的接口）。
 *
 * @param req 原始请求。
 */
export async function optionalUser(req: Request): Promise<Caller | null> {
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}
