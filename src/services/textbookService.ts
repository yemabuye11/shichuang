import type { TextbookCascadeOptions, TextbookKnowledge, TextbookVersion } from '@/types/doc';
import { isMockMode } from '@/config/env';
import { getSupabase } from './supabaseClient';
import * as mockStore from './mock/mockStore';

/**
 * 教材版本服务（T07 教材版本机制）。
 *
 * - MOCK 模式：读 / 写本地 `mockStore`（IndexedDB 持久化），无需 Supabase；
 * - 真实模式：走 Supabase，受 RLS 约束
 *   （登录教师可读全部版本；仅版本 owner 可增改删；已 verified 的知识全教师可读）。
 *
 * ⚠️ 搜索密钥只在 Edge Secrets，前端绝不持有；本服务只负责版本与知识点的读写。
 */

/** 列出教材版本（供级联选择）。 */
export async function listTextbookVersions(): Promise<TextbookVersion[]> {
  if (isMockMode()) {
    await mockStore.load();
    return mockStore.listTextbookVersions();
  }
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('textbook_versions')
    .select('id, owner_id, year, version, publisher, subject, grade, chapter, upload_url, status, created_at')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToVersion);
}

/** 级联筛选项（各维度去重后的集合，供前端下拉收窄）。 */
export async function getCascadeOptions(): Promise<TextbookCascadeOptions> {
  const versions = await listTextbookVersions();
  return {
    grades: uniq(versions.map((v) => v.grade)),
    subjects: uniq(versions.map((v) => v.subject)),
    publishers: uniq(versions.map((v) => v.publisher)),
    versions: uniq(versions.map((v) => v.version)),
    years: uniq(versions.map((v) => v.year)),
  };
}

/**
 * 新增教材版本（真实模式受 RLS：owner_id 自动取当前登录用户）。
 *
 * @param input 版本维度字段。
 */
export async function addTextbookVersion(input: {
  year: string;
  version: string;
  publisher: string;
  subject: string;
  grade: string;
  chapter?: string | null;
  uploadUrl?: string | null;
}): Promise<TextbookVersion | null> {
  if (isMockMode()) return mockStore.addTextbookVersion(input);
  const sb = getSupabase();
  if (!sb) return null;
  const { data: authData } = await sb.auth.getUser();
  const ownerId = authData.user?.id;
  if (!ownerId) return null;
  const { data, error } = await sb
    .from('textbook_versions')
    .insert({
      owner_id: ownerId,
      year: input.year,
      version: input.version,
      publisher: input.publisher,
      subject: input.subject,
      grade: input.grade,
      chapter: input.chapter ?? null,
      upload_url: input.uploadUrl ?? null,
    })
    .select('id, owner_id, year, version, publisher, subject, grade, chapter, upload_url, status, created_at')
    .single();
  if (error || !data) return null;
  return rowToVersion(data);
}

/**
 * 沉淀教材知识点（教师补写 / 上传电子版）。
 *
 * 真实模式写作 `verified`（教师已核对），受 RLS：仅版本 owner 可写。
 * mock 模式写本地 `mockStore`。
 *
 * @param docId 关联文档 id（仅作埋点，可选）。
 * @param versionId 教材版本 id。
 * @param section 章节 / 小节。
 * @param content 知识点内容。
 */
export async function depositKnowledge(
  docId: string | null,
  versionId: string,
  section: string,
  content: string,
): Promise<TextbookKnowledge | null> {
  void docId;
  if (isMockMode()) {
    return mockStore.depositTextbookKnowledge(versionId, section, content);
  }
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('textbook_knowledge')
    .insert({
      textbook_version_id: versionId,
      section,
      content,
      status: 'verified',
      source: 'teacher',
    })
    .select('id, textbook_version_id, section, content, status, verified_by, source, created_at')
    .single();
  if (error || !data) return null;
  return rowToKnowledge(data);
}

/** DB 行 → 前端 TextbookVersion。 */
function rowToVersion(row: Record<string, unknown>): TextbookVersion {
  return {
    id: String(row.id),
    authorId: String(row.owner_id ?? ''),
    year: String(row.year ?? ''),
    version: String(row.version ?? ''),
    publisher: String(row.publisher ?? ''),
    subject: String(row.subject ?? ''),
    grade: String(row.grade ?? ''),
    chapter: row.chapter == null ? null : String(row.chapter),
    uploadUrl: row.upload_url == null ? null : String(row.upload_url),
    status: row.status === 'verified' ? 'verified' : 'draft',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

/** DB 行 → 前端 TextbookKnowledge。 */
function rowToKnowledge(row: Record<string, unknown>): TextbookKnowledge {
  return {
    id: String(row.id),
    textbookVersionId: String(row.textbook_version_id ?? ''),
    section: String(row.section ?? ''),
    content: String(row.content ?? ''),
    status: row.status === 'verified' ? 'verified' : 'pending',
    verifiedBy: row.verified_by == null ? null : String(row.verified_by),
    source: (row.source as TextbookKnowledge['source']) ?? 'teacher',
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

/** 去重并保持出现顺序。 */
function uniq(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
