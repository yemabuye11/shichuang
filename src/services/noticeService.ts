import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import type { Json } from '@/types/database';

/**
 * 系统公告服务（system_config.system_notice）。
 *
 * - 读：复用 0022 迁移的 `get_system_config('system_notice')` RPC；
 * - 写：复用 `admin_set_system_config('system_notice', jsonb)` RPC（管理员调用）。
 *
 * 设计要点：把公告 + 管理员微信收在一起，老师付完款扫码 / 加微信一目了然。
 * 不需要新写 RPC / 不需要迁移——复用既有的 system_config 白名单读写。
 */

/** 系统公告 + 管理员微信号（system_config.system_notice）。 */
export interface SystemNotice {
  enabled: boolean;
  title: string;
  content: string;
  wechat_id: string;
  updated_at: string;
}

/** 老师端读到的公告（部分字段可能缺失，做兜底）。 */
export type SystemNoticeView = SystemNotice;

/**
 * 读取当前系统公告。
 *
 * - 真实模式：rpc('get_system_config', { p_key: 'system_notice' });
 * - mock 模式：mockStore.current().systemNotice。
 *
 * @returns 公告对象；未配置或解析失败返回 null（前端不渲染）。
 */
export async function getSystemNotice(): Promise<SystemNoticeView | null> {
  if (isMockMode()) {
    const n = mockStore.current().systemNotice;
    return n ? { ...n } : null;
  }
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb.rpc('get_system_config', { p_key: 'system_notice' });
  if (error) {
    console.warn('[notice] 读取系统公告失败', error.message);
    return null;
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  const enabled = raw.enabled === true;
  if (!enabled) return null;
  const title = typeof raw.title === 'string' ? raw.title : '';
  const content = typeof raw.content === 'string' ? raw.content : '';
  const wechatId = typeof raw.wechat_id === 'string' ? raw.wechat_id : '';
  const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString();
  // 没有任何信息就不渲染
  if (!title && !content && !wechatId) return null;
  return {
    enabled: true,
    title,
    content,
    wechat_id: wechatId,
    updated_at: updatedAt,
  };
}

/**
 * 管理员：保存系统公告（启用开关 + 标题 + 内容 + 微信号）。
 *
 * 写入时自动更新 `updated_at`，让前端的「按 updated_at 一次性关闭」逻辑能正确触发。
 *
 * @param notice 公告字段（不需要传 updated_at）。
 */
export async function setSystemNotice(notice: {
  enabled: boolean;
  title: string;
  content: string;
  wechat_id: string;
}): Promise<SystemNotice> {
  const value: Json = {
    enabled: notice.enabled,
    title: notice.title.trim(),
    content: notice.content.trim(),
    wechat_id: notice.wechat_id.trim(),
    updated_at: new Date().toISOString(),
  };
  if (isMockMode()) {
    await mockStore.setSystemNotice({
      enabled: notice.enabled,
      title: notice.title.trim(),
      content: notice.content.trim(),
      wechat_id: notice.wechat_id.trim(),
    });
    const saved = mockStore.getSystemNotice();
    return saved;
  }
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');
  const { error } = await sb.rpc('admin_set_system_config', { p_key: 'system_notice', p_value: value });
  if (error) throw new AppError('FORBIDDEN', error.message, error);
  return {
    enabled: Boolean(value.enabled),
    title: typeof value.title === 'string' ? value.title : '',
    content: typeof value.content === 'string' ? value.content : '',
    wechat_id: typeof value.wechat_id === 'string' ? value.wechat_id : '',
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : new Date().toISOString(),
  };
}