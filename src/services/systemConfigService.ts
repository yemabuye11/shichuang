import { getSupabase } from './supabaseClient';
import { mergeBrand, type BrandConfig } from '@/config/brand';
import type { Json } from '@/types/database';
import { APP_TYPES } from '@/config/constants';
import { REGISTER_GIFT, SQUARE_PAGE_SIZE, DAILY_GENERATION_LIMIT } from '@/config/creditRules';
import { AppError } from './http/errors';
import { isMockMode } from '@/config/env';

/**
 * 系统配置服务：`get_public_config()` 的白名单读取 + 内存缓存。
 *
 * 意义（ARCHITECTURE.md §3.6 Q1）：品牌名/登录方式/积分说明等
 * 运行时由数据库下发，**改配置不改代码、不重新发版**。
 */

export interface PublicAppType {
  key: string;
  label: string;
  creditCost: number;
  enabled: boolean;
  sortOrder: number;
}

export interface PublicConfig {
  brand: Partial<BrandConfig>;
  auth: {
    providers: string[];
    requireEmailConfirm: boolean;
  };
  credit: {
    registerGift: number;
    publishReward: number;
    dailyGenerationLimit: number;
  };
  square: {
    pageSize: number;
    publicBrowsable: boolean;
  };
  appTypes: PublicAppType[];
}

/** 缓存有效期：60s（与 Edge Function 端的提示词缓存口径一致）。 */
const CACHE_TTL_MS = 60_000;

let cache: { value: PublicConfig; at: number } | null = null;

/** 配置缺失时的兜底值（保证未配置后端也能渲染 UI）。 */
function fallbackConfig(): PublicConfig {
  return {
    brand: {},
    auth: { providers: ['password'], requireEmailConfirm: false },
    credit: { registerGift: REGISTER_GIFT, publishReward: 2, dailyGenerationLimit: DAILY_GENERATION_LIMIT },
    square: { pageSize: SQUARE_PAGE_SIZE, publicBrowsable: true },
    appTypes: APP_TYPES.map((t) => ({
      key: t.key,
      label: t.label,
      creditCost: t.creditCost,
      enabled: true,
      sortOrder: t.sortOrder,
    })),
  };
}

/**
 * 读取公开配置（未登录可调用）。
 *
 * @param force 是否忽略缓存强制刷新。
 */
export async function getPublicConfig(force = false): Promise<PublicConfig> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const sb = getSupabase();
  if (!sb || isMockMode()) {
    cache = { value: fallbackConfig(), at: Date.now() };
    return cache.value;
  }

  const { data, error } = await sb.rpc('get_public_config');
  if (error) {
    // 配置读取失败不应阻断页面：回落本地常量
    console.warn('[systemConfig] 读取公开配置失败，使用本地默认值', error.message);
    cache = { value: fallbackConfig(), at: Date.now() };
    return cache.value;
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  const brand = (raw.brand ?? {}) as Record<string, unknown>;
  const auth = (raw.auth ?? {}) as Record<string, unknown>;
  const credit = (raw.credit ?? {}) as Record<string, unknown>;
  const square = (raw.square ?? {}) as Record<string, unknown>;

  const value: PublicConfig = {
    brand: {
      name: typeof brand.name === 'string' ? brand.name : undefined,
      shortName: typeof brand.shortName === 'string' ? brand.shortName : undefined,
      slogan: typeof brand.slogan === 'string' ? brand.slogan : undefined,
      subSlogan: typeof brand.subSlogan === 'string' ? brand.subSlogan : undefined,
      logoUrl: typeof brand.logoUrl === 'string' ? brand.logoUrl : undefined,
      domain: typeof brand.domain === 'string' ? brand.domain : undefined,
    },
    auth: {
      providers: Array.isArray(auth.providers) ? (auth.providers as string[]) : ['password'],
      requireEmailConfirm: auth.requireEmailConfirm === true,
    },
    credit: {
      registerGift: Number(credit.registerGift ?? REGISTER_GIFT),
      publishReward: Number(credit.publishReward ?? 2),
      dailyGenerationLimit: Number(credit.dailyGenerationLimit ?? DAILY_GENERATION_LIMIT),
    },
    square: {
      pageSize: Number(square.pageSize ?? SQUARE_PAGE_SIZE),
      publicBrowsable: square.publicBrowsable !== false,
    },
    appTypes: Array.isArray(raw.appTypes)
      ? (raw.appTypes as PublicAppType[])
      : fallbackConfig().appTypes,
  };

  cache = { value, at: Date.now() };
  return value;
}

/**
 * 获取合并后的品牌配置（数据库优先，环境变量兜底）。
 *
 * @returns 可直接用于渲染的品牌配置。
 */
export async function getBrand(): Promise<BrandConfig> {
  const cfg = await getPublicConfig();
  return mergeBrand(cfg.brand);
}

/**
 * 获取某个应用类型的积分成本（服务端配置优先）。
 *
 * @param appType 应用类型。
 */
export async function getCreditCost(appType: string): Promise<number> {
  const cfg = await getPublicConfig();
  const found = cfg.appTypes.find((t) => t.key === appType);
  return found?.creditCost ?? APP_TYPES.find((t) => t.key === appType)?.creditCost ?? 1;
}

/**
 * 管理员：更新一条系统配置。
 *
 * @param key 配置键。
 * @param value 配置值。
 */
export async function updateSystemConfig(key: string, value: Json): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb
    .from('system_config')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key);
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  cache = null;
}
