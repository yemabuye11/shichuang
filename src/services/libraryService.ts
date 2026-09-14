import { getSupabase } from '@/services/supabaseClient';

/**
 * 内容市场服务（对应迁移 0035_doc_library.sql，代号 T09）。
 *
 * 机制：老师把生成的文档/课件公开到内容库，他人下载花积分，原作者得一半
 * （按内容类型由系统统一定价，前端绝不写死价格数字，全部来自后端返回）。
 *
 * ⚠️ `doc_library` 表与三个 RPC（set_doc_library_public / download_library_doc）
 *   尚未进入生成的 `@/types/database`，这里用 `any` 客户端绕过未生成的强类型
 *   （表/列/RLS/RPC 由迁移 0035 在服务端保证，前端只做调用）。实现模式参考
 *   `src/services/resourceService.ts` 的 `resourceClient`。
 */

/** 前端展示用的内容库条目（camelCase，与 LibraryItem 对齐）。 */
export interface LibraryItem {
  id: string;
  docId: string;
  docType: string;
  title: string;
  ownerNickname: string;
  subject: string;
  grade: string;
  downloadCount: number;
  downloadCredits: number;
  isPublic: boolean;
  createdAt: string;
}

/** 下载结果（积分数值全部来自后端，前端不写死）。 */
export interface DownloadResult {
  docJsonUrl: string;
  price: number;
  reward: number;
}

/** 内容库条目行（snake_case，直对齐数据库列）。 */
interface LibraryRow {
  id: string;
  doc_id: string;
  doc_type: string;
  title: string;
  owner_nickname: string;
  subject: string;
  grade: string;
  download_count: number;
  download_credits: number;
  is_public: boolean;
  created_at: string;
}

/** 取 Supabase 客户端；未连接后端时抛出可展示的中文错误。 */
function libraryClient(): any {
  const sb = getSupabase();
  if (!sb) {
    throw new Error('还没有连接云端服务，无法访问内容库。请在 .env.local 配置 Supabase。');
  }
  return sb;
}

/** 取当前登录用户 id。 */
async function currentUserId(): Promise<string> {
  const sb = libraryClient();
  const { data } = await sb.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error('请先登录后再操作');
  return uid;
}

/** 行 → 展示对象（snake_case → camelCase）。 */
function mapRow(r: LibraryRow): LibraryItem {
  return {
    id: r.id,
    docId: r.doc_id,
    docType: r.doc_type,
    title: r.title,
    ownerNickname: r.owner_nickname,
    subject: r.subject,
    grade: r.grade,
    downloadCount: r.download_count,
    downloadCredits: r.download_credits,
    isPublic: r.is_public,
    createdAt: r.created_at,
  };
}

/**
 * 列出全部公开内容（内容库首页用）。
 *
 * @returns 按创建时间倒序的公开条目。
 */
export async function listPublicLibrary(): Promise<LibraryItem[]> {
  const sb = libraryClient();
  const { data, error } = await sb
    .from('doc_library')
    .select('*')
    .eq('is_public', true)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`加载内容库失败：${error.message}`);
  return (data ?? []).map((r: LibraryRow) => mapRow(r));
}

/**
 * 设置某文档在内容库的公开状态（作者本人调用；RLS 已校验 owner）。
 *
 * @param docId 文档（应用）UUID。
 * @param isPublic 是否公开。
 * @param title 文档标题（首次发布时落库用，可不传）。
 * @param ownerNickname 作者昵称（首次发布时落库用，可不传）。
 */
export async function setDocPublic(
  docId: string,
  isPublic: boolean,
  title?: string,
  ownerNickname?: string,
): Promise<void> {
  const sb = libraryClient();
  const { error } = await sb.rpc('set_doc_library_public', {
    p_doc_id: docId,
    p_is_public: isPublic,
    p_title: title ?? '',
    p_owner_nickname: ownerNickname ?? '',
  });
  if (error) throw new Error(`发布到内容库失败：${error.message}`);
}

/**
 * 查询某文档是否已公开到内容库（用于预览页开关初始态）。
 *
 * @param docId 文档（应用）UUID。
 * @returns 公开状态与下载次数；不在库内返回 null。
 */
export async function getDocLibraryEntry(
  docId: string,
): Promise<{ isPublic: boolean; downloadCount: number } | null> {
  const sb = libraryClient();
  const { data, error } = await sb
    .from('doc_library')
    .select('is_public, download_count')
    .eq('doc_id', docId)
    .maybeSingle();
  if (error) throw new Error(`读取内容库状态失败：${error.message}`);
  if (!data) return null;
  return { isPublic: Boolean(data.is_public), downloadCount: Number(data.download_count ?? 0) };
}

/**
 * 下载内容库中的某篇文档（扣积分 + 给作者分账由后端 RPC 完成）。
 *
 * @param docId 文档（应用）UUID。
 * @returns 文档 JSON 地址、本次消耗积分、作者获得积分（全部来自后端）。
 * @throws 积分不足时抛中文「积分不足，无法下载」；其余抛「下载失败：<message>」。
 */
export async function downloadDoc(docId: string): Promise<DownloadResult> {
  const sb = libraryClient();
  const { data, error } = await sb.rpc('download_library_doc', {
    p_doc_id: docId,
  });
  if (error) {
    if (error.message && error.message.includes('INSUFFICIENT_CREDITS')) {
      throw new Error('积分不足，无法下载');
    }
    throw new Error(`下载失败：${error.message}`);
  }
  const d = data as {
    doc_json_url?: string;
    docJsonUrl?: string;
    price?: number;
    reward?: number;
  };
  return {
    docJsonUrl: d.doc_json_url ?? d.docJsonUrl ?? '',
    price: Number(d.price ?? 0),
    reward: Number(d.reward ?? 0),
  };
}

/**
 * 更新当前登录用户的昵称（profiles 表）。
 *
 * @param nickname 新昵称（调用方负责 trim / 长度校验）。
 */
export async function updateNickname(nickname: string): Promise<void> {
  const sb = libraryClient();
  const uid = await currentUserId();
  const { error } = await sb
    .from('profiles')
    .update({ nickname: nickname.trim() })
    .eq('id', uid);
  if (error) throw new Error(`更新昵称失败：${error.message}`);
}
