import { z } from 'zod';

/**
 * 环境变量集中校验与导出。
 *
 * 设计要点：
 * - **不在模块加载时抛错**。缺少 Supabase 配置是合法场景（MOCK 联调模式），
 *   此时 `isBackendConfigured()` 返回 false，service 层自动降级；
 * - 只有真正需要访问后端的调用点才会拿到明确的中文错误。
 */

const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().trim().url().optional().or(z.literal('')),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(1).optional().or(z.literal('')),
  VITE_ENABLE_MOCK: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .catch(undefined),
});

type RawEnv = Record<string, string | undefined>;

const raw: RawEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
  VITE_ENABLE_MOCK: import.meta.env.VITE_ENABLE_MOCK,
};

const parsed = EnvSchema.safeParse(raw);

/** 解析后的环境变量（解析失败时退化为「未配置」，不影响启动）。 */
export const env = {
  supabaseUrl: parsed.success ? (parsed.data.VITE_SUPABASE_URL ?? '') : '',
  supabaseAnonKey: parsed.success ? (parsed.data.VITE_SUPABASE_ANON_KEY ?? '') : '',
  enableMock: parsed.success ? parsed.data.VITE_ENABLE_MOCK === 'true' : false,
} as const;

/** 后端（Supabase）是否已完整配置。 */
export function isBackendConfigured(): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
}

/**
 * 是否启用无后端联调（MOCK）模式。
 *
 * 两种触发方式：
 * 1. 显式设置 `VITE_ENABLE_MOCK=true`；
 * 2. 未配置 Supabase（本地首次 `npm run dev` 的常见状态）。
 */
export function isMockMode(): boolean {
  return env.enableMock || !isBackendConfigured();
}

/**
 * 断言后端已配置，否则抛出可直接展示给教师的中文错误。
 *
 * @throws {Error} 后端未配置时抛出。
 */
export function assertBackendConfigured(): void {
  if (isBackendConfigured()) return;
  throw new Error(
    '还没有连接云端服务。请在项目根目录创建 .env.local 并填写 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY（参考 .env.example）。',
  );
}
