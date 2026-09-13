/**
 * 邮件发送适配器接口与公共物料（照搬 `_shared/llm/types.ts` 的结构）。
 *
 * 设计要点：
 * - 每个邮件供应商一个文件（`aliyun.ts` / `brevo.ts`），各自实现 `EmailAdapter`；
 * - 密钥只从 `Deno.env.get()` 在**运行时**读取，**永不写进日志、永不硬编码**；
 * - `isAvailable()` 依据自身 env 密钥是否配置，供 `index.ts` 做运行时选择；
 * - 新增供应商只需三步：
 *     1. 新建 `_shared/email/<provider>.ts` 实现本接口；
 *     2. 在 `index.ts` 的 `REGISTRY` 里注册 + 加进 `FALLBACK_ORDER`；
 *     3. `supabase secrets set <PROVIDER>_API_KEY=...`（必要时再设 `EMAIL_PROVIDER`）。
 *   不需要改动任何调用方代码。
 */

/** 支持的邮件服务商。 */
export type EmailProvider = 'aliyun' | 'brevo';

/**
 * 邮件发信适配器接口。
 *
 * 所有供应商实现必须满足该接口，切换供应商对调用方完全透明。
 */
export interface EmailAdapter {
  readonly provider: EmailProvider;
  /** 是否可用（一般取决于是否配置了自身的 env 密钥）。 */
  isAvailable(): boolean;
  /**
   * 发送 6 位邮箱验证码。
   * @param to   收件邮箱（调用方已 lower() 处理）
   * @param code 6 位验证码明文
   * @throws {Error} 消息为 'DEV_MODE' 表示缺少密钥（开发态回显）；否则为发送失败
   */
  sendCode(to: string, code: string): Promise<void>;
}

/** 邮件主题（中文；阿里云侧由 percentEncode 做 UTF-8 百分号编码）。 */
export const SUBJECT = '【师创】邮箱验证码';

/**
 * 构造验证码 HTML 邮件正文（阿里云 / Brevo 共用同一套文案，避免两处漂移）。
 *
 * @param code 6 位验证码明文。
 */
export function buildHtml(code: string): string {
  return (
    '<!DOCTYPE html>' +
    '<html lang="zh-CN"><body>' +
    `<p>您好，您正在注册「师创」教师 AI 平台。</p>` +
    `<p>您的邮箱验证码为：<strong style="font-size:24px;letter-spacing:2px">${code}</strong></p>` +
    '<p>该验证码 10 分钟内有效，请勿泄露给他人。如非本人操作，请忽略本邮件。</p>' +
    '</body></html>'
  );
}
