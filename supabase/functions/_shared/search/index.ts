/**
 * 教材检索适配器工厂（T07）。
 *
 * 按 `SEARCH_PROVIDER` 环境变量选择适配器；缺省 tavily。
 * 若对应密钥未配置，返回 `null` —— 调用方据此**优雅跳过**联网检索，
 * 仅用教材元信息作为上下文（本地 mock / 无密钥场景必须能跑通）。
 */

import type { SearchAdapter } from './types.ts';
import { TavilyAdapter } from './tavily.ts';

/**
 * 获取当前启用的检索适配器；无密钥则返回 null（跳过检索）。
 *
 * @returns 适配器实例，或 null（表示本次不联网检索）。
 */
export function getSearchAdapter(): SearchAdapter | null {
  const provider = (Deno.env.get('SEARCH_PROVIDER') ?? 'tavily').toLowerCase();

  switch (provider) {
    case 'tavily': {
      // 提前探测密钥是否存在：缺密钥直接返回 null，避免运行时抛错打断生成
      const key = Deno.env.get('TAVILY_API_KEY') ?? '';
      if (!key) return null;
      return new TavilyAdapter();
    }
    default:
      return null;
  }
}

export type { SearchAdapter, SearchResult, SearchQuery } from './types.ts';
