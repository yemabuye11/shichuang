/**
 * 领域枚举（与 Postgres enum 逐字一致，ARCHITECTURE.md §8.5）。
 *
 * 注意：所有枚举值使用 snake_case，与数据库保持一致，避免前后端映射偏差。
 */

/** 应用类型：8 类 + 自动判断。 */
export type AppType =
  | 'auto'
  | 'teaching_animation'
  | 'edu_tool'
  | 'teaching_game'
  | 'interactive_courseware'
  | 'data_collection'
  | 'ai_item_generation'
  | 'ai_paper_composition'
  | 'ai_lesson_plan';

/** 应用发布状态。 */
export type AppStatus = 'draft' | 'published' | 'taken_down';

/** 应用 HTML 产物状态。 */
export type HtmlStatus = 'pending' | 'ready' | 'failed';

/** 生成任务状态。 */
export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * 积分流水原因（客户拍板口径）：
 * - `register_gift` 注册赠送
 * - `generate_spend` 生成消耗（生成前预扣）
 * - `generate_refund` 失败退还
 * - `redeem_code` 兑换码充值
 * - `admin_adjust` 管理员调整
 * - `publish_reward` 发布奖励
 */
export type LedgerReason =
  | 'register_gift'
  | 'generate_spend'
  | 'generate_refund'
  | 'redeem_code'
  | 'admin_adjust'
  | 'publish_reward'
  | 'recharge_self';

/** 兑换码类型：积分码 / 邀请码 / 套餐码。 */
export type RedemptionKind = 'credit' | 'invite' | 'membership';

/** 兑换码状态。 */
export type RedemptionStatus = 'unused' | 'used' | 'disabled';

/** 用户角色。 */
export type UserRole = 'user' | 'admin';

/** 用户状态。 */
export type UserStatus = 'active' | 'disabled';

/** 大模型供应商。 */
export type LlmProvider = 'deepseek' | 'qwen' | 'glm' | 'doubao' | 'mock';

/** 产物存储 provider。 */
export type ArtifactProvider = 'r2' | 'github_pages' | 'supabase_storage';

/** 举报状态。 */
export type ReportStatus = 'pending' | 'handled' | 'dismissed';

/** 数组常量：所有应用类型（供下拉/筛选遍历）。 */
export const APP_TYPE_VALUES: readonly AppType[] = [
  'auto',
  'teaching_animation',
  'edu_tool',
  'teaching_game',
  'interactive_courseware',
  'data_collection',
  'ai_item_generation',
  'ai_paper_composition',
  'ai_lesson_plan',
] as const;

/** 数组常量：所有积分流水原因。 */
export const LEDGER_REASON_VALUES: readonly LedgerReason[] = [
  'register_gift',
  'generate_spend',
  'generate_refund',
  'redeem_code',
  'admin_adjust',
  'publish_reward',
  'recharge_self',
] as const;

/**
 * 判断给定字符串是否为合法的应用类型。
 *
 * @param value 待校验的值。
 */
export function isAppType(value: unknown): value is AppType {
  return typeof value === 'string' && (APP_TYPE_VALUES as readonly string[]).includes(value);
}
