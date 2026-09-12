/**
 * 全屏工具（「投屏上课」按钮）。
 *
 * 兼容标准 Fullscreen API 与 iOS Safari 的 `webkit` 前缀；
 * 不支持时返回 `false`，由调用方提示「请手动全屏」。
 */

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/**
 * 请求进入全屏。
 *
 * @param el 目标元素；缺省用 `<html>`（整页全屏）。
 * @returns 是否成功进入全屏。
 */
export async function requestFullscreen(el?: HTMLElement | null): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const target = (el ?? document.documentElement) as FsElement;

  try {
    if (typeof target.requestFullscreen === 'function') {
      await target.requestFullscreen();
      return true;
    }
    if (typeof target.webkitRequestFullscreen === 'function') {
      await target.webkitRequestFullscreen();
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 退出全屏。 */
export function exitFullscreen(): void {
  if (typeof document === 'undefined') return;
  const doc = document as FsDocument;
  try {
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') {
      void doc.exitFullscreen();
      return;
    }
    if (doc.webkitFullscreenElement && typeof doc.webkitExitFullscreen === 'function') {
      void doc.webkitExitFullscreen();
    }
  } catch {
    /* 忽略：部分浏览器在无用户手势时抛错 */
  }
}

/** 当前是否处于全屏。 */
export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FsDocument;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null);
}

/**
 * 订阅全屏状态变化。
 *
 * @param cb 变化回调。
 * @returns 取消订阅函数。
 */
export function onFullscreenChange(cb: (active: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const handler = (): void => cb(isFullscreen());
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}

/** 当前浏览器是否支持全屏 API。 */
export function supportsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as FsElement;
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
}
