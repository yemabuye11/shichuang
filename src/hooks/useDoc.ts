import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import * as docService from '@/services/docService';
import type { DocModel } from '@/types/doc';

/**
 * 文档读写 hook（T08）。
 *
 * 对 `docService` 的薄封装：
 * - `loadDoc`：加载一份 DocModel（MOCK 读本地 / 真实读 Storage JSON）；
 * - `saveVersion`：把当前编辑结果作为新版本落库（P0-E4 最小实现：保存即新版本、可恢复）；
 * - `publish`：重新渲染并发布为网页版（返回分享链接）。
 *
 * 组件只消费本 hook，不直接接触 mock / 真实分支判断。
 */

type Status = 'loading' | 'ready' | 'notfound';

export interface UseDocResult {
  /** 当前文档模型（编辑中）。 */
  model: DocModel | null;
  /** 设置模型（支持函数式更新，编辑器实时回写）。 */
  setModel: Dispatch<SetStateAction<DocModel | null>>;
  /** 加载状态。 */
  status: Status;
  /** 重新加载。 */
  load: () => Promise<void>;
  /** 保存为新版本，返回版本号与地址。 */
  saveVersion: (model: DocModel) => Promise<{ version: number; docJsonUrl: string }>;
  /** 渲染并发布为网页版，返回分享地址。 */
  publish: () => Promise<{ renderUrl: string }>;
}

/**
 * 加载并管理一份可编辑文档。
 *
 * @param docId 文档（应用）UUID；为空时直接进入 notfound。
 */
export function useDoc(docId: string | undefined): UseDocResult {
  const [model, setModel] = useState<DocModel | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  const load = useCallback(async (): Promise<void> => {
    if (!docId) {
      setStatus('notfound');
      return;
    }
    setStatus('loading');
    try {
      const m = await docService.loadDoc(docId);
      if (m) {
        setModel(m);
        setStatus('ready');
      } else {
        setStatus('notfound');
      }
    } catch {
      setStatus('notfound');
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveVersion = useCallback(
    async (m: DocModel): Promise<{ version: number; docJsonUrl: string }> => {
      if (!docId) throw new Error('缺少文档 id，无法保存版本');
      return docService.saveVersion(docId, JSON.stringify(m));
    },
    [docId],
  );

  const publish = useCallback(async (): Promise<{ renderUrl: string }> => {
    if (!docId) throw new Error('缺少文档 id，无法发布');
    return docService.renderAndPublish(docId);
  }, [docId]);

  return { model, setModel, status, load, saveVersion, publish };
}

export default useDoc;
