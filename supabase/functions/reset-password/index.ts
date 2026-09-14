/**
 * EF `POST /functions/v1/reset-password` —— 用邮箱验证码重置密码。
 *
 * 流程（与注册验证码同源，安全由「邮箱持有」保证）：
 * 1. 校验邮箱格式、6 位码、新密码 ≥ 8 位；
 * 2. 服务端用 `SECRET_SALT` 重新算 sha256，比对 `email_verifications` 里该邮箱最新一条记录的 `code_hash`；
 * 3. 比对通过 → 用 service_role 找到该邮箱用户 → `updateUserById` 改密码 → 标记验证码已消费；
 * 4. 返回 { ok: true }。
 *
 * 设计要点：
 * - **服务端独立校验验证码**，不信任前端「已验证」状态（前端只负责收集码与新密码）。
 * - 发码复用 `request-email-code`（同一个表、同一套限流），本函数只做「校验 + 改密」。
 * - 新密码强度在服务端也卡一道（≥8 位），与注册一致。
 */

import { handleCors } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/json.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';

/** 邮箱格式校验。 */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 计算 sha256 十六进制（与 request-email-code 同算法，必须一致）。 */
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
  let newPassword = '';
  try {
    const text = await req.text();
    try {
      const body = JSON.parse(text) as { email?: string; code?: string; newPassword?: string };
      email = (body.email ?? '').trim();
      code = (body.code ?? '').trim();
      newPassword = body.newPassword ?? '';
    } catch {
      const p = new URLSearchParams(text);
      email = (p.get('email') ?? '').trim();
      code = (p.get('code') ?? '').trim();
      newPassword = p.get('newPassword') ?? '';
    }
  } catch {
    return jsonError(400, { code: 'UNKNOWN', message: '请求格式不正确' });
  }

  if (!EMAIL_RE.test(email)) {
    return jsonError(400, { code: 'INVALID_EMAIL', message: '邮箱格式不正确' });
  }
  if (!/^\d{6}$/.test(code)) {
    return jsonError(400, { code: 'INVALID_CODE', message: '请输入 6 位验证码' });
  }
  if (newPassword.length < 8) {
    return jsonError(400, { code: 'WEAK_PASSWORD', message: '新密码至少 8 位' });
  }
  email = email.toLowerCase();

  const sb = adminClient();

  // 该邮箱最新一条验证码记录
  const { data, error } = await sb
    .from('email_verifications')
    .select('*')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    return jsonError(400, { code: 'INVALID_CODE', message: '验证码无效或已过期，请重新获取' });
  }
  const row = data[0];

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return jsonError(400, { code: 'INVALID_CODE', message: '验证码已过期，请重新获取' });
  }

  const salt = Deno.env.get('SECRET_SALT') ?? 'shichuang-default-salt';
  const code_hash = await sha256Hex(code + '|' + salt);
  if (row.code_hash !== code_hash) {
    return jsonError(400, { code: 'INVALID_CODE', message: '验证码错误' });
  }

  // 找到该邮箱用户（service_role 可列举）
  const { data: list, error: listErr } = await sb.auth.admin.listUsers();
  if (listErr || !list?.users) {
    return jsonError(500, { code: 'UNKNOWN', message: '查找用户失败，请稍后重试' });
  }
  const user = list.users.find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    return jsonError(400, { code: 'NO_USER', message: '该邮箱尚未注册' });
  }

  const { error: updErr } = await sb.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updErr) {
    return jsonError(500, { code: 'UPDATE_FAILED', message: '密码修改失败，请稍后重试' });
  }

  // 标记验证码已消费，防重放
  await sb.from('email_verifications').update({ consumed: true }).eq('id', row.id);

  return jsonOk({ ok: true });
});
