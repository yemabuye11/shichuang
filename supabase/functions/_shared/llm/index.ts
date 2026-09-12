/**
 * 大模型适配器注册与选择（ARCHITECTURE.md §3.6 Q3）。
 *
 * 选择顺序：
 * 1. `model_profiles.model_override`（按应用类型路由）/ 请求指定的 modelKey；
 * 2. 该 provider 的 Key 已配置 → 使用；
 * 3. 未配置 → 回落到默认模型（deepseek）；
 * 4. 仍不可用 → 任一家已配置 Key 的供应商；
 * 5. 一家都没有 → **MockAdapter**（保证链路可跑通，不产生费用）。
 */

import { deepseekAdapter } from './deepseek.ts';
import { qwenAdapter } from './qwen.ts';
import { glmAdapter } from './glm.ts';
import { doubaoAdapter } from './doubao.ts';
import { mockAdapter } from './mock.ts';
import type { LlmAdapter, LlmProvider } from './types.ts';

const REGISTRY = new Map<LlmProvider, LlmAdapter>([
  ['deepseek', deepseekAdapter],
  ['qwen', qwenAdapter],
  ['glm', glmAdapter],
  ['doubao', doubaoAdapter],
  ['mock', mockAdapter],
]);

/** 回退顺序：越靠前越优先。 */
const FALLBACK_ORDER: readonly LlmProvider[] = ['deepseek', 'qwen', 'glm', 'doubao'];

/**
 * 按 provider 取适配器；未注册时抛错。
 *
 * @param provider 供应商标识。
 */
export function getAdapter(provider: string): LlmAdapter {
  const key = (provider || 'deepseek') as LlmProvider;
  return REGISTRY.get(key) ?? deepseekAdapter;
}

/**
 * 选择一个**当前可用**的适配器（含降级链）。
 *
 * @param preferred 首选 provider。
 * @returns 适配器与其 provider。
 */
export function chooseAdapter(preferred?: string): { adapter: LlmAdapter; provider: LlmProvider } {
  const preferredKey = (preferred ?? 'deepseek') as LlmProvider;

  if (REGISTRY.has(preferredKey) && REGISTRY.get(preferredKey)!.isAvailable()) {
    return { adapter: REGISTRY.get(preferredKey)!, provider: preferredKey };
  }

  for (const key of FALLBACK_ORDER) {
    const adapter = REGISTRY.get(key);
    if (adapter?.isAvailable()) return { adapter, provider: key };
  }

  return { adapter: mockAdapter, provider: 'mock' };
}

/** 是否为 Mock 降级模式。 */
export function isMock(adapter: LlmAdapter): boolean {
  return adapter.provider === 'mock';
}

export { deepseekAdapter, qwenAdapter, glmAdapter, doubaoAdapter, mockAdapter };
export type { LlmAdapter, LlmProvider, LlmRequest, TokenUsage, Pricing } from './types.ts';
