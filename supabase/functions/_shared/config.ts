/**
 * 系统配置读取（内存缓存 60s）。
 *
 * 意义：品牌 / 登录方式 / 积分 / 限额 / 存储 provider 全部走 DB 配置，
 * 改配置无需重新部署 Edge Function。
 */

import { adminClient } from './supabaseAdmin.ts';

export interface Pricing {
  /** 未命中缓存的输入单价（元 / 百万 token）。 */
  input: number;
  /** 命中缓存的输入单价。 */
  cachedInput: number;
  /** 输出单价。 */
  output: number;
  /** 高峰时段倍率。 */
  peakMultiplier: number;
}

export interface SystemConfig {
  brand: Record<string, string>;
  auth: Record<string, unknown>;
  credit: Record<string, number>;
  limit: Record<string, number>;
  artifact: { provider: string; baseUrl: string; warmup: boolean };
  square: Record<string, number | boolean | string>;
}

const CACHE_TTL_MS = 60_000;
let cache: { value: SystemConfig; at: number } | null = null;

function defaults(): SystemConfig {
  return {
    brand: {},
    auth: {},
    credit: { registerGift: 100, publishReward: 2, publishRewardDailyCap: 10, dailyGenerationLimit: 30 },
    limit: {
      monthlySpendCny: 100,
      maxInputTokens: 8000,
      maxOutputTokens: 8000,
      maxHtmlBytes: 204800,
      serveFallbackPerDay: 500,
      squarePageSize: 24,
    },
    artifact: { provider: 'github_pages', baseUrl: '', warmup: true },
    square: { pageSize: 24 },
  };
}

/**
 * 读取全量系统配置（缓存 60s）。
 *
 * @param force 是否强制刷新。
 */
export async function loadConfig(force = false): Promise<SystemConfig> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  try {
    const sb = adminClient();
    const { data, error } = await sb.from('system_config').select('key, value');
    if (error) throw error;

    const map: Record<string, Record<string, unknown>> = {};
    for (const row of data ?? []) {
      map[row.key as string] = (row.value ?? {}) as Record<string, unknown>;
    }

    const value: SystemConfig = {
      brand: (map.brand ?? {}) as Record<string, string>,
      auth: map.auth ?? {},
      credit: (map.credit ?? {}) as Record<string, number>,
      limit: (map.limit ?? {}) as Record<string, number>,
      artifact: {
        provider: String((map.artifact as Record<string, unknown>)?.provider ?? 'github_pages'),
        baseUrl: String((map.artifact as Record<string, unknown>)?.baseUrl ?? ''),
        warmup: (map.artifact as Record<string, unknown>)?.warmup !== false,
      },
      square: (map.square ?? {}) as Record<string, number | boolean | string>,
    };

    cache = { value, at: Date.now() };
    return value;
  } catch (err) {
    console.warn('[config] 读取系统配置失败，使用默认值：', err);
    cache = { value: defaults(), at: Date.now() };
    return cache.value;
  }
}

/**
 * 读取一个数值型限制项。
 *
 * @param key 字段名（位于 `limit` 下）。
 * @param fallback 兜底值。
 */
export async function limitOf(key: keyof SystemConfig['limit'], fallback: number): Promise<number> {
  const cfg = await loadConfig();
  const v = Number(cfg.limit[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 读取模型配置（默认模型优先于 `model_profiles` 的 `is_default`）。
 *
 * @param modelKey 指定模型 key；为空取默认。
 */
export async function loadModel(modelKey?: string): Promise<{
  id: string;
  provider: string;
  modelId: string;
  apiBase: string;
  pricing: Pricing;
  maxOutputTokens: number;
} | null> {
  const sb = adminClient();
  let query = sb.from('model_profiles').select('*').eq('enabled', true);
  query = modelKey ? query.eq('id', modelKey) : query.eq('is_default', true);

  const { data, error } = await query.limit(1).maybeSingle();
  if (error || !data) return null;

  const pricing = (data.pricing ?? {}) as Partial<Pricing>;
  return {
    id: String(data.id),
    provider: String(data.provider),
    modelId: String(data.model_id),
    apiBase: String(data.api_base ?? ''),
    pricing: {
      input: Number(pricing.input ?? 1.5),
      cachedInput: Number(pricing.cachedInput ?? 0.05),
      output: Number(pricing.output ?? 4.5),
      peakMultiplier: Number(pricing.peakMultiplier ?? 1),
    },
    maxOutputTokens: Number(data.max_output_tokens ?? 8000),
  };
}

/**
 * 读取应用类型配置（积分成本 + 模型路由）。
 *
 * @param appType 应用类型。
 */
export async function loadAppType(appType: string): Promise<{
  creditCost: number;
  promptKey: string;
  modelOverride: string | null;
} | null> {
  const sb = adminClient();
  const { data, error } = await sb
    .from('app_type_profiles')
    .select('app_type, credit_cost, prompt_key, model_override')
    .eq('app_type', appType)
    .maybeSingle();
  if (error || !data) return null;
  return {
    creditCost: Number(data.credit_cost ?? 1),
    promptKey: String(data.prompt_key ?? ''),
    modelOverride: data.model_override ? String(data.model_override) : null,
  };
}
