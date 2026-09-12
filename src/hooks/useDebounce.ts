import { useEffect, useState } from 'react';

/**
 * 防抖：把高频变化的值延迟到稳定后再输出。
 *
 * 典型场景：广场搜索框（300ms）。
 *
 * @param value 原始值。
 * @param delayMs 延迟毫秒数，默认 300。
 * @returns 稳定后的值。
 */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

export default useDebounce;
