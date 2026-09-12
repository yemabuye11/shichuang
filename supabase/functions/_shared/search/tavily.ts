/**
 * Tavily 检索适配器（T07，境外搜索 API 默认实现，ARCHITECTURE.md §C.9 假设）。
 *
 * 密钥只在 Edge Secrets：`TAVILY_API_KEY`（Deno.env.get 读取）。
 * 无密钥 / 网络失败时 `search` 抛错，由工厂或调用方优雅降级
 * （兜底为「仅教材元信息上下文」，本地 mock / 无密钥场景必须能跑通）。
 */

import type { SearchAdapter, SearchQuery, SearchResult } from './types.ts';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/** Tavily 原始返回结构（仅取用字段）。 */
interface TavilyResponse {
  results?: { title?: string; url?: string; content?: string }[];
}

/** Tavily 适配器实现。 */
export class TavilyAdapter implements SearchAdapter {
  readonly name = 'tavily';

  /**
   * 从 Edge Secrets 读取密钥（缺则抛错触发降级）。
   */
  private getApiKey(): string {
    const key = Deno.env.get('TAVILY_API_KEY') ?? '';
    if (!key) throw new Error('TAVILY_API_KEY 未配置');
    return key;
  }

  async search(q: SearchQuery): Promise<SearchResult[]> {
    const key = this.getApiKey();
    const topK = Math.max(1, Math.min(q.topK ?? 5, 10));

    const res = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query: q.query,
        max_results: topK,
        search_depth: 'basic',
        include_answer: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Tavily 检索失败：HTTP ${res.status}`);
    }

    const data = (await res.json()) as TavilyResponse;
    const items = data.results ?? [];
    return items
      .filter((r) => r && (r.content || r.title))
      .map((r) => ({
        title: String(r.title ?? ''),
        url: String(r.url ?? ''),
        snippet: String(r.content ?? '').slice(0, 600),
      }));
  }
}
