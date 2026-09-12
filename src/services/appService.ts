import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { toApp, toAppType } from './mappers';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import type { App } from '@/types/models';
import type { PublishResult } from '@/types/api';
import type { AppStatus, AppType } from '@/types/enums';

/**
 * 应用服务：我的应用 CRUD / 发布 / 复制。
 *
 * 约定：页面组件禁止直接 import supabaseClient，一律走这里。
 */

export type MyAppsFilter = 'all' | 'published' | 'draft';

/**
 * 创建一条草稿（真实链路下由 Edge Function 创建，此处仅用于本地兜底与测试）。
 *
 * @param input 草稿字段。
 */
export async function createDraft(input: {
  title: string;
  promptRaw: string;
  appType: AppType;
  subject?: string;
  grade?: string;
  creditsCost?: number;
}): Promise<App> {
  if (isMockMode()) {
    await mockStore.load();
    return mockStore.addApp({
      title: input.title,
      summary: '',
      appType: input.appType,
      promptRaw: input.promptRaw,
      creditsCost: input.creditsCost ?? 0,
      htmlUrl: '',
      htmlStatus: 'pending',
      html: '',
      subject: input.subject ?? '',
      grade: input.grade ?? '',
    });
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '请先登录');

  const { data, error } = await sb
    .from('apps')
    .insert({
      author_id: uid,
      title: input.title,
      prompt_raw: input.promptRaw,
      app_type: input.appType,
      subject: input.subject ?? '',
      grade: input.grade ?? '',
      credits_cost: input.creditsCost ?? 0,
      status: 'draft',
      html_status: 'pending',
    })
    .select('*')
    .single();

  if (error) throw new AppError('UNKNOWN', '创建失败，请重试', error);
  return toApp(data);
}

/**
 * 列出我的应用。
 *
 * @param filter 全部 / 已发布 / 未发布。
 */
export async function listMine(filter: MyAppsFilter = 'all'): Promise<App[]> {
  if (isMockMode()) {
    const st = await mockStore.load();
    return st.apps.filter((a) => {
      if (filter === 'published') return a.status === 'published';
      if (filter === 'draft') return a.status !== 'published';
      return true;
    });
  }

  const sb = getSupabase();
  if (!sb) return [];
  const { data: sessionData } = await sb.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) return [];

  let query = sb.from('apps').select('*').eq('author_id', uid).order('created_at', { ascending: false });
  if (filter === 'published') query = query.eq('status', 'published');
  if (filter === 'draft') query = query.neq('status', 'published');

  const { data, error } = await query;
  if (error) throw new AppError('UNKNOWN', '读取我的应用失败，请重试', error);
  return (data ?? []).map((row) => toApp(row));
}

/**
 * 按 ID 读取应用（公开路由 `/app/:id` 也走这里）。
 *
 * @param id 应用 UUID。
 * @returns 应用；不存在或不可见时返回 `null`。
 */
export async function getById(id: string): Promise<App | null> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const found = st.apps.find((a) => a.id === id) ?? null;
    // 演示应用：确保本地 HTML 副本存在（IndexedDB 可能被清理过）
    if (found && id.startsWith('demo-')) {
      const { ensureDemoHtml } = await import('./mock/mockSeed');
      await ensureDemoHtml();
    }
    return found;
  }

  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from('apps')
    .select('*, author:public_authors!apps_author_id_fkey(id, nickname, avatar_seed)')
    .eq('id', id)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return toApp(data);
}

/**
 * 发布到广场。
 *
 * @param appId 应用 UUID。
 * @param meta 标题 / 简介 / 学科 / 年级 / 封面。
 */
export async function publish(
  appId: string,
  meta: { title?: string; summary?: string; subject?: string; grade?: string; coverSeed?: string } = {},
): Promise<PublishResult> {
  if (isMockMode()) {
    await mockStore.load();
    const st = mockStore.current();
    const app = st.apps.find((a) => a.id === appId);
    if (!app) throw new AppError('UNKNOWN', '应用不存在');
    if (app.htmlStatus !== 'ready') throw new AppError('UNKNOWN', '应用内容还在发布中，请稍候再试');

    const reward = 2;
    const balance = mockStore.applyCredit(reward, 'publish_reward', '发布应用奖励', {
      refType: 'app',
      refId: appId,
    });
    const idx = st.apps.findIndex((a) => a.id === appId);
    st.apps[idx] = {
      ...app,
      status: 'published',
      publishedAt: new Date().toISOString(),
      title: meta.title?.trim() || app.title,
      summary: meta.summary ?? app.summary,
      subject: meta.subject ?? app.subject,
      grade: meta.grade ?? app.grade,
      coverSeed: meta.coverSeed ?? app.coverSeed,
    };
    await mockStore.persist();
    return { ok: true, appId, rewardCredits: reward, balance, message: '发布成功' };
  }

  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data, error } = await sb.rpc('publish_app', {
    p_app_id: appId,
    p_title: meta.title ?? null,
    p_summary: meta.summary ?? null,
    p_subject: meta.subject ?? null,
    p_grade: meta.grade ?? null,
    p_cover_kind: 'auto',
    p_cover_seed: meta.coverSeed ?? null,
  });
  if (error) throw new AppError('UNKNOWN', '发布失败，请重试', error);
  const raw = (data ?? {}) as Record<string, unknown>;
  if (raw.ok !== true) throw new AppError('UNKNOWN', String(raw.message ?? '发布失败'));
  return {
    ok: true,
    appId,
    rewardCredits: Number(raw.rewardCredits ?? 0),
    balance: Number(raw.balance ?? 0),
    message: String(raw.message ?? '发布成功'),
  };
}

/** 取消发布。 */
export async function unpublish(appId: string): Promise<void> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const idx = st.apps.findIndex((a) => a.id === appId);
    if (idx >= 0) {
      st.apps[idx] = { ...st.apps[idx], status: 'draft', publishedAt: null };
      await mockStore.persist();
    }
    return;
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.rpc('unpublish_app', { p_app_id: appId });
  if (error) throw new AppError('UNKNOWN', '操作失败，请重试', error);
}

/** 重命名。 */
export async function rename(appId: string, title: string): Promise<void> {
  if (!title.trim()) throw new AppError('VALIDATE_FAILED', '标题不能为空');
  if (isMockMode()) {
    const st = await mockStore.load();
    const idx = st.apps.findIndex((a) => a.id === appId);
    if (idx >= 0) {
      st.apps[idx] = { ...st.apps[idx], title: title.trim() };
      await mockStore.persist();
    }
    return;
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.rpc('rename_app', { p_app_id: appId, p_title: title.trim() });
  if (error) throw new AppError('UNKNOWN', '保存失败，请重试', error);
}

/** 删除。 */
export async function remove(appId: string): Promise<void> {
  if (isMockMode()) {
    const st = await mockStore.load();
    st.apps = st.apps.filter((a) => a.id !== appId);
    await mockStore.persist();
    return;
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.rpc('delete_app', { p_app_id: appId });
  if (error) throw new AppError('UNKNOWN', '删除失败，请重试', error);
}

/**
 * 复制一份（remix / 做同款）。
 *
 * @param appId 源应用 UUID。
 * @returns 新应用。
 */
export async function duplicate(appId: string): Promise<App> {
  if (isMockMode()) {
    const st = await mockStore.load();
    const src = st.apps.find((a) => a.id === appId);
    if (!src) throw new AppError('UNKNOWN', '应用不存在');
    const copy: App = { ...src, id: `mock-app-copy-${Date.now()}`, title: `${src.title} 的副本`, status: 'draft', publishedAt: null };
    st.apps = [copy, ...st.apps];
    await mockStore.persist();
    return copy;
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { data, error } = await sb.rpc('duplicate_app', { p_app_id: appId });
  if (error) throw new AppError('UNKNOWN', '复制失败，请重试', error);
  const raw = (data ?? {}) as Record<string, unknown>;
  const newId = String(raw.appId ?? '');
  if (!newId) throw new AppError('UNKNOWN', '复制失败，请重试');
  const created = await getById(newId);
  if (!created) throw new AppError('UNKNOWN', '复制失败，请重试');
  return created;
}

/**
 * 更新应用的 HTML 产物状态（仅管理员/内部使用，正常链路由 Edge Function 写）。
 *
 * @param appId 应用 UUID。
 * @param patch 要更新的字段。
 */
export async function patchHtmlMeta(
  appId: string,
  patch: { htmlUrl?: string; htmlStatus?: 'pending' | 'ready' | 'failed'; htmlSizeBytes?: number; htmlSha256?: string },
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('apps')
    .update({
      ...(patch.htmlUrl !== undefined ? { html_url: patch.htmlUrl } : {}),
      ...(patch.htmlStatus !== undefined ? { html_status: patch.htmlStatus } : {}),
      ...(patch.htmlSizeBytes !== undefined ? { html_size_bytes: patch.htmlSizeBytes } : {}),
      ...(patch.htmlSha256 !== undefined ? { html_sha256: patch.htmlSha256 } : {}),
    })
    .eq('id', appId);
  if (error) throw new AppError('UNKNOWN', '保存失败，请重试', error);
}

/** 把字符串收敛为合法 AppType（供页面复用，避免直接引用 mappers）。 */
export { toAppType };

/** 应用状态过滤的中文名（供 UI 复用）。 */
export const APP_STATUS_LABEL: Record<AppStatus, string> = {
  draft: '未发布',
  published: '已发布',
  taken_down: '已下架',
};
