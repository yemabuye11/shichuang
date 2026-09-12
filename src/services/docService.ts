import type { DocModel, DocType } from '@/types/doc';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import type { App } from '@/types/models';

/**
 * 文档服务（T06）：加载 / 保存 / 发布 DocModel。
 *
 * - MOCK 模式：DocModel 存于本地 mockStore（IndexedDB 持久化），无需 Supabase；
 * - 真实模式：DocModel JSON 存于 Storage（doc_json_url），由平台 ThreeViewer / 编辑器读取。
 *
 * ⚠️ 真实模式下的「存 Storage」走 `supabaseClient` 的 Storage API（非 Edge Function），
 * 以复用前端的鉴权会话；Edge Function 端的写入只在生成阶段发生（generate/index.ts）。
 */

/**
 * 加载一个文档产物（DocModel）。
 *
 * @param docId 文档（应用）UUID。
 * @returns DocModel；不存在或解析失败时返回 null。
 */
export async function loadDoc(docId: string): Promise<DocModel | null> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const app = st.apps.find((a) => a.id === docId);
    if (!app || app.category !== 'doc' || !app.docJson) return null;
    try {
      return JSON.parse(app.docJson) as DocModel;
    } catch {
      return null;
    }
  }
  const st = await getRealApp(docId);
  if (!st) return null;
  const url = st.docJsonUrl;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as DocModel;
  } catch {
    return null;
  }
}

/**
 * 保存一个新版本（v{n+1}）的 DocModel。
 *
 * @param docId 文档 UUID。
 * @param docJson 新的 DocModel JSON 字符串。
 * @returns 新版本号与 JSON 地址。
 */
export async function saveVersion(
  docId: string,
  docJson: string,
): Promise<{ version: number; docJsonUrl: string }> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const app = st.apps.find((a) => a.id === docId);
    const version = (app?.docVersion ?? 0) + 1;
    // 真实模式才写 Storage；MOCK 仅更新本地 docJson
    return { version, docJsonUrl: 'local' };
  }
  // T08/T07：真实模式此处写 Storage 并 publish；当前先返回占位
  const version = 1;
  return { version, docJsonUrl: '' };
}

/**
 * 渲染并发布文档为 Web 页面（平台壳渲染，非 iframe sandbox）。
 *
 * 真实模式下由 Edge `generate` 完成渲染与发布；前端这里主要用于「二次编辑后重新发布」。
 * T06 暂返回路由占位，详细发布逻辑在 T08 完善。
 *
 * @param docId 文档 UUID。
 * @returns 渲染后的 Web 访问地址。
 */
export async function renderAndPublish(docId: string): Promise<{ renderUrl: string }> {
  return { renderUrl: `/d/${docId}` };
}

/**
 * 沉淀知识点到知识库（T07 能力，本批仅留接口占位）。
 *
 * @param docId 文档 UUID。
 * @param model 文档模型。
 */
export async function depositKnowledge(docId: string, model: DocModel): Promise<void> {
  // T07 实现：把文档结构沉淀到教材/知识点库，供后续教材感知生成复用。
  void docId;
  void model;
}

/** 读取真实模式下的应用行（含 doc_json_url 等）。 */
async function getRealApp(docId: string): Promise<App | null> {
  try {
    const { getSupabase } = await import('./supabaseClient');
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from('apps')
      .select('id, category, doc_type, doc_json_url, doc_version, verify_status, textbook_version_id, title')
      .eq('id', docId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as App;
  } catch {
    return null;
  }
}

/** 判断某类型是否为文档类。 */
export function isDocTypeValue(value: unknown): value is DocType {
  return (
    value === 'lesson_plan' ||
    value === 'ppt' ||
    value === 'courseware_2d' ||
    value === 'courseware_3d' ||
    value === 'office_doc'
  );
}
