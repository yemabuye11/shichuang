import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { toSquareItem } from './mappers';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import { SQUARE_PAGE_SIZE } from '@/config/creditRules';
import type { Page, SquareItem } from '@/types/models';
import type { AppType } from '@/types/enums';
import type { LikeResult } from '@/types/api';
import type { ListSquareRow } from '@/types/database';

/**
 * 应用广场服务：列表 / 搜索 / 排序 / 点赞 / 举报。
 *
 * 未登录可浏览（P0-A3 硬性）：`list_square` 是 SECURITY DEFINER，anon 可调用。
 */

export type SquareSort = 'latest' | 'hottest' | 'liked';

/** 把 ISO 时间串转时间戳（用于「最新」排序，空值排最后）。 */
function tsOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export interface SquareQuery {
  type?: AppType | '';
  subject?: string;
  grade?: string;
  sort?: SquareSort;
  q?: string;
  offset?: number;
  limit?: number;
}

/**
 * 分页查询广场。
 *
 * @param query 过滤与分页条件。
 * @returns 分页结果（每页 ≤24）。
 */
export async function list(query: SquareQuery = {}): Promise<Page<SquareItem>> {
  const offset = Math.max(query.offset ?? 0, 0);
  const limit = Math.min(Math.max(query.limit ?? SQUARE_PAGE_SIZE, 1), SQUARE_PAGE_SIZE);

  if (isMockMode()) {
    const st = await mockStore.load();
    let items = st.apps.filter((a) => a.status === 'published');
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (a) => a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q),
      );
    }
    if (query.type) items = items.filter((a) => a.appType === query.type);
    if (query.subject) items = items.filter((a) => a.subject === query.subject);
    if (query.grade) items = items.filter((a) => a.grade === query.grade);
    if (query.sort === 'hottest') items = [...items].sort((a, b) => b.viewCount - a.viewCount);
    else if (query.sort === 'liked') items = [...items].sort((a, b) => b.likeCount - a.likeCount);
    else items = [...items].sort((a, b) => tsOf(b.publishedAt) - tsOf(a.publishedAt));

    const total = items.length;
    const page = items.slice(offset, offset + limit);
    return {
      items: page.map((a) => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        appType: a.appType,
        subject: a.subject,
        grade: a.grade,
        coverKind: a.coverKind,
        coverSeed: a.coverSeed,
        coverUrl: a.coverUrl ?? '',
        status: a.status,
        publishedAt: a.publishedAt,
        viewCount: a.viewCount,
        likeCount: a.likeCount,
        author: {
          id: a.authorId,
          nickname: a.author?.nickname ?? (a.authorId.startsWith('demo-') ? '演示老师' : '我'),
          avatarSeed: a.author?.avatarSeed ?? a.authorId,
        },
        likedByMe: a.likedByMe === true,
      })),
      total,
      offset,
      limit,
      hasMore: offset + page.length < total,
    };
  }

  const sb = getSupabase();
  if (!sb) {
    return { items: [], total: 0, offset, limit, hasMore: false };
  }

  const { data, error } = await sb.rpc('list_square', {
    p_type: query.type ?? null,
    p_subject: query.subject ?? null,
    p_grade: query.grade ?? null,
    p_sort: query.sort ?? 'latest',
    p_q: query.q ?? null,
    p_offset: offset,
    p_limit: limit,
  });

  if (error) throw new AppError('UNKNOWN', '加载广场失败，请下拉重试', error);

  const rows = ((data ?? []) as unknown as ListSquareRow[]) ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0;
  const items = rows.map(toSquareItem);

  return { items, total, offset, limit, hasMore: offset + items.length < total };
}

/**
 * 点赞 / 取消点赞。
 *
 * @param appId 应用 UUID。
 */
export async function toggleLike(appId: string): Promise<LikeResult> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const idx = st.apps.findIndex((a) => a.id === appId);
    if (idx >= 0) {
      const app = st.apps[idx];
      const liked = !app.likedByMe;
      st.apps[idx] = { ...app, likedByMe: liked, likeCount: app.likeCount + (liked ? 1 : -1) };
      await mockStore.persist();
      return { liked, likeCount: st.apps[idx].likeCount };
    }
    return { liked: false, likeCount: 0 };
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('UNAUTHORIZED', '点赞需要先登录');
  const { data, error } = await sb.rpc('toggle_like', { p_app_id: appId });
  if (error) throw new AppError('UNAUTHORIZED', '点赞需要先登录', error);
  const raw = (data ?? {}) as Record<string, unknown>;
  return { liked: raw.liked === true, likeCount: Number(raw.likeCount ?? 0) };
}

/**
 * 举报应用（匿名可用）。
 *
 * @param appId 应用 UUID。
 * @param reason 举报原因。
 * @param detail 补充说明。
 */
export async function report(appId: string, reason: string, detail = ''): Promise<void> {
  if (!reason.trim()) throw new AppError('VALIDATE_FAILED', '请选择举报原因');
  if (isMockMode()) {
    await mockStore.load();
    await mockStore.addReport(appId, reason.trim(), detail.trim());
    return;
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.rpc('report_app', {
    p_app_id: appId,
    p_reason: reason.trim(),
    p_detail: detail.trim(),
    p_reporter_hash: '',
  });
  if (error) throw new AppError('UNKNOWN', '提交失败，请稍后重试', error);
}

/** 举报原因选项（P0-D6）。 */
export const REPORT_REASONS: readonly string[] = [
  '内容不适合未成年人',
  '知识点有明显错误',
  '含有商业广告或引流',
  '打不开或运行异常',
  '抄袭他人作品',
  '其他问题',
];

/** 兼容类型导出。 */
export type { LikeResult };
