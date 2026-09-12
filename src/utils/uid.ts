/**
 * 轻量唯一 id 生成器（T08 编辑器内部使用）。
 *
 * TipTap / 幻灯片编辑器在「块」与「幻灯片」需要稳定 id 时使用。
 * 优先用 Web Crypto 的 `randomUUID`，退化到时间戳 + 随机数，保证离线可用。
 *
 * @param prefix id 前缀（便于调试区分块 / 幻灯片）。
 * @returns 全局唯一字符串。
 */
export function uid(prefix = 'id'): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') {
    return `${prefix}-${c.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
