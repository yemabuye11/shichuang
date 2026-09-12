/**
 * 平台侧成本记账（ARCHITECTURE.md §1.1 D2）。
 *
 * 职责：
 * - 按 `model_profiles.pricing` 计算真实成本（含峰谷系数）；
 * - 生成前校验是否超 `limit.monthly_spend_cny`；
 * - token 超限判失败（`MAX_INPUT_TOKENS` / `MAX_OUTPUT_TOKENS`）。
 *
 * 与教师看到的「积分」完全解耦：模型涨价只改 `model_profiles`，前端数字不动。
 */

import { adminClient } from './supabaseAdmin.ts';
import { AppError } from './errors.ts';
import { loadConfig } from './config.ts';
import { computeCost } from './llm/pricing.ts';
import type { Pricing, TokenUsage } from './llm/types.ts';

/** 当前周期（YYYY-MM，按北京时间）。 */
export function currentPeriod(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(at).slice(0, 7);
}

/**
 * 计算本次调用成本（元）。
 *
 * @param usage token 用量。
 * @param pricing 单价。
 * @param at 时刻。
 */
export function costOf(usage: TokenUsage, pricing: Pricing, at: Date = new Date()): number {
  return computeCost(usage, pricing, at);
}

/**
 * 检查 token 是否超限（超限应判失败并全额退还）。
 *
 * @param usage token 用量。
 * @param maxInput 输入上限。
 * @param maxOutput 输出上限。
 */
export function checkTokenLimit(usage: TokenUsage, maxInput: number, maxOutput: number): void {
  if (usage.promptTokens > maxInput) {
    throw new AppError(
      'TOKEN_LIMIT',
      `这次输入内容太长了（${usage.promptTokens} tokens，上限 ${maxInput}），试试把需求写得简洁一些`,
    );
  }
  if (usage.completionTokens > maxOutput) {
    throw new AppError(
      'TOKEN_LIMIT',
      `这次生成的内容太长了（${usage.completionTokens} tokens，上限 ${maxOutput}），试试减少关卡或题量`,
    );
  }
}

/**
 * 检查平台月度支出是否已超限。
 *
 * @throws {AppError} 超限时抛 `MONTHLY_CAP`。
 */
export async function assertUnderMonthlyCap(): Promise<void> {
  const cfg = await loadConfig();
  const cap = Number(cfg.limit.monthlySpendCny ?? 100);
  const period = currentPeriod();

  const sb = adminClient();
  const { data, error } = await sb
    .from('monthly_spend')
    .select('cost_cny')
    .eq('period', period)
    .maybeSingle();

  if (error) return; // 读取失败不阻断生成
  const spent = Number(data?.cost_cny ?? 0);
  if (spent >= cap) {
    throw new AppError('MONTHLY_CAP', '平台本月额度已用完，下月再来试试', { retryable: false });
  }
}
