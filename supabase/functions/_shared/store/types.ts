/**
 * 产物存储抽象（ARCHITECTURE.md §2.1）。
 *
 * 运行时由 `system_config.artifact.provider` 决定实现：
 * - `github_pages`：P0 默认，零门槛（无需绑卡/域名），发布延迟 10–60s；
 * - `r2`：Cloudflare R2，写入即读 + 出网免费 + 可设 immutable 缓存（客户办下账号后改一行配置即可）；
 * - `supabase_storage`：仅作**影子副本**，供 `serve-app` 回源兜底。
 *
 * 路径命名：`a/{yyyy}/{mm}/{appId}/v{version}.html`
 */

export interface PutResult {
  /** 对外可访问的完整 URL。 */
  url: string;
  /** 字节数。 */
  sizeBytes: number;
  /** 内容摘要。 */
  sha256: string;
  /** 写入后是否立即可读（GitHub Pages 为 false）。 */
  readyNow: boolean;
}

export interface ArtifactStore {
  readonly name: 'r2' | 'github_pages' | 'supabase_storage';
  /** 写入应用 HTML。 */
  putAppHtml(appId: string, version: number, html: string): Promise<PutResult>;
  /** 回源读取（供 serve-app 兜底）。 */
  getAppHtml(appId: string, version: number): Promise<string | null>;
  /** CDN 预热（HEAD 请求触发回源）。 */
  warmup(url: string): Promise<void>;
  /** 删除产物。 */
  deleteAppHtml(appId: string, version: number): Promise<void>;

  /** 写入文档渲染后的 Web HTML（路径 `d/...`）。 */
  putDocHtml(appId: string, version: number, html: string): Promise<PutResult>;
  /** 读取文档 Web HTML。 */
  getDocHtml(appId: string, version: number): Promise<string | null>;
  /** 写入文档结构化 DocModel JSON（路径 `d/...json`，守 500MB 红线）。 */
  putDocJson(appId: string, version: number, json: string): Promise<PutResult>;
  /** 读取文档 DocModel JSON。 */
  getDocJson(appId: string, version: number): Promise<string | null>;
  /** 删除文档产物。 */
  deleteDoc(appId: string, version: number): Promise<void>;
}

/**
 * 计算产物路径。
 *
 * @param appId 应用 UUID。
 * @param version 版本号（从 1 起，内容不可变）。
 * @param now 时刻（默认当前）。
 * @returns 形如 `a/2026/08/{appId}/v1.html`。
 */
export function objectPath(appId: string, version: number, now: Date = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `a/${yyyy}/${mm}/${appId}/v${version}.html`;
}

/** 影子副本路径（supabase_storage，仅回源用）。 */
export function shadowPath(appId: string, version: number, now: Date = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `apps-html/${yyyy}/${mm}/${appId}/v${version}.html`;
}

/**
 * 文档渲染 HTML 路径（决策 ① B：文档走独立 `/d/` 路径，与 app `/a/` 区分）。
 *
 * @param appId 应用 UUID。
 * @param version 版本号。
 * @param now 时刻。
 * @returns 形如 `d/2026/08/{appId}/v1.html`。
 */
export function docHtmlPath(appId: string, version: number, now: Date = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `d/${yyyy}/${mm}/${appId}/v${version}.html`;
}

/**
 * 文档结构化 DocModel JSON 路径（与渲染 HTML 同前缀，扩展名 .json）。
 *
 * @param appId 应用 UUID。
 * @param version 版本号。
 * @param now 时刻。
 * @returns 形如 `d/2026/08/{appId}/v1.json`。
 */
export function docJsonPath(appId: string, version: number, now: Date = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `d/${yyyy}/${mm}/${appId}/v${version}.json`;
}

/** 计算 SHA-256（十六进制）。 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 字节数（UTF-8）。 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
