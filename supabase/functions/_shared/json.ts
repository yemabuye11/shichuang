/**
 * JSON 响应助手。
 */

import { corsHeaders } from './cors.ts';

/** 返回 JSON 成功响应。 */
export function jsonOk(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    status: init.status ?? 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
}

/** 返回 JSON 错误响应。 */
export function jsonError(
  status: number,
  body: { code: string; message: string; [k: string]: unknown },
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** SSE 流式响应头。 */
export const SSE_HEADERS: Record<string, string> = {
  ...corsHeaders,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};
