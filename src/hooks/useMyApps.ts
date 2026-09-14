import { useCallback, useEffect, useRef, useState } from 'react';
import * as appService from '@/services/appService';
import type { MyAppsFilter } from '@/services/appService';
import type { App } from '@/types/models';
import { useAuth } from './useAuth';

/**
 * 我的应用列表 hook。
 *
 * @param filter 全部 / 已发布 / 未发布。
 */
export function useMyApps(filter: MyAppsFilter = 'all') {
  const { user } = useAuth();
  // 依赖稳定的用户 id 而非 user 对象：user 引用每次 auth 刷新都会变，
  // 若直接依赖 user 会导致列表在 token 静默刷新时反复重拉、界面闪烁。
  const uid = user?.profile.id ?? null;
  const [items, setItems] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await appService.listMine(filter);
      if (!mounted.current) return;
      setItems(list);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [uid, filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, error, refresh };
}

export default useMyApps;
