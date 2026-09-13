/**
 * EF `POST /functions/v1/request-email-code` —— 请求发送邮箱验证码。
 *
 * 流程：
 * 1. 校验邮箱格式；
 * 2. 限流（单邮箱 1h ≤ 5 次 / 单 IP 1h ≤ 3 次）；
 * 3. 生成 6 位随机验证码，用 SECRET_SALT 做 sha256 哈希后入库（不存明文）；
 * 4. 调用 sendEmail 发送；无邮件服务商密钥时进入 DEV_MODE，原样回显验证码。
 *
 * 约定（与前端工程师对齐）：
 *   - 成功：{ ok: true, sent: true }
 *   - 开发态：{ ok: true, dev: true, devCode: "123456" }
 *   - 限流：429 { code: 'RATE_LIMIT', message: '验证码发送太频繁，请稍后再试' }
 *   - 发送失败：502 { code: 'EMAIL_SEND_FAILED', message: '邮件发送失败，请稍后重试' }
 */

import { handleCors } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/json.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';
import { sendEmail } from '../_shared/email.ts';

/** 邮箱格式校验。 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 计算 sha256 十六进制。 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 取客户端 IP（仅用于限流，不入库）。 */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || '0.0.0.0';
}

/** 生成 6 位随机数字验证码（密码学安全）。 */
function generateCode(): string {
  const buf = new Uint8Array(3);
  crypto.getRandomValues(buf);
  return String((buf[0] * 65536 + buf[1] * 256 + buf[2]) % 1000000).padStart(6, '0');
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonError(405, { code: 'UNKNOWN', message: '请使用 POST 请求' });
  }

  let email = '';
  try {
    const text = await req.text();
    try {
      const body = JSON.parse(text) as { email?: string };
      email = (body.email ?? '').trim();
    } catch {
      email = new URLSearchParams(text).get('email') ?? '';
    }
  } catch {
    return jsonError(400, { code: 'UNKNOWN', message: '请求格式不正确' });
  }

  if (!EMAIL_RE.test(email)) {
    return jsonError(400, { code: 'INVALID_EMAIL', message: '邮箱格式不正确' });
  }
  email = email.toLowerCase();
  const ip = clientIp(req);

  const sb = adminClient();

  // 限流：单邮箱 / 单 IP 近 1 小时内的请求次数
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [byEmail, byIp] = await Promise.all([
    sb.from('email_verifications').select('*', { count: 'exact', head: true })
      .eq('email', email).gt('created_at', since),
    sb.from('email_verifications').select('*', { count: 'exact', head: true })
      .eq('ip', ip).gt('created_at', since),
  ]);

  if ((byEmail.count ?? 0) >= 5 || (byIp.count ?? 0) >= 3) {
    return jsonError(429, { code: 'RATE_LIMIT', message: '验证码发送太频繁，请稍后再试' });
  }

  const code = generateCode();
  const salt = Deno.env.get('SECRET_SALT') ?? 'shichuang-default-salt';
  const code_hash = await sha256Hex(code + '|' + salt);

  const { error: insertError } = await sb.from('email_verifications').insert({
    email,
    code_hash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ip,
  });
  if (insertError) {
    return jsonError(500, { code: 'UNKNOWN', message: '验证码生成失败，请稍后重试' });
  }

  try {
    await sendEmail(email, code);
    return jsonOk({ ok: true, sent: true });
  } catch (e) {
    // 开发态：密钥缺失，echo 验证码让前端/测试走通完整流程
    if (e instanceof Error && e.message === 'DEV_MODE') {
      return jsonOk({ ok: true, dev: true, devCode: code });
    }
    return jsonError(502, { code: 'EMAIL_SEND_FAILED', message: '邮件发送失败，请稍后重试' });
  }
});
