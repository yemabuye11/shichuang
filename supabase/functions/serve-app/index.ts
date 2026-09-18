/**
 * EF-2 `GET /functions/v1/serve-app?id={uuid}` —— 回源兜底。
 *
 * 触发条件（ARCHITECTURE.md §3.4）：
 * - `apps.html_status='pending'` **或** `published_at > now() - 10min`；
 * - **且** 当日全局回源次数 < `limit.serve_fallback_per_day`（默认 500）。
 *
 * 超限 → 429；不满足条件 → 404。
 * 响应头：`Cache-Control: public, max-age=300`、`Content-Security-Policy: sandbox`、
 * `X-Robots-Tag: noindex`（避免回源页被搜索引擎收录，保护 SEO 与出网）。
 */

import { handleCors } from '../_shared/cors.ts';
import { jsonError } from '../_shared/json.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';
import { limitOf } from '../_shared/config.ts';
import { getStore, shadowStore } from '../_shared/store/index.ts';
import { supabaseStorageStore } from '../_shared/store/supabaseStorage.ts';

/** 每日回源计数的存储键（存在 `events` 表里，避免额外建表）。 */
const COUNTER_EVENT = 'serve_fallback';

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'GET') {
    return jsonError(405, { code: 'UNKNOWN', message: '请使用 GET 请求' });
  }

  const url = new URL(req.url);
  const appId = url.searchParams.get('id') ?? '';
  if (!/^[0-9a-fA-F-]{36}$/.test(appId)) {
    return jsonError(404, { code: 'UNKNOWN', message: '应用不存在' });
  }

  const sb = adminClient();

  // ---- 1. 读取应用状态 ----
  const { data: app, error } = await sb
    .from('apps')
    .select('id, category, html_status, html_version, published_at, status')
    .eq('id', appId)
    .maybeSingle();

  if (error || !app) {
    return jsonError(404, { code: 'UNKNOWN', message: '应用不存在' });
  }
  if (app.status === 'taken_down') {
    return jsonError(404, { code: 'UNKNOWN', message: '应用已下架' });
  }

  // ---- 1.1 文档分支（category='doc'）：平台可信内容，不使用 iframe sandbox ----
  if (app.category === 'doc') {
    const version = Number(app.html_version ?? 1);
    let html: string | null = null;

    // 先读影子副本：它是生成成功时立即写入的稳定兜底，不依赖第三方 CDN 配置。
    try {
      html = await shadowStore.getDocHtml(appId, version);
    } catch (err) {
      console.warn('[serve-app] 文档影子副本读取失败：', err);
    }

    // 影子副本尚未写入时再尝试主存储；主存储未配置或临时故障不能让整页 500。
    if (!html) {
      try {
        const store = await getStore();
        html = await store.getDocHtml(appId, version);
      } catch (err) {
        console.warn('[serve-app] 文档主存储读取失败，继续返回友好降级：', err);
      }
    }

    if (!html) {
      return jsonError(404, { code: 'UNKNOWN', message: '文档还在发布中，请稍后刷新' });
    }
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        // ⚠️ 文档内容是平台信任内容（教师自生成），**不**套 sandbox CSP（与应用分支不同）
        'X-Robots-Tag': 'noindex',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // ---- 2. 条件判断：pending 或刚发布 10 分钟内 ----
  const publishedAt = app.published_at ? new Date(app.published_at).getTime() : 0;
  const justPublished = publishedAt > 0 && Date.now() - publishedAt < 10 * 60 * 1000;
  const pending = app.html_status === 'pending';
  if (!pending && !justPublished) {
    return jsonError(404, { code: 'UNKNOWN', message: '内容已发布，请直接访问分享链接' });
  }

  // ---- 3. 每日配额 ----
  const fallbackLimit = await limitOf('serveFallbackPerDay', 500);
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await sb
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('name', COUNTER_EVENT)
    .gte('created_at', `${today}T00:00:00.000Z`);

  if ((count ?? 0) >= fallbackLimit) {
    return new Response('今日回源配额已用尽，请稍后刷新', {
      status: 429,
      headers: { 'Retry-After': '60', 'X-Robots-Tag': 'noindex' },
    });
  }

  // ---- 4. 计数 + 读取影子副本 ----
  void sb
    .from('events')
    .insert({ name: COUNTER_EVENT, app_id: appId, props: { day: today } })
    .then(() => undefined)
    .catch(() => undefined);

  const html = await supabaseStorageStore.getAppHtml(appId, Number(app.html_version ?? 1));
  if (!html) {
    return jsonError(404, { code: 'UNKNOWN', message: '内容还在发布中，请稍后刷新' });
  }

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      // 与前端 iframe sandbox 一致的纵深防御
      'Content-Security-Policy': "sandbox allow-scripts allow-forms allow-popups; default-src 'none'; script-src 'unsafe-inline'",
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
