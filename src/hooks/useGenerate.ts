import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as generateService from '@/services/generateService';
import * as artifactService from '@/services/artifactService';
import * as trackService from '@/services/trackService';
import { GENERATION_STAGES, MAX_STREAM_BUFFER_CHARS } from '@/config/creditRules';
import { errorText } from '@/services/http/errors';
import type {
  DoneEvent,
  ErrorEvent,
  GenerateRequest,
  GenEvent,
  StageEvent,
} from '@/types/api';

/**
 * 生成状态机（ARCHITECTURE.md §7 T04 第 5 条）。
 *
 * 状态流转：`idle → checking → streaming → verifying → storing → done | error | cancelled`。
 *
 * 设计要点：
 * - 状态放在**模块级单例**里，使「生成页 → 生成中页」路由跳转后状态不丢失，
 *   并且刷新 `/generating/:jobId` 时能从 sessionStorage 恢复请求继续展示；
 * - 组件只通过 `useGenerate()` 订阅快照，不直接持有 SSE 连接；
 * - SSE 事件语义与真实 Edge Function 完全一致，MOCK / 真实链路无需区分。
 */

export type GenerateStatus =
  | 'idle'
  | 'checking'
  | 'streaming'
  | 'verifying'
  | 'storing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface StageState {
  readonly stage: StageEvent['stage'];
  readonly label: string;
  readonly status: 'pending' | 'running' | 'done';
}

export interface GenerateSnapshot {
  readonly status: GenerateStatus;
  readonly jobId: string;
  readonly request: GenerateRequest | null;
  readonly stages: readonly StageState[];
  /** 流式累积的代码（超出 `MAX_STREAM_BUFFER_CHARS` 会丢弃头部）。 */
  readonly code: string;
  readonly chars: number;
  readonly result: DoneEvent | null;
  /** 多格式生成时累积的每一份结果（单格式时长度为 1）。 */
  readonly results: DoneEvent[];
  readonly error: ErrorEvent | null;
  readonly errorText: string;
  readonly startedAt: number;
  readonly elapsedMs: number;
}

/** 初始快照。doc 类生成额外插入 textbook_search 阶段。 */
function initialSnapshot(req?: GenerateRequest): GenerateSnapshot {
  const base = GENERATION_STAGES.map((s) => ({ stage: s.stage, label: s.label, status: 'pending' as const }));
  const stages: StageState[] =
    req?.category === 'doc' && req?.textbookVersionId ? insertTextbookStage(base) : base;
  return {
    status: 'idle',
    jobId: '',
    request: null,
    stages,
    code: '',
    chars: 0,
    result: null,
    results: [],
    error: null,
    errorText: '',
    startedAt: 0,
    elapsedMs: 0,
  };
}

/** 在 understand 之后插入 textbook_search 阶段（仅文档类生成）。 */
function insertTextbookStage(stages: StageState[]): StageState[] {
  const out: StageState[] = [];
  for (const s of stages) {
    out.push(s);
    if (s.stage === 'understand') {
      out.push({ stage: 'textbook_search', label: '检索教材内容', status: 'pending' });
    }
  }
  return out;
}

let snapshot: GenerateSnapshot = initialSnapshot();
const listeners = new Set<() => void>();
let session: generateService.GenerateSession | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
/** 是否收到过 done / error 终态事件，避免成功收尾时被 onFinish 误判成断流。 */
let terminalEventReceived = false;

/** 通知所有订阅者。 */
function emit(): void {
  for (const listener of listeners) listener();
}

/** 局部更新快照。 */
function patch(next: Partial<GenerateSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

/** 启动 / 停止计时器。 */
function startTimer(): void {
  stopTimer();
  elapsedTimer = setInterval(() => {
    if (snapshot.startedAt === 0) return;
    patch({ elapsedMs: Date.now() - snapshot.startedAt });
  }, 1000);
}

function stopTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

/** sessionStorage 键（用于刷新页面后恢复请求）。 */
const REQ_KEY_PREFIX = 'shichuang-gen-req-';

function saveRequest(jobId: string, req: GenerateRequest): void {
  try {
    globalThis.sessionStorage?.setItem(REQ_KEY_PREFIX + jobId, JSON.stringify(req));
  } catch {
    /* 忽略 */
  }
}

/** 任务进入终态后清理恢复数据，避免刷新失败页再次自动提交。 */
function removeRequest(jobId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(REQ_KEY_PREFIX + jobId);
  } catch {
    /* 忽略 */
  }
}

/** 读取（并消费）暂存的请求。 */
export function loadRequest(jobId: string): GenerateRequest | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(REQ_KEY_PREFIX + jobId);
    if (!raw) return null;
    return JSON.parse(raw) as GenerateRequest;
  } catch {
    return null;
  }
}

/** 处理一个 SSE 事件。 */
function handleEvent(event: GenEvent): void {
  switch (event.type) {
    case 'stage': {
      const incoming = event.data;
      const stages = snapshot.stages.map((s) =>
        s.stage === incoming.stage
          ? { ...s, label: incoming.label || s.label, status: incoming.status }
          : s,
      );
      const nextStatus: GenerateStatus =
        incoming.status !== 'done' && incoming.stage === 'code'
          ? 'streaming'
          : incoming.status !== 'done' && incoming.stage === 'verify'
            ? 'verifying'
            : snapshot.status;
      patch({ stages, status: nextStatus });
      break;
    }
    case 'delta': {
      const merged = snapshot.code + event.data.text;
      const code =
        merged.length > MAX_STREAM_BUFFER_CHARS ? merged.slice(merged.length - MAX_STREAM_BUFFER_CHARS) : merged;
      patch({
        code,
        chars: snapshot.chars + event.data.text.length,
        status: snapshot.status === 'checking' ? 'streaming' : snapshot.status,
      });
      break;
    }
    case 'heartbeat':
      // 心跳只用于保活，不改变状态
      break;
    case 'checkpoint': {
      // PPT 分段续跑：每段完成先更新可见进度，整份 done 到达前不结束任务。
      const stages = snapshot.stages.map((s) =>
        s.stage === 'code'
          ? {
              ...s,
              label: event.data.final
                ? '整份课件已合并'
                : `已完成第 ${event.data.part}/${event.data.totalParts} 段`,
              status: (event.data.final ? 'done' : 'running') as StageState['status'],
            }
          : s,
      );
      patch({
        stages,
        status: event.data.final ? 'storing' : 'streaming',
      });
      break;
    }
    case 'done': {
      terminalEventReceived = true;
      removeRequest(snapshot.jobId);
      const result = event.data;
      const nextResults = snapshot.results.some((r) => r.appId === result.appId)
        ? snapshot.results
        : [...snapshot.results, result];
      // 多格式生成时一个请求会收到多个 done；第一个之后的 done 不能把已完成的
      // 状态又打回 storing（避免 UI 闪烁回「生成中」）。
      patch({
        status: snapshot.status === 'done' ? 'done' : 'storing',
        results: nextResults,
        result: nextResults[0] ?? null,
      });
      void (async () => {
        try {
          await artifactService.saveLocal(result.appId, result.html, '', 1);
        } catch {
          /* 本地副本失败不影响主流程 */
        }
        patch({ status: 'done', elapsedMs: snapshot.startedAt ? Date.now() - snapshot.startedAt : 0 });
        trackService.track('generate_success', {
          appType: snapshot.request?.appType ?? 'auto',
          creditsCost: result.creditsCost,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        }, result.appId);
      })();
      break;
    }
    case 'error': {
      terminalEventReceived = true;
      removeRequest(snapshot.jobId);
      patch({
        status: event.data.code === 'CANCELLED' ? 'cancelled' : 'error',
        error: event.data,
        errorText: event.data.message || errorText(event.data.code),
      });
      trackService.track('generate_fail', { code: event.data.code, refunded: event.data.refunded });
      break;
    }
    default:
      break;
  }
}

/**
 * 发起一次生成。
 *
 * @param req 生成请求（必须含幂等键）。
 */
export function startGenerate(req: GenerateRequest): void {
  if (session && !session.finished) return;

  session?.cancel();
  snapshot = {
    ...initialSnapshot(req),
    status: 'checking',
    jobId: req.idempotencyKey,
    request: req,
    startedAt: Date.now(),
  };
  terminalEventReceived = false;
  emit();
  saveRequest(req.idempotencyKey, req);
  startTimer();
  trackService.track('generate_start', { appType: req.appType });

  session = generateService.startGenerate(req, {
    onEvent: handleEvent,
    onError: (err) => {
      removeRequest(snapshot.jobId);
      patch({
        status: 'error',
        errorText: err.message,
        error: {
          code: (err.code as ErrorEvent['code']) ?? 'UNKNOWN',
          message: err.message,
          refunded: true,
          creditsBalance: 0,
          retryable: true,
        },
      });
      stopTimer();
    },
    onFinish: () => {
      stopTimer();
      // Edge / 网关可能在未发送 done/error 的情况下关闭 SSE。此时必须把任务
      // 收尾，避免页面永久停在 63%。
      if (!terminalEventReceived && isGenerating()) {
        removeRequest(snapshot.jobId);
        patch({
          status: 'error',
          error: {
            code: 'NETWORK',
            message: '生成连接提前结束，积分会自动退还，请重试',
            refunded: true,
            creditsBalance: 0,
            retryable: true,
          },
          errorText: '生成连接提前结束，积分会自动退还，请重试',
          elapsedMs: snapshot.startedAt ? Date.now() - snapshot.startedAt : 0,
        });
      }
    },
  });
}

/** 取消生成（服务端会退还预扣积分）。 */
export function cancelGenerate(): void {
  session?.cancel();
  removeRequest(snapshot.jobId);
  stopTimer();
  patch({
    status: 'cancelled',
    error: {
      code: 'CANCELLED',
      message: '已取消生成，积分会退还',
      refunded: true,
      creditsBalance: 0,
      retryable: true,
    },
    errorText: '已取消生成，积分会退还',
    elapsedMs: snapshot.startedAt ? Date.now() - snapshot.startedAt : 0,
  });
  trackService.track('generate_fail', { code: 'CANCELLED', byUser: true });
}

/** 重置到初始状态（用于「再做一个」）。 */
export function resetGenerate(): void {
  session?.cancel();
  session = null;
  stopTimer();
  snapshot = initialSnapshot();
  terminalEventReceived = false;
  emit();
}

/** 读取当前快照（供 `useSyncExternalStore`）。 */
export function getGenerateSnapshot(): GenerateSnapshot {
  return snapshot;
}

/** 订阅快照变化。 */
export function subscribeGenerate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前是否正在生成中。 */
export function isGenerating(): boolean {
  return (
    snapshot.status === 'checking' ||
    snapshot.status === 'streaming' ||
    snapshot.status === 'verifying' ||
    snapshot.status === 'storing'
  );
}

/**
 * 估算剩余时间（毫秒）。
 *
 * 仅用于 UI 展示「预计还需 X 秒」——真实耗时由模型决定，
 * 这里的估值是保守上限，不会给教师「马上就好」的错觉。
 *
 * @param snap 当前快照。
 */
export function estimateRemainingMs(snap: GenerateSnapshot): number {
  if (snap.status === 'done') return 0;
  const target =
    snap.request?.category === 'doc' && snap.request.docType === 'ppt'
      ? 360_000
      : 45_000;
  const remaining = target - snap.elapsedMs;
  return remaining > 0 ? remaining : 3_000;
}

export interface UseGenerateResult {
  snapshot: GenerateSnapshot;
  /** 是否处于生成中（不含 done / error / cancelled）。 */
  generating: boolean;
  /** 发起生成。 */
  start: (req: GenerateRequest) => void;
  /** 取消生成。 */
  cancel: () => void;
  /** 重试（用同一份请求）。 */
  retry: () => void;
  /** 重置。 */
  reset: () => void;
}

/**
 * 订阅生成状态机。
 *
 * @returns 快照与操作句柄。
 */
export function useGenerate(): UseGenerateResult {
  const snap = useSyncExternalStore(subscribeGenerate, getGenerateSnapshot, getGenerateSnapshot);

  const start = useCallback((req: GenerateRequest) => {
    startGenerate(req);
  }, []);

  const cancel = useCallback(() => {
    cancelGenerate();
  }, []);

  const retry = useCallback(() => {
    const req = snapshot.request;
    if (!req) return;
    // 换一个幂等键，避免服务端把重试当成重复提交
    startGenerate({ ...req, idempotencyKey: cryptoRandomId() });
  }, []);

  const reset = useCallback(() => {
    resetGenerate();
  }, []);

  const generating = useMemo(
    () =>
      snap.status === 'checking' ||
      snap.status === 'streaming' ||
      snap.status === 'verifying' ||
      snap.status === 'storing',
    [snap.status],
  );

  return { snapshot: snap, generating, start, cancel, retry, reset };
}

/** 生成 UUID（优先 Web Crypto）。 */
function cryptoRandomId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 生成中页面的「恢复 + 结束副作用」hook。
 *
 * - 若刷新后状态机为空且任务仍未进入终态，尝试从 sessionStorage 恢复请求；
 * - 任务成功/失败/取消后会清理恢复数据，刷新终态页不会再次提交生成；
 * - 生成结束后触发 `onDone` / `onFailed` 回调（供页面刷新积分、跳转等）。
 *
 * @param jobId 路由上的任务 ID。
 * @param handlers 结束回调。
 */
export function useGenerateRun(
  jobId: string | undefined,
  handlers: { onDone?: (result: DoneEvent) => void; onFailed?: (err: ErrorEvent) => void } = {},
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!jobId) return;
    if (snapshot.status !== 'idle') return;
    const req = loadRequest(jobId);
    if (req) startGenerate(req);
  }, [jobId]);

  const lastStatus = useRef<GenerateStatus>('idle');

  useEffect(() => {
    if (lastStatus.current === snapshot.status) return;
    lastStatus.current = snapshot.status;
    if (snapshot.status === 'done' && snapshot.result) {
      handlersRef.current.onDone?.(snapshot.result);
    }
    if ((snapshot.status === 'error' || snapshot.status === 'cancelled') && snapshot.error) {
      handlersRef.current.onFailed?.(snapshot.error);
    }
  }, [snapshot.status, snapshot.result, snapshot.error]);
}

export default useGenerate;
