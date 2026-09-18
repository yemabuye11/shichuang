import { getSupabase } from './supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
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
  if (isResumablePptRequest(req)) {
    await runRemotePptResumable(req, handlers, controller, sb);
    return;
  }

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

const PPT_RESUME_PARTS = 4;
const PPT_PART_CLIENT_TIMEOUT_MS = 138_000;
const PPT_PART_MAX_ATTEMPTS = 3;
const PPT_FULL_MAX_CYCLES = 2;

/** 只有单独生成 PPT 时启用跨请求续跑；多格式仍保持原有一体化链路。 */
function isResumablePptRequest(req: GenerateRequest): boolean {
  if (req.category !== 'doc') return false;
  const formats = Array.isArray(req.docTypes) && req.docTypes.length > 0
    ? req.docTypes
    : req.docType
      ? [req.docType]
      : [];
  return formats.length === 1 && formats[0] === 'ppt';
}

interface RemoteCallOutcome {
  done: boolean;
  checkpoint: boolean;
  error: ErrorEvent | null;
}

/**
 * PPT 跨请求续跑。
 *
 * 每个分段请求都由 Edge 平台独立计时，前一段的 JSON 已写入服务端检查点；
 * 网络被网关切断时只重试当前段，不会丢掉已经生成好的页面。四段全部完成后
 * 再单独发一个最终请求做合并、质量门禁、存储和结算。
 */
async function runRemotePptResumable(
  req: GenerateRequest,
  handlers: GenerateHandlers,
  controller: AbortController,
  sb: SupabaseClient,
): Promise<void> {
  let lastError: ErrorEvent | null = null;

  const invokeResumable = async (
    body: GenerateRequest,
    signal: AbortSignal,
  ): Promise<RemoteCallOutcome> => {
    const result = await sb.functions.invoke<unknown>('generate', {
      body,
      headers: { Accept: 'text/event-stream' },
      signal,
    });

    if (result.error || !result.data) {
      const res = result.response;
      const payload = res ? await safeJson(res) : null;
      return {
        done: false,
        checkpoint: false,
        error: {
          code: (payload?.code as GenerateErrorCode) ?? 'NETWORK',
          message: payload?.message ?? '生成连接中断，系统正在自动续跑',
          refunded: payload?.refunded ?? false,
          creditsBalance: payload?.creditsBalance ?? 0,
          retryable: payload?.retryable ?? true,
        },
      };
    }

    const res = result.data as Response;
    if (!res.body) {
      return {
        done: false,
        checkpoint: false,
        error: {
          code: 'NETWORK',
          message: '生成连接没有返回内容，系统正在自动续跑',
          refunded: false,
          creditsBalance: 0,
          retryable: true,
        },
      };
    }

    const outcome: RemoteCallOutcome = { done: false, checkpoint: false, error: null };
    await parseSse(res.body, (event) => {
      if (event.type === 'error') {
        outcome.error = event.data;
        return;
      }
      if (event.type === 'checkpoint') {
        outcome.checkpoint = true;
        handlers.onEvent(event);
        return;
      }
      if (event.type === 'done') {
        outcome.done = true;
        handlers.onEvent(event);
        return;
      }
      handlers.onEvent(event);
    });
    return outcome;
  };

  const callWithRetry = async (
    body: GenerateRequest,
    retryValidationFailure = true,
  ): Promise<RemoteCallOutcome> => {
    let outcome: RemoteCallOutcome | null = null;
    for (let attempt = 1; attempt <= PPT_PART_MAX_ATTEMPTS; attempt += 1) {
      if (controller.signal.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
      }
      const callController = new AbortController();
      const abortCall = (): void => callController.abort();
      controller.signal.addEventListener('abort', abortCall, { once: true });
      const timeout = setTimeout(() => callController.abort(), PPT_PART_CLIENT_TIMEOUT_MS);
      try {
        outcome = await invokeResumable(body, callController.signal);
      } catch (err) {
        if (controller.signal.aborted) throw err;
        const message = err instanceof Error ? err.message : '生成连接中断';
        outcome = {
          done: false,
          checkpoint: false,
          error: {
            code: 'NETWORK',
            message: `${message}，系统正在自动续跑`,
            refunded: false,
            creditsBalance: 0,
            retryable: true,
          },
        };
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abortCall);
      }

      lastError = outcome.error;
      if (outcome.done || outcome.checkpoint) return outcome;
      if (outcome.error && !outcome.error.retryable) return outcome;
      if (
        !retryValidationFailure &&
        outcome.error?.code === 'VALIDATE_FAILED'
      ) {
        return outcome;
      }
      if (attempt < PPT_PART_MAX_ATTEMPTS) {
        await waitForRetry(controller.signal, attempt * 1_200);
      }
    }
    return outcome ?? {
      done: false,
      checkpoint: false,
      error: lastError ?? {
        code: 'NETWORK',
        message: '生成连接多次中断，系统正在退回积分',
        refunded: false,
        creditsBalance: 0,
        retryable: true,
      },
    };
  };

  try {
    for (let cycle = 1; cycle <= PPT_FULL_MAX_CYCLES; cycle += 1) {
      for (let part = 1; part <= PPT_RESUME_PARTS; part += 1) {
        const outcome = await callWithRetry({
          ...req,
          category: 'doc',
          docType: 'ppt',
          docTypes: ['ppt'],
          pptResumable: true,
          pptPart: part,
          pptFinalize: false,
          pptAbort: false,
        });
        if (outcome.done) return;
        if (!outcome.checkpoint || outcome.error) {
          await abortRemotePpt(sb, req.idempotencyKey);
          emitError(handlers, {
            code: outcome.error?.code ?? 'NETWORK',
            message: outcome.error?.message
              ? `${outcome.error.message}。已自动停止并退还积分，请重试`
              : 'PPT 分段多次未完成，已自动停止并退还积分，请重新生成',
            refunded: true,
            creditsBalance: outcome.error?.creditsBalance ?? 0,
            retryable: true,
          });
          return;
        }
      }

      handlers.onEvent({
        type: 'stage',
        data: { stage: 'verify', label: '合并并检查整份课件', status: 'running' },
      });
      const finalOutcome = await callWithRetry(
        {
          ...req,
          category: 'doc',
          docType: 'ppt',
          docTypes: ['ppt'],
          pptResumable: true,
          pptFinalize: true,
          pptAbort: false,
        },
        false,
      );
      if (finalOutcome.done) return;

      lastError = finalOutcome.error;
      if (cycle < PPT_FULL_MAX_CYCLES) {
        handlers.onEvent({
          type: 'stage',
          data: { stage: 'code', label: '质量自检未通过，自动重新生成分段', status: 'running' },
        });
        await waitForRetry(controller.signal, 1_500);
        continue;
      }
      break;
    }

    await abortRemotePpt(sb, req.idempotencyKey);
    emitError(handlers, {
      code: lastError?.code ?? 'VALIDATE_FAILED',
      message: lastError?.message ?? 'PPT 多次生成仍未通过质量检查，已退还积分',
      refunded: true,
      creditsBalance: lastError?.creditsBalance ?? 0,
      retryable: true,
    });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
    await abortRemotePpt(sb, req.idempotencyKey);
  }
}

async function abortRemotePpt(sb: SupabaseClient, idempotencyKey: string): Promise<void> {
  try {
    await sb.functions.invoke('generate', {
      body: {
        prompt: 'abort',
        appType: 'ppt',
        category: 'doc',
        docType: 'ppt',
        idempotencyKey,
        pptResumable: true,
        pptAbort: true,
      } satisfies GenerateRequest,
    });
  } catch {
    /* 最差情况由下次生成时自动回收 stale running 任务 */
  }
}

function waitForRetry(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Generation cancelled', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new DOMException('Generation cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
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

  const consumeFrames = (): void => {
    // 供应商和反向代理可能使用 LF 或 CRLF；统一按空行切帧。
    for (;;) {
      const match = /\r?\n\r?\n/.exec(buffer);
      if (!match || match.index === undefined) return;
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const event = parseFrame(frame);
      if (event) onEvent(event);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      // flush TextDecoder，避免多字节字符被留在 decoder 内；随后解析尾帧。
      buffer += decoder.decode();
      consumeFrames();
      // 某些边缘代理会在最后一帧后直接关闭连接，不补充 SSE 要求的空行。
      const tail = buffer.trim();
      if (tail) {
        const event = parseFrame(tail);
        if (event) onEvent(event);
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    consumeFrames();
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
): Promise<{
  code?: string;
  message?: string;
  refunded?: boolean;
  creditsBalance?: number;
  retryable?: boolean;
} | null> {
  try {
    const text = await res.text();
    return JSON.parse(text) as {
      code?: string;
      message?: string;
      refunded?: boolean;
      creditsBalance?: number;
      retryable?: boolean;
    };
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
