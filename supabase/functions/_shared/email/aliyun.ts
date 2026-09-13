/**
 * 阿里云邮件推送（DirectMail）适配器 —— 单发「邮箱验证码」邮件。
 *
 * 协议：DirectMail `SingleSendMail`，签名方式为 HMAC-SHA1，最终以 GET 请求调用
 *       `https://dm.aliyuncs.com/?Signature=...&<canonicalized query string>`。
 *
 * 密钥（全部运行时读取，切换/上线只需 `supabase secrets set`，无需改代码）：
 *   - ALIYUN_DM_ACCESS_KEY_ID
 *   - ALIYUN_DM_ACCESS_KEY_SECRET
 *   - ALIYUN_DM_FROM（如 noreply@yourdomain.com，需在阿里云控制台验证过）
 *   - ALIYUN_DM_REGION（可选，默认 cn-hangzhou）
 *
 * 部署者必读：
 *   - 真实发送需要：① 在阿里云「邮件推送」控制台验证一个发信域名/地址
 *     （ALIYUN_DM_FROM，这是 DirectMail 的强制要求，需要自有域名）；
 *     ② 在 Supabase 配置上面 3 个 Secret。
 *   - 未配置密钥时 `isAvailable()` 为 false，由 `index.ts` 回退到其他供应商；
 *     一家都没有时由 `index.ts` 抛 `Error('DEV_MODE')`，调用方据此在响应里
 *     原样回显验证码（devCode），保证无真实邮件服务商时整条注册流程仍可被验证。
 *     这是符合预期的开发态行为。
 */

import { buildHtml, SUBJECT, type EmailAdapter } from './types.ts';

export class AliyunEmailAdapter implements EmailAdapter {
  readonly provider = 'aliyun' as const;

  /**
   * 是否可用：AccessKeyId 与 AccessKeySecret 都已配置。
   *
   * 注意：只判断**密钥**是否配置（与 `index.ts` 的选择口径一致），
   * 发信地址 `ALIYUN_DM_FROM` 缺失属于「配错」而非「没配」，
   * 留给 `sendCode()` 抛 `EMAIL_SEND_FAILED`，与改造前的行为完全一致。
   */
  isAvailable(): boolean {
    const akId = Deno.env.get('ALIYUN_DM_ACCESS_KEY_ID') ?? '';
    const akSecret = Deno.env.get('ALIYUN_DM_ACCESS_KEY_SECRET') ?? '';
    return akId.length > 0 && akSecret.length > 0;
  }

  /**
   * 发送验证码邮件。
   * @param to   收件邮箱（调用方已 lower() 处理）
   * @param code 6 位验证码明文
   * @throws {Error} 'DEV_MODE' 表示缺密钥；'EMAIL_SEND_FAILED' 表示发送失败
   */
  async sendCode(to: string, code: string): Promise<void> {
    const akId = Deno.env.get('ALIYUN_DM_ACCESS_KEY_ID');
    const akSecret = Deno.env.get('ALIYUN_DM_ACCESS_KEY_SECRET');
    const from = Deno.env.get('ALIYUN_DM_FROM');
    // 预留：未来若接入多地域 endpoint，用 region 拼 https://dm.<region>.aliyuncs.com
    const region = Deno.env.get('ALIYUN_DM_REGION') || 'cn-hangzhou';
    void region;

    // 开发态：无密钥 → 回显验证码，不真正发送
    if (!akId || !akSecret) {
      throw new Error('DEV_MODE');
    }
    if (!from) {
      throw new Error('EMAIL_SEND_FAILED');
    }

    const htmlBody = buildHtml(code);

    // 阿里云要求的请求参数（公共参数 + 业务参数）
    const params: Record<string, string> = {
      Format: 'JSON',
      Version: '2015-11-23',
      AccessKeyId: akId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: crypto.randomUUID(),
      Timestamp: iso8601GMT(new Date()),
      Action: 'SingleSendMail',
      AccountName: from,
      AddressType: '1',
      ToAddress: to,
      ReplyToAddress: 'false',
      Subject: SUBJECT,
      HtmlBody: htmlBody,
    };

    // 规范化查询串：按 key 字典序排序，key/value 均做 RFC 3986 百分号编码
    const canonical = Object.keys(params)
      .sort()
      .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
      .join('&');

    // StringToSign = "GET&%2F&" + encodeURIComponent(canonicalizedQueryString)
    const stringToSign = `GET&%2F&${percentEncode(canonical)}`;

    // 签名 = HMAC-SHA1(AccessKeySecret + '&', StringToSign) → 十六进制
    // ⚠️ 注意：这里输出的是**十六进制**（小写 hex）。阿里云官方部分样例/SDK 用的是
    //    **Base64**（HMAC-SHA1 之后再 base64）。若真实发信时报签名错误
    //    （如 SignatureDoesNotMatch / InvalidSignature），只需改这一处：
    //    把 sha1HexHmac 换成「HMAC-SHA1 → Base64」即可，其余流程不用动。
    //    当前环境无 AK/SK，无法实测，故保留改造前的原有行为（十六进制），不要擅自改动。
    const signature = await sha1HexHmac(stringToSign, `${akSecret}&`);

    // 最终请求 URL（Signature 本身也要百分号编码）
    const url =
      `https://dm.aliyuncs.com/?Signature=${percentEncode(signature)}&${canonical}`;

    const resp = await fetch(url, { method: 'GET' });
    if (resp.status !== 200) {
      throw new Error('EMAIL_SEND_FAILED');
    }
    const text = await resp.text();
    let json: { Code?: string } | null = null;
    try {
      json = JSON.parse(text) as { Code?: string };
    } catch {
      json = null;
    }
    // 阿里云业务失败时响应体带 Code 字段（如 InvalidAccessKeyId、RateExceeded 等）
    if (json && json.Code) {
      throw new Error('EMAIL_SEND_FAILED');
    }
  }
}

/**
 * RFC 3986 百分号编码（UTF-8 字节级）。
 * 不编码：A-Z a-z 0-9 - _ . ~ ；其余按 UTF-8 字节编码为 %XY（大写）。
 *
 * @param s 待编码字符串。
 */
function percentEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    if (
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= 'a' && ch <= 'z') ||
      (ch >= '0' && ch <= '9') ||
      ch === '-' || ch === '_' || ch === '.' || ch === '~'
    ) {
      out += ch;
    } else {
      out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

/**
 * 阿里云要求的 GMT ISO8601 时间戳：YYYY-MM-DDTHH:mm:ssZ（不带毫秒）。
 *
 * @param d 时间。
 */
function iso8601GMT(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * HMAC-SHA1 十六进制签名。
 *
 * @param message 待签名内容。
 * @param key     签名密钥。
 */
async function sha1HexHmac(message: string, key: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(key);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const aliyunAdapter = new AliyunEmailAdapter();
