/**
 * _shared/email.ts —— 阿里云邮件推送（DirectMail）单发邮件封装。
 *
 * 仅用于 Edge Function 服务端发送「邮箱验证码」。
 *
 * 重要说明（部署者必读）：
 *   - 本文件无法在此环境验证（没有阿里云 AK/SK）。真实发送需要：
 *       ① 在阿里云「邮件推送」控制台验证一个发信域名/地址（ALIYUN_DM_FROM）；
 *       ② 在 Supabase 配置 3 个 Secret：
 *            ALIYUN_DM_ACCESS_KEY_ID
 *            ALIYUN_DM_ACCESS_KEY_SECRET
 *            ALIYUN_DM_FROM（如 noreply@yourdomain.com）
 *   - 若上述 AK/SK 任一缺失，sendEmail 会 throw new Error('DEV_MODE')，
 *     调用方据此在响应里原样回显验证码（devCode），保证无真实邮件服务商时
 *     整条注册流程仍可被验证。这是符合预期的开发态行为。
 */

/** 邮件主题（中文需 UTF-8 百分号编码，由 percentEncode 处理）。 */
const SUBJECT = '【师创】邮箱验证码';

/**
 * 发送验证码邮件。
 * @param to   收件邮箱（调用方已 lower() 处理）
 * @param code 6 位验证码明文
 * @throws {Error} 消息为 'DEV_MODE' 表示缺少密钥（开发态回显）；否则为发送失败
 */
export async function sendEmail(to: string, code: string): Promise<void> {
  const akId = Deno.env.get('ALIYUN_DM_ACCESS_KEY_ID');
  const akSecret = Deno.env.get('ALIYUN_DM_ACCESS_KEY_SECRET');
  const from = Deno.env.get('ALIYUN_DM_FROM');
  const region = Deno.env.get('ALIYUN_DM_REGION') || 'cn-hangzhou';

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

/** 构造验证码 HTML 邮件正文。 */
function buildHtml(code: string): string {
  return (
    '<!DOCTYPE html>' +
    '<html lang="zh-CN"><body>' +
    `<p>您好，您正在注册「师创」教师 AI 平台。</p>` +
    `<p>您的邮箱验证码为：<strong style="font-size:24px;letter-spacing:2px">${code}</strong></p>` +
    '<p>该验证码 10 分钟内有效，请勿泄露给他人。如非本人操作，请忽略本邮件。</p>' +
    '</body></html>'
  );
}

/**
 * RFC 3986 百分号编码（UTF-8 字节级）。
 * 不编码：A-Z a-z 0-9 - _ . ~ ；其余按 UTF-8 字节编码为 %XY（大写）。
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

/** 阿里云要求的 GMT ISO8601 时间戳：YYYY-MM-DDTHH:mm:ssZ（不带毫秒）。 */
function iso8601GMT(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** HMAC-SHA1 十六进制签名。 */
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
