/**
 * 积分规则常量（ARCHITECTURE.md §8.3）。
 *
 * 解耦原则：教师看到的永远是「积分」，按**应用类型**计价，与 token 无关。
 * 模型涨价只改 `model_profiles.pricing`，前端数字一个都不用动。
 */

/** 新用户注册赠送积分（可被 `system_config.credit.register_gift` 覆盖）。 */
export const REGISTER_GIFT = 100;

/** 每发布 1 个应用到广场的奖励积分。 */
export const PUBLISH_REWARD = 2;

/** 每日发布奖励上限。 */
export const PUBLISH_REWARD_DAILY_CAP = 10;

/** 单用户每日生成次数上限。 */
export const DAILY_GENERATION_LIMIT = 30;

/** 单次生成输入 token 上限（超出判失败并退还）。 */
export const MAX_INPUT_TOKENS = 8000;

/** 单次生成输出 token 上限（超出判失败并退还）。 */
export const MAX_OUTPUT_TOKENS = 8000;

/** 单文件 HTML 体积上限（200KB）。 */
export const MAX_HTML_BYTES = 204800;

/** 全局月度模型支出阀（元），可被 `system_config.limit.monthly_spend_cny` 覆盖。 */
export const MONTHLY_SPEND_CAP_CNY = 100;

/** `serve-app` 回源兜底的每日配额。 */
export const SERVE_FALLBACK_PER_DAY = 500;

/** 应用广场每页条数。 */
export const SQUARE_PAGE_SIZE = 24;

/**
 * 1 积分折算人民币的**内部对账**参考价。
 *
 * ⚠️ 该值**不得向教师展示**，仅用于管理员看板估算成本。
 */
export const CNY_PER_CREDIT = 0.05;

/** 生成中「代码流式区域」最大保留字符数（超出丢弃头部，防内存膨胀）。 */
export const MAX_STREAM_BUFFER_CHARS = 60000;

/** 生成阶段的展示顺序（UI-3 四阶段）。 */
export const GENERATION_STAGES = [
  { stage: 'understand', label: '理解教学需求' },
  { stage: 'design', label: '设计应用结构' },
  { stage: 'code', label: '编写应用代码' },
  { stage: 'verify', label: '自检与优化' },
] as const;

export type GenerationStageKey = (typeof GENERATION_STAGES)[number]['stage'];

/** 积分说明文案（一句话人话解释规则，UI-6 底部）。 */
export const CREDIT_RULE_TEXT = '1 积分 ≈ 1 次普通生成，复杂应用（游戏/动画）消耗更多。';

/** 余额不足时的引导文案（P0-F4）。 */
export const INSUFFICIENT_CREDITS_HINT = '可以用兑换码充值，或联系管理员为你加积分。';

/** 与「失败是否退还」相关的说明文案。 */
export const REFUND_POLICY_TEXT = '生成失败或中途取消，积分会全额退还，不用担心。';

/** 积分流水原因 → 中文名（UI-6 积分明细）。 */
export const LEDGER_REASON_LABEL: Record<string, string> = {
  register_gift: '新用户注册赠送',
  generate_spend: '生成应用消耗',
  generate_refund: '生成失败退还',
  redeem_code: '兑换码充值',
  admin_adjust: '管理员调整',
  publish_reward: '发布应用奖励',
  recharge_self: '自助充值到账',
  expire: '体验积分过期',
};

/**
 * 取积分流水原因的中文名。
 *
 * @param reason 流水原因枚举值。
 */
export function ledgerReasonLabel(reason: string): string {
  return LEDGER_REASON_LABEL[reason] ?? '积分变动';
}

/** 演示模式提示（顶部醒目提示条）。 */
export const DEMO_BANNER_TEXT = '当前为演示模式，未连接服务器：数据与生成结果均为本地示例';

/** 演示模式的补充说明。 */
export const DEMO_BANNER_DETAIL =
  '配置 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY 后会自动切换为真实服务';
