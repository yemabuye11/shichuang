/**
 * CORS 头与预检处理（Edge Functions 共用）。
 *
 * 说明：浏览器只在「凭证模式」下要求具体 origin，这里统一回显请求的 origin，
 * 便于本地 `supabase functions serve` 与线上自定义域名同时可用。
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-application-name',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '86400',
};

/**
 * 用指定 origin 覆盖 CORS 头（用于需要凭证的场景）。
 *
 * @param origin 请求来源。
 * @returns CORS 头副本。
 */
export function corsFor(origin: string | null): Record<string, string> {
  if (!origin) return corsHeaders;
  return { ...corsHeaders, 'Access-Control-Allow-Origin': origin };
}

/** 处理 OPTIONS 预检。 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req.headers.get('origin')) });
  }
  return null;
}
