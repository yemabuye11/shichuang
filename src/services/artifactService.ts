import { getHtml, putHtml } from '@/utils/idb';
import { getSupabase } from './supabaseClient';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import type { HtmlStatus } from '@/types/enums';

/**
 * 产物服务：IndexedDB 本地副本 + Blob URL + CDN 就绪轮询。
 *
 * 「生成后立即可访问」的第一道保险（ARCHITECTURE.md §2.4）：
 * 1. 本地副本（sha256 匹配）→ Blob URL，**0 延迟渲染**；
 * 2. 无副本 → 用 `html_url`（CDN）；
 * 3. CDN 未就绪 → `serve-app` 回源兜底；
 * 4. 都不可用 → 展示「内容正在发布」提示。
 */

/** 已创建的 Blob URL 缓存（避免重复创建导致内存泄漏）。 */
const blobUrls = new Map<string, string>();

/**
 * 保存应用到本地（IndexedDB）。
 *
 * @param appId 应用 UUID。
 * @param html 完整 HTML。
 * @param sha256 内容摘要（与 `apps.html_sha256` 一致才认为副本有效）。
 * @param version 版本号。
 */
export async function saveLocal(
  appId: string,
  html: string,
  sha256 = '',
  version = 1,
): Promise<void> {
  await putHtml({ appId, html, sha256, version, savedAt: Date.now() });
}

/**
 * 读取本地副本。
 *
 * @param appId 应用 UUID。
 * @param sha256 期望的摘要；为空则不做校验。
 * @returns 本地 HTML；不存在或摘要不匹配时返回 `null`。
 */
export async function getLocal(appId: string, sha256 = ''): Promise<string | null> {
  const rec = await getHtml(appId);
  if (!rec) return null;
  if (sha256 && rec.sha256 && rec.sha256 !== sha256) return null;
  return rec.html;
}

/**
 * 生成本地副本的 Blob URL（同设备 0 延迟渲染）。
 *
 * @param appId 应用 UUID。
 * @param sha256 期望的摘要。
 * @returns Blob URL；无副本时返回 `null`。
 */
export async function getLocalBlobUrl(appId: string, sha256 = ''): Promise<string | null> {
  const cached = blobUrls.get(appId);
  if (cached) return cached;

  const html = await getLocal(appId, sha256);
  if (!html) return null;

  const url = URL.createObjectURL(new Blob([html], { type: 'text/html; charset=utf-8' }));
  blobUrls.set(appId, url);
  return url;
}

/** 释放指定应用的 Blob URL。 */
export function releaseBlobUrl(appId: string): void {
  const url = blobUrls.get(appId);
  if (url) {
    URL.revokeObjectURL(url);
    blobUrls.delete(appId);
  }
}

/** 释放全部 Blob URL（页面卸载时调用）。 */
export function releaseAll(): void {
  for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  blobUrls.clear();
}

/**
 * 解析一个可播放的 URL（本地副本优先）。
 *
 * @param app 应用（至少含 id / htmlUrl / htmlSha256 / htmlStatus）。
 * @returns 可直接作为 iframe src 的 URL；全部不可用时返回 `null`。
 */
export async function resolvePlayableUrl(app: {
  id: string;
  htmlUrl?: string | null;
  htmlSha256?: string | null;
  htmlStatus?: HtmlStatus;
}): Promise<string | null> {
  const local = await getLocalBlobUrl(app.id, app.htmlSha256 ?? '');
  if (local) return local;
  if (app.htmlUrl) return app.htmlUrl;
  return null;
}

/**
 * 回源兜底 URL（CDN 未就绪时使用）。
 *
 * @param appId 应用 UUID。
 * @returns Edge Function 地址。
 */
export function serveAppUrl(appId: string): string | null {
  if (isMockMode()) return null;
  const sb = getSupabase();
  if (!sb) return null;
  const base = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/functions/v1/serve-app?id=${encodeURIComponent(appId)}`;
}

/**
 * 轮询等待产物就绪（GitHub Pages 场景有 10–60s 发布延迟）。
 *
 * @param appId 应用 UUID。
 * @param timeoutMs 最长等待时间，默认 60s。
 * @param intervalMs 轮询间隔，默认 2s。
 * @returns 是否在超时前变为 ready。
 */
export async function waitUntilReady(
  appId: string,
  timeoutMs = 60_000,
  intervalMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await fetchHtmlStatus(appId);
    if (status === 'ready') return true;
    if (status === 'failed') return false;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** 读取单个应用的产物状态。 */
async function fetchHtmlStatus(appId: string): Promise<HtmlStatus | null> {
  if (isMockMode()) {
    const st = await mockStore.load();
    return st.apps.find((a) => a.id === appId)?.htmlStatus ?? null;
  }
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from('apps').select('html_status').eq('id', appId).maybeSingle();
  if (error || !data) return null;
  return data.html_status as HtmlStatus;
}

export interface PlaySource {
  /** 最终可用的播放 URL。 */
  url: string | null;
  /** 来源，用于埋点与降级提示。 */
  from: 'local' | 'cdn' | 'fallback' | 'none';
}

/**
 * 按优先级解析播放源（本地 → CDN → 回源）。
 *
 * @param app 应用信息。
 * @returns 播放源与来源标记。
 */
export async function resolvePlaySource(app: {
  id: string;
  htmlUrl?: string | null;
  htmlSha256?: string | null;
  htmlStatus?: HtmlStatus;
  publishedAt?: string | null;
}): Promise<PlaySource> {
  const local = await getLocalBlobUrl(app.id, app.htmlSha256 ?? '');
  if (local) return { url: local, from: 'local' };

  if (app.htmlUrl) return { url: app.htmlUrl, from: 'cdn' };

  // CDN 尚未就绪：仅在「刚发布 10 分钟内」尝试回源，避免打爆出网
  const justPublished =
    app.publishedAt != null && Date.now() - new Date(app.publishedAt).getTime() < 10 * 60 * 1000;
  if (justPublished || app.htmlStatus === 'pending') {
    const fb = serveAppUrl(app.id);
    if (fb) return { url: fb, from: 'fallback' };
  }

  return { url: null, from: 'none' };
}
