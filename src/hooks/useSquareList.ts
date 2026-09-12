import { useCallback, useEffect, useRef, useState } from 'react';
import * as squareService from '@/services/squareService';
import type { SquareQuery, SquareSort } from '@/services/squareService';
import type { SquareItem } from '@/types/models';
import { SQUARE_PAGE_SIZE } from '@/config/creditRules';

/**
 * 应用广场列表 hook：分页 + 加载更多 + 筛选/搜索/排序切换。
 *
 * 未登录可用（P0-A3）。
 */
export function useSquareList(initial: SquareQuery = {}) {
  const [query, setQuery] = useState<SquareQuery>({ limit: SQUARE_PAGE_SIZE, ...initial });
  const [items, setItems] = useState<SquareItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (nextQuery: SquareQuery, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await squareService.list(nextQuery);
      if (!mounted.current) return;
      setItems((prev) => (append ? [...prev, ...page.items] : [...page.items]));
      setTotal(page.total);
      setHasMore(page.hasMore);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (mounted.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    void load({ ...query, offset: 0 }, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.type, query.subject, query.grade, query.sort, query.q, load]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    const nextOffset = items.length;
    setQuery((prev) => ({ ...prev, offset: nextOffset }));
    void load({ ...query, offset: nextOffset }, true);
  }, [hasMore, loadingMore, items.length, query, load]);

  const update = useCallback((patch: Partial<SquareQuery>) => {
    setQuery((prev) => ({ ...prev, ...patch, offset: 0 }));
  }, []);

  const setSort = useCallback((sort: SquareSort) => update({ sort }), [update]);
  const setType = useCallback((type: SquareQuery['type']) => update({ type }), [update]);
  const setKeyword = useCallback((q: string) => update({ q }), [update]);

  const reload = useCallback(() => {
    void load({ ...query, offset: 0 }, false);
  }, [load, query]);

  return {
    items,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    update,
    setSort,
    setType,
    setKeyword,
    reload,
  };
}

export default useSquareList;
