/**
 * 匿名 ID（埋点去重用，不存任何个人信息）。
 *
 * 只落在 localStorage，随浏览器清除而失效；服务端另有 `viewer_hash` 做浏览去重，
 * 两者互不依赖（ARCHITECTURE.md §8.7 第 5 条）。
 */

const ANON_KEY = 'shichuang-anon-id';

/**
 * 获取（并按需生成）匿名 ID。
 *
 * @returns 匿名标识；localStorage 不可用时返回空串。
 */
export function getAnonId(): string {
  try {
    const existing = globalThis.localStorage?.getItem(ANON_KEY);
    if (existing) return existing;
    const id = `a-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    globalThis.localStorage?.setItem(ANON_KEY, id);
    return id;
  } catch {
    return '';
  }
}

/** 清除匿名 ID（一般不需要调用，仅供「清除本机数据」场景）。 */
export function resetAnonId(): void {
  try {
    globalThis.localStorage?.removeItem(ANON_KEY);
  } catch {
    /* 忽略 */
  }
}
