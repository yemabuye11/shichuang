/**
 * Brevo（原 Sendinblue）事务邮件适配器 —— 单发「邮箱验证码」邮件。
 *
 * 为什么用它：阿里云 DirectMail 强制要求验证**自有发信域名**（要买域名 + 实名认证），
 * 而 Brevo 免费版（300 封/天）只需验证一个**发件邮箱**即可发信，
 * 适合客户在决定是否购买域名之前的过渡期。
 *
 * 协议：POST https://api.brevo.com/v3/smtp/email
 *       请求头 `api-key: <BREVO_API_KEY>` + `Content-Type: application/json`
 *       请求体 { sender: { name, email }, to: [{ email }], subject, htmlContent }
 *
 * 密钥（全部运行时读取，切换供应商只需 `supabase secrets set`，无需改代码）：
 *   - BREVO_API_KEY（必填，Brevo 控制台 → SMTP & API → API Keys）
 *   - BREVO_FROM_EMAIL（选填，缺省回落通用 `EMAIL_FROM`；必须是 Brevo 里已验证的发件邮箱）
 *   - BREVO_FROM_NAME（选填，默认「师创」）
 */

import { buildHtml, SUBJECT, type EmailAdapter } from './types.ts';

/** Brevo 事务邮件 REST 接口地址。 */
const API_URL = 'https://api.brevo.com/v3/smtp/email';

/** 默认发件人显示名。 */
const DEFAULT_FROM_NAME = '师创';

export class BrevoEmailAdapter implements EmailAdapter {
  readonly provider = 'brevo' as const;

  /**
   * 是否可用：已配置 BREVO_API_KEY。
   *
   * 发信地址（`BREVO_FROM_EMAIL` / `EMAIL_FROM`）缺失属于「配错」而非「没配」，
   * 留给 `sendCode()` 抛 `EMAIL_SEND_FAILED`，与阿里云适配器的口径保持一致。
   */
  isAvailable(): boolean {
    return (Deno.env.get('BREVO_API_KEY') ?? '').length > 0;
  }

  /**
   * 发送验证码邮件。
   * @param to   收件邮箱（调用方已 lower() 处理）
   * @param code 6 位验证码明文
   * @throws {Error} 'DEV_MODE' 表示缺密钥；'EMAIL_SEND_FAILED' 表示发送失败
   */
  async sendCode(to: string, code: string): Promise<void> {
    const apiKey = Deno.env.get('BREVO_API_KEY') ?? '';
    const from = Deno.env.get('BREVO_FROM_EMAIL') || Deno.env.get('EMAIL_FROM') || '';

    if (!apiKey) {
      throw new Error('DEV_MODE');
    }
    if (!from) {
      throw new Error('EMAIL_SEND_FAILED');
    }

    const senderName = Deno.env.get('BREVO_FROM_NAME') || DEFAULT_FROM_NAME;

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: senderName, email: from },
        to: [{ email: to }],
        subject: SUBJECT,
        htmlContent: buildHtml(code),
      }),
    });

    if (!resp.ok) {
      // 消费掉响应体以便连接可复用；不记录内容，避免泄露任何与密钥相关的信息
      await resp.text().catch(() => '');
      throw new Error('EMAIL_SEND_FAILED');
    }
  }
}

export const brevoAdapter = new BrevoEmailAdapter();
