import type { AppType, HtmlStatus, JobStatus } from './enums';
import type { Category, DocType } from './doc';

/**
 * Edge Function 入参/出参契约（前后端共用，ARCHITECTURE.md §3.4）。
 *
 * `src/types/api.ts` 与 `supabase/functions/_shared/**` 中的类型必须保持同步；
 * 修改任一侧时请同步另一侧，否则 SSE 解析会出现静默错位。
 */

// ---------------------------------------------------------------------------
// EF-1 generate
// ---------------------------------------------------------------------------

/** `POST /functions/v1/generate` 请求体。 */
export interface GenerateRequest {
  /** 教师的自然语言需求。 */
  prompt: string;
  /** 应用类型（8 类之一或 auto；文档类请求也可填对应 doc type）。 */
  appType: AppType | DocType;
  /** T06：产物大类，'app'（单文件 HTML，默认）或 'doc'（结构化文档）。 */
  category?: Category;
  /** T06：文档类型（仅 category='doc' 时有效）。 */
  docType?: DocType;
  /** T06：教材版本 id（T07 回填用）。 */
  textbookVersionId?: string | null;
  /** T07：教材检索上下文（文本，由后端注入；前端可透传为空）。 */
  textbookContext?: string;
  /** 学科（选填）。 */
  subject?: string;
  /** 年级（选填）。 */
  grade?: string;
  /** 教材版本（选填）。 */
  textbook?: string;
  /** 课堂时长（选填）。 */
  duration?: string;
  /** 难度（选填）。 */
  difficulty?: string;
  /** 指定模型 key（可空 → 用默认）。 */
  modelKey?: string;
  /** 幂等键（前端生成的 UUID），防重复提交重复扣积分。 */
  idempotencyKey: string;
}

/** SSE `stage` 事件载荷。 */
export interface StageEvent {
  /** 阶段标识。 */
  stage: 'understand' | 'design' | 'code' | 'verify';
  /** 阶段中文名。 */
  label: string;
  /** 阶段状态。 */
  status: 'pending' | 'running' | 'done';
}

/** SSE `delta` 事件载荷（代码流式增量）。 */
export interface DeltaEvent {
  text: string;
}

/** SSE `heartbeat` 事件载荷（每 10s，防代理断连）。 */
export interface HeartbeatEvent {
  at: number;
}

/** SSE `done` 事件载荷。 */
export interface DoneEvent {
  jobId: string;
  appId: string;
  /** T06：文档类产物返回同一 id（与 appId 同值），便于路由。 */
  docId?: string;
  /** T06：产物大类。 */
  category?: Category;
  /** T06：文档类型。 */
  docType?: DocType;
  title: string;
  summary: string;
  /** 完整 HTML（前端写入 IndexedDB 后立即 Blob 渲染）。 */
  html: string;
  htmlUrl: string;
  htmlStatus: HtmlStatus;
  /** T06：文档渲染后的 Web 访问地址（平台壳渲染，非 iframe sandbox）。 */
  renderUrl?: string;
  /** T06：DocModel JSON 的 Storage 地址（平台 ThreeViewer / 编辑器读取）。 */
  docJsonUrl?: string;
  tokensIn: number;
  tokensOut: number;
  creditsCost: number;
  creditsBalance: number;
  model: string;
  promptVersion: string;
}

/** SSE `error` 事件载荷。 */
export interface ErrorEvent {
  code: GenerateErrorCode;
  message: string;
  /** 已退还的积分数（未退还为 0）。 */
  refunded: boolean;
  /** 退还后的余额。 */
  creditsBalance: number;
  /** 是否可重试。 */
  retryable: boolean;
}

/** 生成错误码（与 ARCHITECTURE.md §3.4 错误码表一致）。 */
export type GenerateErrorCode =
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_CREDITS'
  | 'DAILY_LIMIT'
  | 'CONCURRENT_LIMIT'
  | 'MONTHLY_CAP'
  | 'MODEL_ERROR'
  | 'TOKEN_LIMIT'
  | 'VALIDATE_FAILED'
  | 'STORE_FAILED'
  | 'CANCELLED'
  | 'NETWORK'
  | 'UNKNOWN';

/** SSE 事件联合类型。 */
export type GenEvent =
  | { type: 'stage'; data: StageEvent }
  | { type: 'delta'; data: DeltaEvent }
  | { type: 'heartbeat'; data: HeartbeatEvent }
  | { type: 'done'; data: DoneEvent }
  | { type: 'error'; data: ErrorEvent };

// ---------------------------------------------------------------------------
// EF-2 serve-app
// ---------------------------------------------------------------------------

/** `GET /functions/v1/serve-app?id=` 的查询参数。 */
export interface ServeAppQuery {
  appId: string;
}

// ---------------------------------------------------------------------------
// EF-3 track-view
// ---------------------------------------------------------------------------

/** `POST /functions/v1/track-view` 请求体。 */
export interface TrackViewRequest {
  appId: string;
}

/** `POST /functions/v1/track-view` 响应体。 */
export interface TrackViewResponse {
  counted: boolean;
  viewCount: number;
}

// ---------------------------------------------------------------------------
// Postgres 返回结构
// ---------------------------------------------------------------------------

/** `check_generation_allowed()` 返回。 */
export interface GenerationAllowedResult {
  allowed: boolean;
  code: GenerateErrorCode | '';
  message: string;
  remainingToday: number;
}

/** `reserve_credits()` 返回。 */
export interface ReserveCreditsResult {
  ok: boolean;
  balance: number;
  code: GenerateErrorCode | '';
}

/** `refund_generation()` 返回。 */
export interface RefundResult {
  refunded: boolean;
  balance: number;
}

/** `redeem_code()` 返回。 */
export interface RedeemResult {
  ok: boolean;
  code: string;
  credits: number;
  balance: number;
  message: string;
}

/** `publish_app()` 返回。 */
export interface PublishResult {
  ok: boolean;
  appId: string;
  rewardCredits: number;
  balance: number;
  message: string;
}

/** `toggle_like()` 返回。 */
export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

/** 通用操作结果。 */
export interface OkResult {
  ok: boolean;
  message?: string;
}
