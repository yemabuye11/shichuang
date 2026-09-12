import type { GenerateErrorCode } from '@/types/api';

/**
 * 统一错误类型。
 *
 * 约定（ARCHITECTURE.md §8.6）：service 层统一抛 `AppError`，
 * 页面只负责把 `code` 交给 `errorText()` 映射成中文并展示。
 */
export class AppError extends Error {
  /** 机器可读的错误码。 */
  readonly code: GenerateErrorCode | string;
  /** 原始错误详情（仅用于调试与日志，不展示给教师）。 */
  readonly detail?: unknown;

  constructor(code: GenerateErrorCode | string, message?: string, detail?: unknown) {
    super(message ?? errorText(code as GenerateErrorCode));
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * 错误码 → 中文文案映射（ARCHITECTURE.md §8.4）。
 *
 * @param code 错误码。
 * @returns 面向教师的中文文案（全站简体中文，禁止英文混入）。
 */
export function errorText(code: GenerateErrorCode | string): string {
  switch (code) {
    case 'UNAUTHORIZED':
      return '登录状态已失效，请重新登录';
    case 'INSUFFICIENT_CREDITS':
      return '积分不足啦，可以用兑换码充值，或联系管理员';
    case 'DAILY_LIMIT':
      return '今天生成次数已达上限（30 次），明天再来吧';
    case 'CONCURRENT_LIMIT':
      return '你还有一个应用在生成中，请稍等一下';
    case 'MONTHLY_CAP':
      return '平台今日额度已用完，明天再来试试';
    case 'MODEL_ERROR':
      return 'AI 服务开小差了，本次不扣积分，点重试再来一次';
    case 'TOKEN_LIMIT':
      return '这次内容太长了，试试把需求写得简洁一些（不扣积分）';
    case 'VALIDATE_FAILED':
      return '这次没生成成功，已退还积分，点重试或换个说法';
    case 'STORE_FAILED':
      return '保存失败了，本次不扣积分，请重试';
    case 'CANCELLED':
      return '已取消生成，积分已退还';
    case 'NETWORK':
      return '网络好像不太稳定，请检查网络后重试';
    // ---- 兑换码 / 管理员 ----
    case 'INVALID_CODE':
      return '兑换码不存在，请检查后重试';
    case 'ALREADY_USED':
      return '这个兑换码已经被用过了';
    case 'EXPIRED':
      return '这个兑换码已过期';
    case 'DISABLED':
      return '这个兑换码已被停用，请联系管理员';
    case 'INVITE_REQUIRED':
      return '注册需要填写邀请码';
    case 'INVITE_INVALID':
      return '邀请码不正确，请向管理员索取';
    case 'INVITE_USED':
      return '这个邀请码已被使用';
    case 'INVITE_EXPIRED':
      return '这个邀请码已过期';
    case 'NOT_ENABLED':
      return '该登录方式暂未启用，请换一种方式';
    case 'FORBIDDEN':
      return '你还没有权限进行这个操作';
    default:
      return '出了点小问题，请稍后重试';
  }
}

/**
 * 把任意异常规整为 `AppError`。
 *
 * @param err 捕获到的任意异常。
 * @param fallbackCode 兜底错误码。
 */
export function toAppError(err: unknown, fallbackCode: GenerateErrorCode | string = 'UNKNOWN'): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError(fallbackCode, err.message, err);
  }
  return new AppError(fallbackCode, undefined, err);
}

/**
 * 从 Supabase / 触发器抛出的原始消息中识别业务错误码。
 *
 * Postgres 的 `raise exception 'xxx'` 文本会原样透传到 `error.message`，
 * 这里做一次前缀匹配，把中文/英文前缀映射回错误码。
 *
 * @param message 原始错误消息。
 */
export function codeFromMessage(message: string): GenerateErrorCode | string {
  if (!message) return 'UNKNOWN';
  if (message.includes('INVITE_REQUIRED') || message.includes('注册需要填写邀请码')) return 'INVITE_REQUIRED';
  if (message.includes('INVITE_INVALID') || message.includes('邀请码不正确')) return 'INVITE_INVALID';
  if (message.includes('INVITE_USED') || message.includes('邀请码已被使用')) return 'INVITE_USED';
  if (message.includes('INVITE_EXPIRED') || message.includes('邀请码已过期')) return 'INVITE_EXPIRED';
  if (message.includes('INSUFFICIENT_CREDITS') || message.includes('积分不足')) return 'INSUFFICIENT_CREDITS';
  if (message.includes('DAILY_LIMIT')) return 'DAILY_LIMIT';
  if (message.includes('CONCURRENT_LIMIT')) return 'CONCURRENT_LIMIT';
  if (message.includes('MONTHLY_CAP')) return 'MONTHLY_CAP';
  if (message.includes('UNAUTHORIZED') || message.includes('JWT')) return 'UNAUTHORIZED';
  if (message.includes('Failed to fetch') || message.includes('NetworkError')) return 'NETWORK';
  return 'UNKNOWN';
}
