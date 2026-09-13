/**
 * EF `POST /functions/v1/verify-email-code` —— 校验邮箱验证码。
 *
 * 流程：
 * 1. 校验邮箱格式 + 取最近一条未消费且未过期的验证码记录；
 * 2. 用 SECRET_SALT 对传入 code 做 sha256，与库中 code_hash 比对；
 * 3. 匹配 → 标记 consumed + consumed_at，返回 { ok: true, verified: true }；
 *    不匹配 → attempts+1，返回 { code: 'CODE_INVALID' }；
 *    无记录 → 返回 { code: 'CODE_INVALID' | 提示已过期 }。
 *
 * 约定（与前端工程师对齐）：
 *   - 成功：{ ok: true, verified: true }
 *   - 错误：{ code: 'CODE_INVALID' | 'CODE_EXPIRED' | 'RATE_LIMIT' }
 */

import { handleCors } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/json.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';

/** 邮箱格式校验。 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 计算 sha256 十六进制。 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonError(405, { code: 'UNKNOWN', message: '请使用 POST 请求' });
  }

  let email = '';
  let code = '';
  try {
    const text = await req.text();
    try {
      const body = JSON.parse(text) as { email?: string; code?: string };
      email = (body.email ?? '').trim();
      code = (body.code ?? '').trim();
    } catch {
      const params = new URLSearchParams(text);
      email = params.get('email') ?? '';
      code = params.get('code') ?? '';
    }
  } catch {
    return jsonError(400, { code: 'UNKNOWN', message: '请求格式不正确' });
  }

  if (!EMAIL_RE.test(email)) {
    return jsonError(400, { code: 'INVALID_EMAIL', message: '邮箱格式不正确' });
  }
  email = email.toLowerCase();

  const sb = adminClient();

  // 取最近一条未消费且未过期的记录
  const { data, error } = await sb
    .from('email_verifications')
    .select('*')
    .eq('email', email)
    .eq('consumed', false)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return jsonError(400, { code: 'CODE_INVALID', message: '验证码不正确或已过期' });
  }
  const row = data[0] as {
    id: string;
    code_hash: string;
    attempts: number;
  };

  const salt = Deno.env.get('SECRET_SALT') ?? 'shichuang-default-salt';
  const code_hash = await sha256Hex(code + '|' + salt);

  if (code_hash !== row.code_hash) {
    await sb.from('email_verifications')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id);
    return jsonError(400, { code: 'CODE_INVALID', message: '验证码不正确' });
  }

  // 校验通过：标记消费（触发器据此放行注册）
  const { error: updErr } = await sb.from('email_verifications')
    .update({ consumed: true, consumed_at: new Date().toISOString() })
    .eq('id', row.id);
  if (updErr) {
    return jsonError(500, { code: 'UNKNOWN', message: '验证码核销失败，请重试' });
  }

  return jsonOk({ ok: true, verified: true });
});
