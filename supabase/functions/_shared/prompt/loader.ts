/**
 * 提示词加载器：从 `prompt_templates` 读 active 版本，**内存缓存 60s**。
 *
 * 为什么放 DB（ARCHITECTURE.md §5.4）：提示词是产品成败核心，
 * 需要能**不发版就调优**——改表即可，无需重新部署 Edge Function。
 */

import { adminClient } from '../supabaseAdmin.ts';

/** 缓存有效期 60s。 */
const CACHE_TTL_MS = 60_000;

export interface PromptTemplate {
  kind: string;
  key: string;
  version: number;
  content: string;
}

let cache: { value: Map<string, PromptTemplate>; at: number } | null = null;

/**
 * 加载全部 active 模板。
 *
 * @param force 是否强制刷新。
 * @returns key → 模板 的映射。
 */
export async function loadTemplates(force = false): Promise<Map<string, PromptTemplate>> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const sb = adminClient();
  const { data, error } = await sb
    .from('prompt_templates')
    .select('kind, key, version, content')
    .eq('is_active', true);

  if (error) {
    throw new Error(`读取提示词模板失败：${error.message}`);
  }

  const map = new Map<string, PromptTemplate>();
  for (const row of data ?? []) {
    map.set(String(row.key), {
      kind: String(row.kind),
      key: String(row.key),
      version: Number(row.version ?? 1),
      content: String(row.content ?? ''),
    });
  }

  cache = { value: map, at: Date.now() };
  return map;
}

/**
 * 取一个模板内容。
 *
 * @param key 模板 key。
 * @returns 内容；不存在返回空串。
 */
export async function getTemplate(key: string): Promise<string> {
  const map = await loadTemplates();
  return map.get(key)?.content ?? '';
}

/**
 * 取一批模板的版本号（用于 `prompt_version` 归因）。
 *
 * @param keys 模板 key 列表。
 * @returns 形如 `system_core@7+game@2`。
 */
export async function versionTag(keys: readonly string[]): Promise<string> {
  const map = await loadTemplates();
  return keys
    .map((key) => {
      const tpl = map.get(key);
      if (!tpl) return '';
      const shortKey = key.replace(/^system_section:/, '').replace(/^app_type:/, '');
      return `${shortKey}@${tpl.version}`;
    })
    .filter((s) => s.length > 0)
    .join('+');
}

/** 清空缓存（提示词更新后立即生效）。 */
export function clearCache(): void {
  cache = null;
}

/**
 * 文档类教材感知系统节 key（T07）。
 *
 * `composeDoc` 将其拼进 system 段；该模板缺失时自动跳过，不影响生成。
 * 集中在此避免与 compose.ts 中的字面量散落不一致。
 */
export const TEXTBOOK_AWARE_SECTION = 'system_section:textbook_aware';
