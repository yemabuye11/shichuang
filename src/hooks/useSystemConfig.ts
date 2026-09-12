import { useCallback, useEffect, useRef, useState } from 'react';
import { getPublicConfig, type PublicConfig } from '@/services/systemConfigService';
import { mergeBrand, type BrandConfig } from '@/config/brand';

/**
 * 系统配置 hook：公开配置 + 品牌。
 *
 * 配置在 `AuthProvider` 里已加载一次，这里提供「独立使用 + 强制刷新」的能力，
 * 供未登录页面（首页 / 广场）单独使用。
 */
export function useSystemConfig() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const cfg = await getPublicConfig();
        if (mounted.current) setConfig(cfg);
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (force = true) => {
    const cfg = await getPublicConfig(force);
    if (mounted.current) setConfig(cfg);
  }, []);

  const brand: BrandConfig = mergeBrand(config?.brand);

  return { config, brand, loading, refresh };
}

export default useSystemConfig;
