/**
 * 邮件适配器注册与运行时选择（结构照搬 `_shared/llm/index.ts`）。
 *
 * ⚠️ 为什么这么设计（客户最关心的一点）：
 *   **供应商身份和密钥全部在运行时通过 `Deno.env.get()` 读取，代码里不写死任何一家。**
 *   因此以后从 Brevo 换回阿里云（或新增第三家），**只需要改 Supabase 的环境密钥，
 *   不需要改代码、不需要重新部署 Edge Function**：
 *
 *     supabase secrets set EMAIL_PROVIDER=aliyun
 *     supabase secrets set ALIYUN_DM_ACCESS_KEY_ID=... ALIYUN_DM_ACCESS_KEY_SECRET=... ALIYUN_DM_FROM=noreply@yourdomain.com
 *
 *   （Supabase 把 secrets 注入函数运行环境，函数下次冷启动时即拿到新值。）
 *
 * 选择顺序：
 * 1. `EMAIL_PROVIDER`（`aliyun` / `brevo`；未设置或非法值视为 auto）指定的首选供应商；
 * 2. 首选不可用（没配密钥）→ 按 `FALLBACK_ORDER` 找第一个 `isAvailable()` 的；
 * 3. **一家都不可用 → `throw new Error('DEV_MODE')`** —— 调用方据此把验证码
 *    原样回显（devCode），保证无邮件服务商时整条注册流程仍可端到端验证。
 *    注意：这里**没有** mock 兜底，必须抛错，否则开发态回显会失效。
 */

import { aliyunAdapter } from './aliyun.ts';
import { brevoAdapter } from './brevo.ts';
import type { EmailAdapter, EmailProvider } from './types.ts';

const REGISTRY = new Map<EmailProvider, EmailAdapter>([
  ['brevo', brevoAdapter],
  ['aliyun', aliyunAdapter],
]);

/**
 * 回退顺序：越靠前越优先。
 * Brevo 排在阿里云前面，因为客户短期（未购买域名前）用它发信。
 */
const FALLBACK_ORDER: readonly EmailProvider[] = ['brevo', 'aliyun'];

/**
 * 按 provider 取适配器；未注册时返回 undefined。
 *
 * @param provider 供应商标识。
 */
export function getEmailAdapter(provider: string): EmailAdapter | undefined {
  return REGISTRY.get(provider as EmailProvider);
}

/**
 * 选择一个**当前可用**的邮件适配器（首选 → 回退链）。
 *
 * @param preferred 首选 provider；不传则读环境变量 `EMAIL_PROVIDER`。
 * @returns 适配器与其 provider。
 * @throws {Error} 消息为 'DEV_MODE' 表示一家可用供应商都没有（开发态回显）。
 */
export function chooseEmailAdapter(
  preferred?: string,
): { adapter: EmailAdapter; provider: EmailProvider } {
  const raw = (preferred ?? Deno.env.get('EMAIL_PROVIDER') ?? '').trim().toLowerCase();
  const preferredKey = raw as EmailProvider;

  const preferredAdapter = REGISTRY.get(preferredKey);
  if (preferredAdapter?.isAvailable()) {
    return { adapter: preferredAdapter, provider: preferredKey };
  }

  for (const key of FALLBACK_ORDER) {
    const adapter = REGISTRY.get(key);
    if (adapter?.isAvailable()) return { adapter, provider: key };
  }

  // 一家都没配 → 开发态：交给调用方回显验证码
  throw new Error('DEV_MODE');
}

/**
 * 发送邮箱验证码（对外主入口，签名与改造前的 `_shared/email.ts` 完全一致）。
 *
 * @param to   收件邮箱（调用方已 lower() 处理）
 * @param code 6 位验证码明文
 * @throws {Error} 'DEV_MODE' 表示无任何可用供应商；'EMAIL_SEND_FAILED' 表示发送失败
 */
export async function sendEmail(to: string, code: string): Promise<void> {
  const { adapter } = chooseEmailAdapter();
  await adapter.sendCode(to, code);
}

export { aliyunAdapter, brevoAdapter };
export type { EmailAdapter, EmailProvider } from './types.ts';
