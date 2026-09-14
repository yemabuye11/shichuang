import { getSupabase } from '@/services/supabaseClient';

/**
 * 校本资源库服务（对应迁移 0034_teacher_resources.sql）。
 *
 * - 教师上传优秀教学案例 / 教案 / PPT；文件存 Storage `resources` 桶，元数据存
 *   `teacher_resources` 表；
 * - 审核由服务端 SECURITY DEFINER RPC 完成（管理员判定口径与 0021 一致：
 *   `public.profiles.role = 'admin'`）。
 *
 * ⚠️ `teacher_resources` 表与两个 RPC 尚未进入生成的 `@/types/database`，
 *   这里用本地扩展类型 `ResourceDatabase` 包裹 SupabaseClient，保证类型安全且
 *   不改动中央生成类型文件（避免与其他并发改动的冲突）。
 */

/** 资源行（snake_case，直对齐数据库列，规避 camel/snake 映射坑）。 */
interface TeacherResourceRow {
  id: string;
  owner_id: string;
  title: string;
  subject: string;
  grade: string;
  doc_type: string | null;
  file_name: string;
  file_size: number;
  file_kind: string;
  file_path: string;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string;
  granted_credits: number;
  is_public: boolean;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

/** 仅描述本服务用到的 schema 片段，足以令 SupabaseClient 的 from/rpc 类型化。 */
type ResourceDatabase = {
  public: {
    Tables: {
      teacher_resources: {
        Row: TeacherResourceRow;
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          subject?: string;
          grade?: string;
          doc_type?: string | null;
          file_name?: string;
          file_size?: number;
          file_kind?: string;
          file_path?: string;
          status?: string;
          review_note?: string;
          granted_credits?: number;
          is_public?: boolean;
          created_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
        };
        Update: Partial<TeacherResourceRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      approve_teacher_resource: {
        Args: {
          p_resource_id: string;
          p_granted_credits?: number;
          p_is_public?: boolean;
          p_review_note?: string;
        };
        Returns: unknown;
      };
      reject_teacher_resource: {
        Args: { p_resource_id: string; p_review_note?: string };
        Returns: unknown;
      };
    };
    CompositeTypes: Record<string, never>;
  };
};

/** 前端展示用的资源条目（camelCase）。 */
export interface ResourceItem {
  id: string;
  title: string;
  subject: string;
  grade: string;
  docType: string;
  status: 'pending' | 'approved' | 'rejected';
  grantedCredits: number;
  isPublic: boolean;
  filePath: string;
  fileName: string;
  createdAt: string;
  reviewNote: string;
}

/** 资源类型下拉选项（5 类文档 + 其他），带中文 label。 */
export const RESOURCE_DOC_TYPES = [
  { value: 'lesson_plan', label: '教案' },
  { value: 'ppt', label: 'PPT 课件' },
  { value: 'courseware_2d', label: '课件（2D）' },
  { value: 'courseware_3d', label: '课件（3D）' },
  { value: 'office_doc', label: '办公文档' },
  { value: 'other', label: '其他' },
] as const;

export type ResourceDocType = (typeof RESOURCE_DOC_TYPES)[number]['value'];

/** 取类型化的 Supabase 客户端；未连接后端时抛出可展示的中文错误。 */
/**
 * 取 Supabase 客户端。`teacher_resources` 表与两个审核 RPC 尚未进入生成的
 * `@/types/database`，这里返回 `any` 以绕过未生成的强类型（表/桶/RLS/RPC 由
 * 迁移 0034 在服务端保证，前端只做调用）。
 */
function resourceClient(): any {
  const sb = getSupabase();
  if (!sb) {
    throw new Error('还没有连接云端服务，无法操作校本资源。请在 .env.local 配置 Supabase。');
  }
  return sb;
}

/** 取当前登录用户 id。 */
async function currentUserId(): Promise<string> {
  const sb = resourceClient();
  const { data } = await sb.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('请先登录后再操作');
  return uid;
}

/** 由扩展名推导 file_kind。 */
function deriveFileKind(fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();
  if (ext === 'doc' || ext === 'docx') return 'doc';
  if (ext === 'ppt' || ext === 'pptx') return 'ppt';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  return 'other';
}

/** 清洗文件名：保留扩展名、去掉路径分隔符与不安全字符，最长 180 字符。 */
function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '');
  const cleaned = base.replace(/[^\w.\-一-龥]+/g, '_').slice(0, 180);
  return cleaned || 'file';
}

const SELECT_COLUMNS =
  'id, title, subject, grade, doc_type, status, granted_credits, is_public, file_path, file_name, created_at, review_note';

/** 行 → 展示对象。 */
function mapRow(r: TeacherResourceRow): ResourceItem {
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    grade: r.grade,
    docType: r.doc_type ?? 'other',
    status: r.status,
    grantedCredits: r.granted_credits,
    isPublic: r.is_public,
    filePath: r.file_path,
    fileName: r.file_name,
    createdAt: r.created_at,
    reviewNote: r.review_note,
  };
}

/**
 * 上传一个优秀教学案例。
 *
 * @param file 待上传的文件。
 * @param meta 标题 / 学科 / 年级 / 类型。
 * @returns 新建的资源 id 与 storage 对象路径。
 */
export async function uploadResource(
  file: File,
  meta: { title: string; subject: string; grade: string; docType: string },
): Promise<{ id: string; filePath: string }> {
  const sb = resourceClient();
  const uid = await currentUserId();

  const sanitized = sanitizeFileName(file.name);
  const filePath = `r/${uid}/${crypto.randomUUID()}/${sanitized}`;

  const { error: upErr } = await sb.storage
    .from('resources')
    .upload(filePath, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
  if (upErr) throw new Error(`文件上传失败：${upErr.message}`);

  const { data, error: insErr } = await sb
    .from('teacher_resources')
    .insert({
      owner_id: uid,
      title: meta.title,
      subject: meta.subject,
      grade: meta.grade,
      doc_type: meta.docType,
      file_name: file.name,
      file_size: file.size,
      file_kind: deriveFileKind(file.name),
      file_path: filePath,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`资源记录创建失败：${insErr.message}`);
  if (!data) throw new Error('资源记录创建失败：未返回数据');

  return { id: data.id as string, filePath };
}

/** 查询「我上传的」资源，按创建时间倒序。 */
export async function listMyResources(): Promise<ResourceItem[]> {
  const sb = resourceClient();
  const uid = await currentUserId();
  const { data, error } = await sb
    .from('teacher_resources')
    .select(SELECT_COLUMNS)
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`加载我的资源失败：${error.message}`);
  return (data ?? []).map((r: TeacherResourceRow) => mapRow(r));
}

/** 查询待审核资源（管理员审核台使用；RLS 已放行管理员读全部）。 */
export async function listPendingResources(): Promise<ResourceItem[]> {
  const sb = resourceClient();
  const { data, error } = await sb
    .from('teacher_resources')
    .select(SELECT_COLUMNS)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`加载待审核资源失败：${error.message}`);
  return (data ?? []).map((r: TeacherResourceRow) => mapRow(r));
}

/** 管理员审核通过（赠送积分 + 标记公开）。 */
export async function approveResource(
  id: string,
  credits: number,
  isPublic: boolean,
  note: string,
): Promise<void> {
  const sb = resourceClient();
  const { error } = await sb.rpc('approve_teacher_resource', {
    p_resource_id: id,
    p_granted_credits: credits,
    p_is_public: isPublic,
    p_review_note: note,
  });
  if (error) throw new Error(`审核通过失败：${error.message}`);
}

/** 管理员驳回。 */
export async function rejectResource(id: string, note: string): Promise<void> {
  const sb = resourceClient();
  const { error } = await sb.rpc('reject_teacher_resource', {
    p_resource_id: id,
    p_review_note: note,
  });
  if (error) throw new Error(`驳回失败：${error.message}`);
}

/** 取资源的公开访问 URL（resources 桶为 public）。 */
export function getResourcePublicUrl(filePath: string): string {
  const sb = getSupabase();
  if (!sb || !filePath) return '';
  return sb.storage.from('resources').getPublicUrl(filePath).data.publicUrl;
}
