/**
 * 全站唯一品牌来源。
 *
 * 约定（ARCHITECTURE.md §8.5 红线）：
 * - 任何组件 / 页面 / 服务都不得硬编码产品名，必须从这里读取；
 * - 运行时若 `get_public_config()` 返回了 `brand.*` 配置，以数据库配置优先
 *   （见 `src/services/systemConfigService.ts`），从而实现「改名字不发版」。
 */

/** 构建期默认值（客户已拍板：师创）。 */
const FALLBACK = {
  name: '师创',
  shortName: '师创',
  slogan: '一句话，做出你的教学应用',
  subSlogan: '不用写代码，生成后一个链接就能发给学生',
  logoUrl: '/icons/icon.svg',
  domain: '',
} as const;

export interface BrandConfig {
  /** 产品全称，如「师创」。 */
  readonly name: string;
  /** 短名（PWA manifest / 底栏等窄空间）。 */
  readonly shortName: string;
  /** 主标语。 */
  readonly slogan: string;
  /** 副标语。 */
  readonly subSlogan: string;
  /** Logo 地址。 */
  readonly logoUrl: string;
  /** 对外域名（可为空，表示尚未购买/绑定）。 */
  readonly domain: string;
}

/** 由环境变量构建的品牌配置（缺省回落到内置默认值）。 */
export const BRAND: BrandConfig = {
  name: (import.meta.env.VITE_BRAND_NAME as string | undefined)?.trim() || FALLBACK.name,
  shortName: (import.meta.env.VITE_BRAND_NAME as string | undefined)?.trim() || FALLBACK.shortName,
  slogan: (import.meta.env.VITE_BRAND_SLOGAN as string | undefined)?.trim() || FALLBACK.slogan,
  subSlogan: FALLBACK.subSlogan,
  logoUrl: (import.meta.env.VITE_BRAND_LOGO as string | undefined)?.trim() || FALLBACK.logoUrl,
  domain: (import.meta.env.VITE_PUBLIC_DOMAIN as string | undefined)?.trim() || FALLBACK.domain,
};

/**
 * 用数据库下发的运行时品牌配置覆盖构建期默认值。
 *
 * 只覆盖「非空」字段，避免后台清掉某项后前端出现空字符串。
 *
 * @param partial 运行时下发的部分品牌字段。
 * @returns 合并后的新品牌配置（不修改原对象）。
 */
export function mergeBrand(partial: Partial<BrandConfig> | null | undefined): BrandConfig {
  if (!partial) return BRAND;
  const next: BrandConfig = { ...BRAND };
  const writable = next as unknown as Record<string, string>;
  for (const key of Object.keys(partial) as (keyof BrandConfig)[]) {
    const value = partial[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      writable[key] = value.trim();
    }
  }
  return next;
}

/** 便于在模板字符串中引用的品牌名（等价于 `BRAND.name`）。 */
export const BRAND_NAME = BRAND.name;
