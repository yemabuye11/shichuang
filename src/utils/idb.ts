import { openDB, type IDBPDatabase } from 'idb';

/**
 * IndexedDB 封装：缓存刚生成的应用 HTML，实现「0 延迟预览」。
 *
 * 设计要点（ARCHITECTURE.md §2.4）：
 * - `generate` 的 SSE `done` 事件回传完整 HTML → 写入本地 → 用 Blob URL 立即渲染；
 * - 换设备 / CDN 未就绪时从 `html_url` 回源，`serve-app` 兜底；
 * - 单条记录带 `sha256`，与 `apps.html_sha256` 一致才认为副本有效。
 */

const DB_NAME = 'shichuang';
const DB_VERSION = 1;
const STORE_HTML = 'app_html';
const STORE_META = 'app_meta';

export interface LocalHtmlRecord {
  /** 应用 ID（主键）。 */
  appId: string;
  /** 完整 HTML 内容。 */
  html: string;
  /** 内容摘要，用于与服务端一致性校验。 */
  sha256: string;
  /** 版本号，默认 1。 */
  version: number;
  /** 写入时间戳（毫秒）。 */
  savedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * 获取（并按需创建）IndexedDB 连接。
 *
 * 在不支持 IndexedDB 的环境（如部分隐私模式）中返回 `null`，调用方需自行降级。
 */
export function getDb(): Promise<IDBPDatabase> | null {
  if (typeof indexedDB === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_HTML)) {
          db.createObjectStore(STORE_HTML, { keyPath: 'appId' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 保存应用 HTML 到本地。
 *
 * @param record 本地副本记录。
 */
export async function putHtml(record: LocalHtmlRecord): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await (await db).put(STORE_HTML, record);
  } catch (err) {
    // 配额超限时静默失败：本地副本只是加速手段，失败不影响主流程
    console.warn('[idb] 写入应用 HTML 失败，将使用远端 URL 播放', err);
  }
}

/**
 * 读取本地应用 HTML。
 *
 * @param appId 应用 ID。
 * @returns 本地副本；不存在或环境不支持时返回 `null`。
 */
export async function getHtml(appId: string): Promise<LocalHtmlRecord | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rec = (await (await db).get(STORE_HTML, appId)) as LocalHtmlRecord | undefined;
    return rec ?? null;
  } catch {
    return null;
  }
}

/**
 * 删除本地副本。
 *
 * @param appId 应用 ID。
 */
export async function deleteHtml(appId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await (await db).delete(STORE_HTML, appId);
  } catch {
    /* 忽略 */
  }
}

/**
 * 清理超过 `maxAgeMs` 的旧副本，避免 IndexedDB 无限增长。
 *
 * @param maxAgeMs 最大保留时长（毫秒），默认 30 天。
 * @returns 被清理的条数。
 */
export async function pruneHtml(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const store = (await db).transaction(STORE_HTML, 'readwrite').store;
    const all = (await store.getAll()) as LocalHtmlRecord[];
    const now = Date.now();
    let removed = 0;
    for (const rec of all) {
      if (now - rec.savedAt > maxAgeMs) {
        await store.delete(rec.appId);
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * 读取一个通用键值对（MOCK 模式等场景）。
 *
 * @param key 键名。
 */
export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const rec = (await (await db).get(STORE_META, key)) as { key: string; value: T } | undefined;
    return rec ? rec.value : null;
  } catch {
    return null;
  }
}

/**
 * 写入一个通用键值对。
 *
 * @param key 键名。
 * @param value 值。
 */
export async function putMeta<T = unknown>(key: string, value: T): Promise<void> {
  const db = getDb();
  if (!db) return;
  try {
    await (await db).put(STORE_META, { key, value });
  } catch {
    /* 忽略 */
  }
}
