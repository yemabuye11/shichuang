import type {
  KnowledgeSource,
  TextbookCascadeOptions,
  TextbookKnowledge,
  TextbookVersion,
} from '@/types/doc';
import { isMockMode } from '@/config/env';
import { getSupabase } from './supabaseClient';
import * as mockStore from './mock/mockStore';
import { AppError } from './http/errors';

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

export interface CreateTextbookVersionInput {
  year: string;
  version: string;
  publisher: string;
  subject: string;
  grade: string;
  chapter?: string | null;
  file?: File | null;
}

/**
 * 创建教材版本，并可同时上传电子教材。
 *
 * 文本类文件会先作为 pending 知识点保存，供后续解析/审核；PDF、DOCX 等
 * 文件先安全存入 Storage，不能被误标为已验证知识。
 */
export async function createTextbookVersion(input: CreateTextbookVersionInput): Promise<TextbookVersion> {
  const metadata = {
    year: input.year.trim(),
    version: input.version.trim(),
    publisher: input.publisher.trim(),
    subject: input.subject.trim(),
    grade: input.grade.trim(),
    chapter: input.chapter?.trim() || null,
  };
  if (Object.values(metadata).some((value) => typeof value === 'string' && value.length === 0)) {
    throw new AppError('VALIDATE_FAILED', '请把年份、年级、学科、出版社和版本填写完整');
  }
  validateTextbookFile(input.file);

  if (isMockMode()) {
    const version = mockStore.addTextbookVersion(metadata);
    const content = await readTextFile(input.file);
    if (content) {
      mockStore.depositTextbookKnowledge(version.id, metadata.chapter || '上传教材内容', content, 'upload', 'pending');
    }
    return version;
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务，暂时无法上传教材');
  const { data: authData } = await sb.auth.getUser();
  const ownerId = authData.user?.id;
  if (!ownerId) throw new AppError('UNAUTHORIZED', '登录状态已失效，请重新登录');

  let uploadPath: string | null = null;
  if (input.file) {
    const safeName = sanitizeFileName(input.file.name);
    uploadPath = `tb/${ownerId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await sb.storage.from('textbooks').upload(uploadPath, input.file, {
      cacheControl: '3600',
      contentType: input.file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw new AppError('STORE_FAILED', `教材文件上传失败：${error.message}`, error);
  }

  const { data, error } = await sb
    .from('textbook_versions')
    .insert({
      owner_id: ownerId,
      ...metadata,
      upload_url: uploadPath,
      status: 'draft',
    })
    .select('id, owner_id, year, version, publisher, subject, grade, chapter, upload_url, status, created_at')
    .single();
  if (error || !data) {
    if (uploadPath) void sb.storage.from('textbooks').remove([uploadPath]);
    throw new AppError('STORE_FAILED', `教材版本创建失败：${error?.message ?? '没有返回数据'}`, error);
  }

  const version = rowToVersion(data);
  const content = await readTextFile(input.file);
  if (content) {
    const { error: knowledgeError } = await sb.from('textbook_knowledge').insert({
      textbook_version_id: version.id,
      section: metadata.chapter || '上传教材内容',
      content,
      status: 'pending',
      verified_by: null,
      source: 'upload',
    });
    if (knowledgeError) {
      // 版本和文件仍然保留，教师可以稍后重试解析/补写；不伪造 verified 状态。
      console.warn('[textbook] 上传文本未能建立待核对知识：', knowledgeError.message);
    }
  }
  return version;
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
  source: KnowledgeSource = 'teacher',
): Promise<TextbookKnowledge | null> {
  void docId;
  if (isMockMode()) {
    return mockStore.depositTextbookKnowledge(versionId, section, content, source, source === 'upload' ? 'pending' : 'verified');
  }
  const sb = getSupabase();
  if (!sb) return null;
  const { data: authData } = await sb.auth.getUser();
  const ownerId = authData.user?.id ?? null;
  if (!ownerId) throw new AppError('UNAUTHORIZED', '登录状态已失效，请重新登录');
  const { data, error } = await sb
    .from('textbook_knowledge')
    .insert({
      textbook_version_id: versionId,
      section,
      content,
      status: source === 'upload' ? 'pending' : 'verified',
      verified_by: source === 'upload' ? null : ownerId,
      source,
    })
    .select('id, textbook_version_id, section, content, status, verified_by, source, created_at')
    .single();
  if (error || !data) return null;
  return rowToKnowledge(data);
}

const MAX_TEXTBOOK_FILE_BYTES = 20 * 1024 * 1024;
const TEXTBOOK_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'pdf', 'doc', 'docx', 'ppt', 'pptx']);

function validateTextbookFile(file: File | null | undefined): void {
  if (!file) return;
  if (file.size > MAX_TEXTBOOK_FILE_BYTES) {
    throw new AppError('VALIDATE_FAILED', '教材文件不能超过 20MB');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!TEXTBOOK_EXTENSIONS.has(ext)) {
    throw new AppError('VALIDATE_FAILED', '支持 TXT、MD、CSV、JSON、PDF、Word 或 PPT 教材文件');
  }
}

async function readTextFile(file: File | null | undefined): Promise<string> {
  if (!file) return '';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!['txt', 'md', 'csv', 'json'].includes(ext)) return '';
  try {
    return (await file.text()).trim().slice(0, 120_000);
  } catch {
    return '';
  }
}

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
  return base || 'textbook-file';
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
