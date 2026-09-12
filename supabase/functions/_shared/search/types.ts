/**
 * 教材联网检索适配器契约（T07）。
 *
 * 安全红线（ARCHITECTURE.md §C.8 阻塞③）：搜索密钥**只在 Edge Secrets**，
 * 通过 `Deno.env.get` 读取，绝不下发前端。适配器仅在 Edge Function 进程内实例化。
 */

/** 单条检索结果片段。 */
export interface SearchResult {
  /** 来源标题。 */
  title: string;
  /** 来源 URL。 */
  url: string;
  /** 正文摘要（注入提示词用）。 */
  snippet: string;
}

/** 检索查询参数。 */
export interface SearchQuery {
  /** 拼接后的检索式（含教材版本 + 章节等）。 */
  query: string;
  /** 期望返回条数（默认 5）。 */
  topK?: number;
}

/**
 * 教材检索适配器接口。
 *
 * 不同检索源（Tavily / 其它合规源）实现同一接口，由工厂按 env 选择，
 * 国内迁移时替换实现即可（ARCHITECTURE.md 🟡 Q-国内）。
 */
export interface SearchAdapter {
  /** 适配器名称（用于记账 `model` 字段，如 'tavily'）。 */
  readonly name: string;
  /**
   * 执行一次检索。
   *
   * @param q 查询参数。
   * @returns 检索片段；无结果返回空数组（不抛错）。
   * @throws 仅当「密钥缺失 / 网络失败」且需上游兜底时抛出，调用方 catch 后降级。
   */
  search(q: SearchQuery): Promise<SearchResult[]>;
}
