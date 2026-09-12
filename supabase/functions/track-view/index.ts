/**
 * EF-3 `POST /functions/v1/track-view` —— 浏览计数（匿名可调）。
 *
 * 流程：
 * 1. 取 `x-forwarded-for` 首段 IP + `user-agent` + appId + `SECRET_SALT` → sha256 → viewer_hash；
 * 2. 调 RPC `record_app_view(app_id, viewer_hash, current_date)`；
 * 3. 幂等靠 `UNIQUE(app_id, viewer_hash, view_date)`，新行才 +1。
 *
 * 隐私：**不存明文 IP / UA**（学生隐私 + 省存储）。
 * 限流：单 IP 每分钟 ≤ 30 次（进程内内存计数 + RPC 兜底）。
 */

import { handleCors } from '../_shared/cors.ts';
import { jsonError, jsonOk } from '../_shared/json.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';

/** 单 IP 每分钟限流阈值。 */
const RATE_LIMIT_PER_MIN = 30;
/** 内存计数：ip → { minute, count }。 */
const rateBucket = new Map<string, { minute: number; count: number }>();

/** 计算 sha256 十六进制。 */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 取客户端 IP（仅用于限流与哈希，不入库）。 */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || '0.0.0.0';
}

/** 内存限流（进程级，足够挡住异常刷量）。 */
function overLimit(ip: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const entry = rateBucket.get(ip);
  if (!entry || entry.minute !== minute) {
    rateBucket.set(ip, { minute, count: 1 });
    // 顺手清理过期桶，避免内存无限增长
    if (rateBucket.size > 5000) {
      for (const [key, value] of rateBucket) {
        if (value.minute !== minute) rateBucket.delete(key);
      }
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_PER_MIN;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonError(405, { code: 'UNKNOWN', message: '请使用 POST 请求' });
  }

  let appId = '';
  try {
    // sendBeacon 可能以 text/plain 发送，故兼容两种解析
    const text = await req.text();
    try {
      const body = JSON.parse(text) as { appId?: string };
      appId = body.appId ?? '';
    } catch {
      appId = new URLSearchParams(text).get('appId') ?? '';
    }
  } catch {
    return jsonError(400, { code: 'UNKNOWN', message: '请求格式不正确' });
  }

  if (!/^[0-9a-fA-F-]{36}$/.test(appId)) {
    return jsonError(400, { code: 'UNKNOWN', message: 'appId 不合法' });
  }

  const ip = clientIp(req);
  if (overLimit(ip)) {
    return new Response(JSON.stringify({ counted: false, viewCount: 0 }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const salt = Deno.env.get('SECRET_SALT') ?? 'shichuang-default-salt';
  const ua = req.headers.get('user-agent') ?? '';
  const viewerHash = await sha256Hex(`${ip}|${ua}|${appId}|${salt}`);

  const sb = adminClient();
  const { data, error } = await sb.rpc('record_app_view', {
    p_app_id: appId,
    p_viewer_hash: viewerHash,
    p_day: new Date().toISOString().slice(0, 10),
  });

  if (error) {
    // 计数失败绝不影响用户使用
    return jsonOk({ counted: false, viewCount: 0 });
  }

  let viewCount = 0;
  if (data === true) {
    const { data: app } = await sb.from('apps').select('view_count').eq('id', appId).maybeSingle();
    viewCount = Number(app?.view_count ?? 0);
  }

  return jsonOk({ counted: data === true, viewCount });
});
