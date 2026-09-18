import type { DocModel, DocType } from '@/types/doc';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import * as textbookService from './textbookService';

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
  const st = await getRealAppRow(docId);
  if (!st) return null;
  const url = st.doc_json_url;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const model = (await res.json()) as DocModel;
    return {
      ...model,
      version: st.doc_version ?? model.version ?? 1,
    };
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
    // MOCK：本地递增版本号并落库最新 DocModel（DocRunPage「保存新版本」按钮消费）
    const version = await mockStore.saveDocVersion(docId, docJson);
    return { version, docJsonUrl: 'local' };
  }

  // 真实模式：仅作者可保存新版本（防陌生人篡改；作者本人永远能恢复/再编辑）
  const { getSupabase } = await import('./supabaseClient');
  const sb = getSupabase();
  const uid = await getCurrentUserId();
  if (!sb || !uid) throw new Error('请先登录后再保存');
  const app = await getRealAppRow(docId);
  if (!app) throw new Error('文档不存在');
  if (app.author_id !== uid) throw new Error('只有作者才能保存此文档');

  const newVersion = (app.doc_version ?? 0) + 1;
  const path = docStoragePath(docId, newVersion);
  const { error: upErr } = await sb.storage
    .from('docs')
    .upload(path, new Blob([docJson], { type: 'application/json' }), {
      upsert: true,
      contentType: 'application/json',
    });
  if (upErr) throw new Error('保存失败：' + upErr.message);

  const { data: pub } = sb.storage.from('docs').getPublicUrl(path);
  const { error: updErr } = await sb
    .from('apps')
    .update({
      doc_json_url: pub.publicUrl,
      doc_version: newVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', docId);
  if (updErr) throw new Error('更新文档信息失败：' + updErr.message);

  return { version: newVersion, docJsonUrl: pub.publicUrl };
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
 * 沉淀知识点到教材知识库（T07）。
 *
 * 取该文档绑定的教材版本，把「待教师核对」项逐条沉淀为同版本可复用知识；
 * 若无待核对项，则沉淀正文首段作为兜底知识。mock / 真实统一走 `textbookService`。
 *
 * @param docId 文档（应用）UUID。
 * @param model 文档模型（含 verifyHints）。
 * @returns 沉淀的知识点条数。
 */
export async function depositKnowledge(docId: string, model: DocModel): Promise<number> {
  let versionId: string | null = null;
  if (isMockMode()) {
    const app = (await mockStore.load()).apps.find((a) => a.id === docId) ?? null;
    versionId = app?.textbookVersionId ?? null;
  } else {
    const app = await getRealAppRow(docId);
    versionId = app?.textbook_version_id ?? null;
  }
  if (!versionId) return 0;

  const hints = model.verifyHints ?? [];
  if (hints.length === 0) {
    const section = model.meta?.title ?? '全文';
    const content = (model.blocks ?? [])
      .map((b) => b.text ?? '')
      .join('\n')
      .slice(0, 2000);
    await textbookService.depositKnowledge(docId, versionId, section, content);
    return 1;
  }
  for (const h of hints) {
    await textbookService.depositKnowledge(docId, versionId, model.meta?.title ?? '待核对项', h);
  }
  return hints.length;
}

/** 真实模式应用行的原始字段（snake_case，直接对齐数据库列，避免 camel/snake 映射坑）。 */
interface RealAppRow {
  id: string;
  category: string | null;
  doc_type: string | null;
  doc_json_url: string | null;
  doc_version: number | null;
  verify_status: string | null;
  textbook_version_id: string | null;
  title: string | null;
  author_id: string | null;
}

/** 读取真实模式下的应用行（含 doc_json_url / author_id 等）。 */
async function getRealAppRow(docId: string): Promise<RealAppRow | null> {
  try {
    const { getSupabase } = await import('./supabaseClient');
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from('apps')
      .select(
        'id, category, doc_type, doc_json_url, doc_version, verify_status, textbook_version_id, title, author_id',
      )
      .eq('id', docId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as RealAppRow;
  } catch {
    return null;
  }
}

/** 取当前登录用户 id（真实模式）。 */
async function getCurrentUserId(): Promise<string | null> {
  try {
    const { getSupabase } = await import('./supabaseClient');
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 判断当前登录用户是否为该文档作者。
 * - MOCK 模式：恒为 true（本机演示，文档即本人创建）；
 * - 真实模式：比对 apps.author_id 与当前登录用户。
 */
export async function isDocAuthor(docId: string): Promise<boolean> {
  if (isMockMode()) return true;
  const uid = await getCurrentUserId();
  if (!uid) return false;
  const app = await getRealAppRow(docId);
  return app?.author_id === uid;
}

/** 文档结构化 JSON 的 Storage 对象路径（与 Edge 端 docJsonPath 同格式）。 */
function docStoragePath(docId: string, version: number): string {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `d/${yyyy}/${mm}/${docId}/v${version}.json`;
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
