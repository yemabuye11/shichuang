import { getSupabase } from './supabaseClient';
import { isMockMode } from '@/config/env';

/**
 * 埋点服务（P0-G4）。
 *
 * 至少埋：注册数 / 生成次数 / 生成成功率 / 应用发布数 / 应用打开次数 / 分享点击数。
 * 浏览计数走 `navigator.sendBeacon` → `track-view` Edge Function，失败静默。
 */

export type EventName =
  | 'register'
  | 'generate_start'
  | 'generate_success'
  | 'generate_fail'
  | 'publish'
  | 'app_open'
  | 'share_click'
  | 'remix_click';

/** 匿名 ID（未登录时用于去重与漏斗分析，不存任何个人信息）。 */
const ANON_KEY = 'shichuang-anon-id';

/**
 * 获取（并按需生成）匿名 ID。
 *
 * @returns 匿名标识。
 */
export function getAnonId(): string {
  try {
    const existing = localStorage.getItem(ANON_KEY);
    if (existing) return existing;
    const id = `a-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    localStorage.setItem(ANON_KEY, id);
    return id;
  } catch {
    return '';
  }
}

/**
 * 上报一个埋点事件（失败静默，绝不阻断主流程）。
 *
 * @param name 事件名。
 * @param props 附加属性。
 * @param appId 关联应用（可空）。
 */
export function track(name: EventName, props: Record<string, unknown> = {}, appId?: string): void {
  if (isMockMode()) {
    // 演示模式下只在控制台留痕，不写库
    if (import.meta.env.DEV) console.debug('[track]', name, props);
    return;
  }
  const sb = getSupabase();
  if (!sb) return;
  void Promise.resolve(
    sb.rpc('track_event', {
      p_name: name,
      p_props: props as never,
      p_app_id: appId ?? null,
      p_anon_id: getAnonId(),
    }),
  )
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * 上报一次应用打开（浏览计数）。
 *
 * 使用 `sendBeacon` 保证页面关闭时也能送达；失败完全静默。
 *
 * @param appId 应用 UUID。
 */
export function trackView(appId: string): void {
  if (!appId) return;
  if (isMockMode()) return;

  const base = import.meta.env.VITE_SUPABASE_URL ?? '';
  if (!base) return;

  const url = `${base.replace(/\/$/, '')}/functions/v1/track-view`;
  const body = JSON.stringify({ appId });

  try {
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* 静默：埋点失败不影响使用 */
  }
}

/**
 * 上报一次分享点击（复制链接 / 二维码 / 全屏等）。
 *
 * @param appId 应用 UUID。
 * @param channel 分享渠道。
 */
export function trackShare(appId: string, channel: 'copy_link' | 'qrcode' | 'fullscreen' | 'wechat'): void {
  track('share_click', { channel }, appId);
}
