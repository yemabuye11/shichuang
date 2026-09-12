import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import * as authService from '@/services/authService';

import { getPublicConfig, type PublicConfig } from '@/services/systemConfigService';
import { mergeBrand, type BrandConfig } from '@/config/brand';
import type { CreditAccount, CurrentUser } from '@/types/models';

/**
 * 登录态 Context（全站唯一登录真相源）。
 *
 * 页面组件通过 `useAuth()` 读取，**禁止**直接调用 supabaseClient。
 */

interface AuthContextValue {
  /** 当前用户（含资料 + 积分账户 + 会员），未登录为 null。 */
  user: CurrentUser | null;
  /** 积分账户（等价于 `user.account`，便于快速读取）。 */
  account: CreditAccount | null;
  /** 品牌配置（数据库优先）。 */
  brand: BrandConfig;
  /** 公开配置（登录方式开关、积分规则等）。 */
  config: PublicConfig | null;
  /** 是否正在加载。 */
  loading: boolean;
  /** 是否为管理员。 */
  isAdmin: boolean;
  /** 刷新用户信息。 */
  refresh: () => Promise<void>;
  /** 退出登录。 */
  signOut: () => Promise<void>;
  /** 本地更新余额（生成/兑换后即时反映，避免多余请求）。 */
  setBalance: (balance: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** AuthProvider：包裹整个应用（见 `App.tsx`）。 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await getPublicConfig());
    } catch {
      setConfig(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const current = await authService.getCurrentUser();
      setUser(current);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await loadConfig();
      const current = await authService.getCurrentUser().catch(() => null);
      if (!mounted) return;
      setUser(current);
      setLoading(false);
    })();

    const unsubscribe = authService.onAuthStateChange(() => {
      void refresh();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [loadConfig, refresh]);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setUser(null);
  }, []);

  const setBalance = useCallback((balance: number) => {
    setUser((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        account: { ...prev.account, balance },
      };
    });
  }, []);

  const brand = useMemo(() => mergeBrand(config?.brand), [config]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      account: user?.account ?? null,
      brand,
      config,
      loading,
      isAdmin: user?.profile.role === 'admin',
      refresh,
      signOut,
      setBalance,
    }),
    [user, brand, config, loading, refresh, signOut, setBalance],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * 读取登录态。
 *
 * @throws {Error} 在 `AuthProvider` 之外使用时抛出（属于开发期错误）。
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内部使用');
  }
  return ctx;
}

/** 是否「已加载完毕且未登录」（页面据此引导登录）。 */
export function useRequireLogin(): boolean {
  const { user, loading } = useAuth();
  return !loading && user === null;
}

export default useAuth;
