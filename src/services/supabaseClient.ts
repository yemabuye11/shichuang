import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { env, isBackendConfigured } from '@/config/env';

/**
 * 全局唯一的 Supabase 客户端。
 *
 * 红线（ARCHITECTURE.md §8.7）：
 * - 这里只放 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`；
 * - service_role key 与任何大模型 API Key **绝不出现**在前端；
 * - **只有 `src/services/**` 允许 import 本文件**，页面组件禁止直接引用。
 */

let cached: SupabaseClient<Database> | null = null;

/**
 * 获取 Supabase 客户端。
 *
 * 未配置环境变量时返回 `null`，由各 service 走 MOCK 降级分支——
 * 这样 `npm run dev` 在没有云端配置的情况下也能完整跑通主链路。
 */
export function getSupabase(): SupabaseClient<Database> | null {
  if (!isBackendConfigured()) return null;
  if (cached) return cached;

  cached = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'shichuang-auth',
    },
    global: {
      headers: { 'x-application-name': 'shichuang-web' },
    },
  });

  return cached;
}

/**
 * 获取 Supabase 客户端；未配置时抛出可直接展示给教师的中文错误。
 *
 * @throws {Error} 后端未配置时抛出。
 */
export function requireSupabase(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) {
    throw new Error(
      '还没有连接云端服务。请在项目根目录创建 .env.local 并填写 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY。',
    );
  }
  return client;
}

/** 后端是否已配置（供 service 层决定走真实调用还是 MOCK）。 */
export const hasBackend = isBackendConfigured;

/**
 * Edge Function 基地址。
 *
 * @returns 形如 `https://xxx.supabase.co/functions/v1`。
 */
export function functionsBaseUrl(): string {
  return `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1`;
}
