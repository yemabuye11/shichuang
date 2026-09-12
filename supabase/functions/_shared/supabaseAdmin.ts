/**
 * service_role 客户端（仅在 Edge Function 进程内可见）。
 *
 * 红线：`SUPABASE_SERVICE_ROLE_KEY` 由平台自动注入，
 * **绝不能**写进日志、响应体或前端产物。
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

let cached: SupabaseClient | null = null;

/**
 * 获取 service_role 客户端（绕过 RLS，仅用于服务端可信写入）。
 */
export function adminClient(): SupabaseClient {
  if (cached) return cached;

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !key) {
    throw new Error('缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 环境变量');
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'shichuang-edge' } },
  });
  return cached;
}

/**
 * 以调用方身份创建的客户端（受 RLS 约束，用于校验 JWT 后的读写）。
 *
 * @param accessToken 前端传来的 JWT。
 */
export function userClient(accessToken: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!url || !anonKey) {
    throw new Error('缺少 SUPABASE_URL / SUPABASE_ANON_KEY 环境变量');
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
