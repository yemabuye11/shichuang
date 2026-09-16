/**
 * 统一错误码与错误类型（与 `src/types/api.ts` 的 `GenerateErrorCode` 保持一致）。
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_CREDITS'
  | 'DAILY_LIMIT'
  | 'CONCURRENT_LIMIT'
  | 'MONTHLY_CAP'
  | 'MODEL_ERROR'
  | 'TOKEN_LIMIT'
  | 'TIMEOUT'
  | 'VALIDATE_FAILED'
  | 'STORE_FAILED'
  | 'CANCELLED'
  | 'NOT_ENABLED'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly refundable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { httpStatus?: number; retryable?: boolean; refundable?: boolean } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? STATUS[code] ?? 500;
    this.retryable = options.retryable ?? true;
    this.refundable = options.refundable ?? true;
  }
}

/** 错误码 → HTTP 状态码。 */
export const STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  INSUFFICIENT_CREDITS: 402,
  DAILY_LIMIT: 429,
  CONCURRENT_LIMIT: 429,
  MONTHLY_CAP: 503,
  MODEL_ERROR: 502,
  TOKEN_LIMIT: 502,
  TIMEOUT: 504,
  VALIDATE_FAILED: 422,
  STORE_FAILED: 500,
  CANCELLED: 499,
  NOT_ENABLED: 501,
  UNKNOWN: 500,
};

/**
 * 把任意异常规整为 `AppError`。
 *
 * @param err 捕获到的异常。
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err ?? '未知错误');
  return new AppError('MODEL_ERROR', message);
}

/**
 * 「供应商未启用」错误（用于 qwen / glm / doubao 未配置 Key 或尚未接入时）。
 */
export class NotEnabledError extends AppError {
  constructor(provider: string) {
    super('NOT_ENABLED', `模型供应商 ${provider} 暂未启用（缺少 API Key 或未接入）`, {
      httpStatus: 501,
      retryable: false,
    });
    this.name = 'NotEnabledError';
  }
}
