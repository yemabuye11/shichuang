import { useCallback, useEffect, useRef, useState } from 'react';
import * as creditService from '@/services/creditService';
import { useAuth } from './useAuth';
import type { CreditAccount, LedgerItem } from '@/types/models';

/**
 * 积分状态：余额 + 最近流水。
 *
 * 依赖 `useAuth` 的登录态；未登录时余额为 null。
 */
export function useCredits() {
  const { user, setBalance } = useAuth();
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setAccount(null);
      setLedger([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [acc, items] = await Promise.all([
        creditService.getBalance(),
        creditService.listLedger(0, 30),
      ]);
      if (!mounted.current) return;
      setAccount(acc);
      setLedger(items);
      if (acc) setBalance(acc.balance);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : '读取积分失败');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [user, setBalance]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { account, ledger, loading, error, refresh };
}

export default useCredits;
