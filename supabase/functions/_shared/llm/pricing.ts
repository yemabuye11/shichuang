/**
 * 峰谷系数与成本计算（ARCHITECTURE.md §1.1 D2 / PRD 4.1）。
 *
 * 高峰时段：**北京时间 9:00–12:00、14:00–18:00**（恰好是教师备课高峰，
 * 所以必须靠「积分解耦 + 全局月度上限」吸收波动）。
 */

import type { Pricing, TokenUsage } from './types.ts';

/** 高峰时段：北京时间 [起, 止)。 */
export const PEAK_WINDOWS: readonly { from: number; to: number }[] = [
  { from: 9, to: 12 },
  { from: 14, to: 18 },
];

/**
 * 判断给定时刻是否为高峰（按 Asia/Shanghai）。
 *
 * @param at 时刻。
 */
export function isPeak(at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: 'numeric',
      hour12: false,
    }).format(at),
  );
  return PEAK_WINDOWS.some((w) => hour >= w.from && hour < w.to);
}

/**
 * 计算一次调用的真实成本（元）。
 *
 * 公式：
 * ```
 * inputCost  = (cachedTokens * cachedInput + (promptTokens - cachedTokens) * input) / 1e6
 * outputCost = completionTokens * output / 1e6
 * cost       = (inputCost + outputCost) * (isPeak ? peakMultiplier : 1)
 * ```
 *
 * @param usage token 用量。
 * @param pricing 单价（元 / 百万 token）。
 * @param at 调用时刻。
 * @returns 成本（元，保留 6 位小数）。
 */
export function computeCost(usage: TokenUsage, pricing: Pricing, at: Date): number {
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const missed = Math.max(usage.promptTokens - cached, 0);

  const inputCost = (cached * pricing.cachedInput + missed * pricing.input) / 1_000_000;
  const outputCost = (usage.completionTokens * pricing.output) / 1_000_000;
  const multiplier = isPeak(at) ? Math.max(pricing.peakMultiplier, 1) : 1;

  return Number(((inputCost + outputCost) * multiplier).toFixed(6));
}

/**
 * 把 usage 规整为可记账的结构（缺失时按字符数估算）。
 *
 * @param raw 厂商返回的 usage。
 * @param fallbackText 输出文本（用于估算）。
 * @param fallbackPrompt 输入文本（用于估算）。
 */
export function normalizeUsage(
  raw: Partial<TokenUsage> | null | undefined,
  fallbackText: string,
  fallbackPrompt: string,
): TokenUsage {
  if (raw && (raw.promptTokens || raw.completionTokens)) {
    return {
      promptTokens: Number(raw.promptTokens ?? 0),
      completionTokens: Number(raw.completionTokens ?? 0),
      cachedTokens: Number(raw.cachedTokens ?? 0),
      estimated: raw.estimated === true,
    };
  }
  return {
    promptTokens: Math.ceil(fallbackPrompt.length / 1.6),
    completionTokens: Math.ceil(fallbackText.length / 1.6),
    cachedTokens: 0,
    estimated: true,
  };
}
