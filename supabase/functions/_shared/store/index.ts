/**
 * ArtifactStore 工厂：运行时由 `system_config.artifact.provider` 选择实现。
 *
 * 切换 provider **无需改代码**：改 DB 配置即可。
 */

import { loadConfig } from '../config.ts';
import { githubPagesStore } from './githubPages.ts';
import { r2Store } from './r2.ts';
import { supabaseStorageStore } from './supabaseStorage.ts';
import type { ArtifactStore } from './types.ts';

/**
 * 获取主存储（写入 + 对外分发）。
 *
 * @returns 主存储实现。
 */
export async function getStore(): Promise<ArtifactStore> {
  const cfg = await loadConfig();
  return getStoreByProvider(cfg.artifact.provider);
}

/**
 * 按 provider 名取存储实现（未知或配置缺失时回落 github_pages）。
 *
 * @param provider provider 名。
 */
export function getStoreByProvider(provider: string): ArtifactStore {
  switch (provider) {
    case 'r2':
      return r2Store;
    case 'supabase_storage':
      return supabaseStorageStore;
    case 'github_pages':
    default:
      return githubPagesStore;
  }
}

/** 影子副本存储（始终用 supabase_storage，用于回源兜底）。 */
export const shadowStore = supabaseStorageStore;

export { githubPagesStore, r2Store, supabaseStorageStore };
export type { ArtifactStore, PutResult } from './types.ts';
