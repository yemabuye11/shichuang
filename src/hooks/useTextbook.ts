import { useCallback, useEffect, useState } from 'react';
import type { TextbookCascadeOptions, TextbookVersion } from '@/types/doc';
import * as textbookService from '@/services/textbookService';

/**
 * 教材版本 hook（T07）。
 *
 * 加载级联筛选项与版本列表（mock / 真实统一），并暴露知识点沉淀方法，
 * 供 `GeneratePage` 的 `TextbookCascade` 与 `DocRunPage` 的教师补写使用。
 */
export function useTextbook(): {
  versions: TextbookVersion[];
  options: TextbookCascadeOptions;
  loading: boolean;
  refresh: () => Promise<void>;
  deposit: (docId: string | null, versionId: string, section: string, content: string) => Promise<unknown>;
} {
  const [versions, setVersions] = useState<TextbookVersion[]>([]);
  const [options, setOptions] = useState<TextbookCascadeOptions>({
    grades: [],
    subjects: [],
    publishers: [],
    versions: [],
    years: [],
  });
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [vs, opts] = await Promise.all([
        textbookService.listTextbookVersions(),
        textbookService.getCascadeOptions(),
      ]);
      setVersions(vs);
      setOptions(opts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deposit = useCallback(
    (docId: string | null, versionId: string, section: string, content: string): Promise<unknown> =>
      textbookService.depositKnowledge(docId, versionId, section, content),
    [],
  );

  return { versions, options, loading, refresh, deposit };
}

export default useTextbook;
