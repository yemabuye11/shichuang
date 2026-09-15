import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { mockGenerate } from './mock/mockGenerate';
import { isMockMode } from '@/config/env';
import * as mockStore from './mock/mockStore';
import * as artifactService from './artifactService';
import type {
  DeltaEvent,
  DoneEvent,
  ErrorEvent,
  GenerateErrorCode,
  GenerateRequest,
  GenEvent,
  HeartbeatEvent,
  StageEvent,
} from '@/types/api';
import { getAppTypeCost, getDocTypeCost } from '@/config/constants';

/**
 * 生成服务：SSE 流式生成 + 取消 + 错误码归集。
 *
 * SSE 帧格式（与 Edge Function 严格一致）：
 * ```
 * event: stage
 * data: {"stage":"understand","label":"理解教学需求","status":"done"}
 *
 * event: delta
 * data: {"text":"<!DOCTYPE html>..."}
 * ```
 */

export interface GenerateHandlers {
  /** 收到一个事件。 */
  onEvent: (event: GenEvent) => void;
  /** 发生网络/解析错误（非业务错误码）。 */
  onError?: (err: AppError) => void;
  /** 流结束（无论成功失败）。 */
  onFinish?: () => void;
}

export interface GenerateSession {
  /** 取消生成（客户端主动断开；服务端会退还预扣积分）。 */
  cancel: () => void;
  /** 是否已完成。 */
  readonly finished: boolean;
}

/**
 * 发起一次生成。
 *
 * @param req 生成请求（含前端生成的幂等键）。
 * @param handlers 事件回调。
 * @returns 会话句柄（可取消）。
 */
export function startGenerate(req: GenerateRequest, handlers: GenerateHandlers): GenerateSession {
  const controller = new AbortController();
  const session = {
    cancel: () => controller.abort(),
    finished: false,
  };

  void run(req, handlers, controller, () => {
    session.finished = true;
    handlers.onFinish?.();
  });

  return session;
}

/** 内部执行体。 */
async function run(
  req: GenerateRequest,
  handlers: GenerateHandlers,
  controller: AbortController,
  finish: () => void,
): Promise<void> {
  try {
    if (isMockMode()) {
      await runMock(req, handlers, controller);
      finish();
      return;
    }
    await runRemote(req, handlers, controller);
    finish();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // 取消已通过 error 事件告知上层，这里静默收尾
      finish();
      return;
    }
    const appError =
      err instanceof AppError
        ? err
        : new AppError('NETWORK', err instanceof Error ? err.message : undefined, err);
    handlers.onError?.(appError);
    emitError(handlers, {
      code: (appError.code as GenerateErrorCode) ?? 'NETWORK',
      message: appError.message,
      refunded: true,
      creditsBalance: 0,
      retryable: true,
    });
    finish();
  }
}

/** MOCK 分支：本地伪流式，语义与真实链路一致（先预扣，失败/取消退还）。 */
async function runMock(
  req: GenerateRequest,
  handlers: GenerateHandlers,
  controller: AbortController,
): Promise<void> {
  const st = await mockStore.load();
  const cost =
    req.category === 'doc' && req.docType
      ? getDocTypeCost(req.docType)
      : getAppTypeCost(req.appType);

  let reserved = false;
  try {
    mockStore.applyCredit(-cost, 'generate_spend', '生成应用预扣（演示）', {
      refType: 'generate_spend',
      refId: req.idempotencyKey,
    });
    reserved = true;
  } catch {
    emitError(handlers, {
      code: 'INSUFFICIENT_CREDITS',
      message: '积分不足啦，可以用兑换码充值，或联系管理员',
      refunded: false,
      creditsBalance: st.account.balance,
      retryable: false,
    });
    return;
  }

  const done = await mockGenerate(req, {
    onEvent: handlers.onEvent,
    isCancelled: () => controller.signal.aborted,
    balanceBefore: st.account.balance,
    // 先落库再发 done：UI 收到事件时 appId 一定有效
    persist: (input) =>
      persistMockApp(req, {
        title: input.title,
        summary: input.summary,
        html: input.html,
        creditsCost: input.creditsCost,
        docJson: input.docJson,
        category: input.category,
        docType: input.docType,
        docJsonUrl: input.docJsonUrl,
      }),
  });

  if (!done) {
    if (reserved) {
      const balance = mockStore.applyCredit(cost, 'generate_refund', '取消生成退还（演示）', {
        refType: 'generate_refund',
        refId: req.idempotencyKey,
      });
      emitError(handlers, {
        code: 'CANCELLED',
        message: '已取消生成，积分已退还',
        refunded: true,
        creditsBalance: balance,
        retryable: true,
      });
    }
    return;
  }

}

/** 真实分支：调 Edge Function 的 SSE 接口。 */
async function runRemote(
  req: GenerateRequest,
  handlers: GenerateHandlers,
  controller: AbortController,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new AppError('NETWORK', '还没有连接云端服务');

  let { data: sessionData } = await sb.auth.getSession();
  let session = sessionData?.session ?? null;
  // 移动端 / 长时间打开页面时，getSession 可能拿到临近过期的本地会话。
  // 先主动刷新，避免页面看起来已登录但 Edge 收到已过期 JWT。
  const expiresAt = session?.expires_at ?? 0;
  if (!session || expiresAt > 0 && expiresAt - Math.floor(Date.now() / 1000) < 60) {
    const refreshed = await sb.auth.refreshSession();
    session = refreshed.data.session ?? null;
  }
  let token = session?.access_token;
  if (!token) throw new AppError('UNAUTHORIZED', '登录状态已失效，请重新登录');

  // 使用 Supabase 官方 FunctionsClient：它会在专用 fetch 中注入 apikey 和当前 JWT，
  // 也能保留 text/event-stream 响应体供前端逐帧解析。
  sb.functions.setAuth(token);
  const invoke = () =>
    sb.functions.invoke<unknown>('generate', {
      body: req,
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

  let result = await invoke();
  // 只对鉴权失败重试一次。401 在预扣积分之前返回，因此不会造成重复扣费；
  // 其他业务错误必须原样交给页面，避免重复提交生成任务。
  if (result.response?.status === 401) {
    const refreshed = await sb.auth.refreshSession();
    const refreshedToken = refreshed.data.session?.access_token;
    if (refreshedToken && refreshedToken !== token) {
      token = refreshedToken;
      sb.functions.setAuth(token);
      result = await invoke();
    }
  }

  if (result.error || !result.data) {
    const res = result.response;
    if (!res) throw result.error ?? new AppError('NETWORK', '生成服务暂时不可用');
    const payload = await safeJson(res);
    const code = (payload?.code as GenerateErrorCode) ?? (res.status === 401 ? 'UNAUTHORIZED' : 'MODEL_ERROR');
    emitError(handlers, {
      code,
      message: payload?.message ?? '生成失败，本次不扣积分',
      refunded: payload?.refunded ?? true,
      creditsBalance: payload?.creditsBalance ?? 0,
      retryable: true,
    });
    return;
  }

  const res = result.data as Response;
  if (!res.body) throw new AppError('NETWORK', '生成服务没有返回有效内容');
  await parseSse(res.body, handlers.onEvent);
}

/** 发出一个 error 事件。 */
function emitError(handlers: GenerateHandlers, data: ErrorEvent): void {
  handlers.onEvent({ type: 'error', data });
}

/**
 * 解析 SSE 字节流为事件序列。
 *
 * 容错：帧不完整会留在缓冲区等待下一块；JSON 解析失败的单帧直接丢弃。
 *
 * @param body 响应体流。
 * @param onEvent 事件回调。
 */
export async function parseSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: GenEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx = buffer.indexOf('\n\n');
    while (sepIdx >= 0) {
      const frame = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const event = parseFrame(frame);
      if (event) onEvent(event);
      sepIdx = buffer.indexOf('\n\n');
    }
  }
}

/**
 * 解析单个 SSE 帧。
 *
 * @param frame 形如 `event: delta\ndata: {...}` 的文本。
 * @returns 事件；无法识别时返回 `null`。
 */
export function parseFrame(frame: string): GenEvent | null {
  let eventName = '';
  const dataLines: string[] = [];

  for (const rawLine of frame.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    } else if (line.startsWith(':')) {
      // 注释行（服务端心跳），忽略
      continue;
    }
  }

  if (eventName.length === 0 || dataLines.length === 0) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== 'object') return null;

  switch (eventName) {
    case 'stage':
      return { type: 'stage', data: payload as StageEvent };
    case 'delta':
      return { type: 'delta', data: payload as DeltaEvent };
    case 'heartbeat':
      return { type: 'heartbeat', data: payload as HeartbeatEvent };
    case 'done':
      return { type: 'done', data: payload as DoneEvent };
    case 'error':
      return { type: 'error', data: payload as ErrorEvent };
    default:
      return null;
  }
}

/** 安全读取错误响应体并尝试 JSON 解析。 */
async function safeJson(
  res: Response,
): Promise<{ code?: string; message?: string; refunded?: boolean; creditsBalance?: number } | null> {
  try {
    const text = await res.text();
    return JSON.parse(text) as { code?: string; message?: string; refunded?: boolean; creditsBalance?: number };
  } catch {
    return null;
  }
}

/** 把 MOCK 生成结果落到本地应用列表（等效于 Edge Function 写库），返回真实 appId。 */
async function persistMockApp(
  req: GenerateRequest,
  input: {
    title: string;
    summary: string;
    html: string;
    creditsCost: number;
    docJson?: string | null;
    category?: 'app' | 'doc';
    docType?: string;
    docJsonUrl?: string | null;
  },
): Promise<string> {
  const category = input.category ?? req.category ?? 'app';
  const app = await mockStore.addApp({
    title: input.title,
    summary: input.summary,
    appType: req.appType,
    promptRaw: req.prompt,
    creditsCost: input.creditsCost,
    htmlUrl: category === 'doc' ? `/d/${input.docJson ? '' : ''}` : '',
    htmlStatus: 'ready',
    html: input.html,
    subject: req.subject ?? '',
    grade: req.grade ?? '',
    category,
    docType: input.docType ?? (category === 'doc' ? (req.docType as string) : undefined),
    docJsonUrl: input.docJsonUrl ?? null,
    docJson: input.docJson ?? null,
    textbookVersionId: req.textbookVersionId ?? null,
  });
  // 写本地副本：结果页与 /app/:id 立即可渲染（ARCHITECTURE.md §2.4 第一道保险）
  try {
    await artifactService.saveLocal(app.id, input.html, app.htmlSha256, 1);
  } catch {
    /* 本地副本失败不影响主流程，会退化为从 html_url 播放 */
  }
  return app.id;
}
