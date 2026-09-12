/**
 * 智谱 GLM 适配器（**接入点已建，P0 默认未启用**）。
 *
 * 协议：智谱开放平台同样提供 OpenAI 兼容端点
 * `https://open.bigmodel.cn/api/paas/v4/chat/completions`。
 *
 * 本适配器代码已写全（与 deepseek 同为 OpenAI 兼容协议），但 **P0 默认不启用**：
 * 未配置 Key 时抛 `NotEnabledError`，上层会降级到其它可用供应商。
 *
 * 启用步骤：
 * 1. `supabase secrets set GLM_API_KEY=<key>`；
 * 2. 在 `model_profiles` 表插入/启用一行（provider='glm'，model_id 填 `glm-4` 等）。
 */

import { NotEnabledError } from '../errors.ts';
import { buildOpenAiRequest, parseOpenAiChunk, type AdapterContext, type BuiltRequest, type LlmAdapter, type LlmRequest, type ParsedChunk, type Pricing, type TokenUsage } from './types.ts';
import { computeCost } from './pricing.ts';

const DEFAULT_BASE = 'https://open.bigmodel.cn/api/paas/v4';

export class GlmAdapter implements LlmAdapter {
  readonly provider = 'glm' as const;

  isAvailable(): boolean {
    return (Deno.env.get('GLM_API_KEY') ?? '').length > 0;
  }

  buildRequest(req: LlmRequest, ctx: AdapterContext): BuiltRequest {
    const apiKey = Deno.env.get('GLM_API_KEY') ?? '';
    if (!apiKey) throw new NotEnabledError('glm');
    const base = (ctx.apiBase || DEFAULT_BASE).replace(/\/$/, '');
    return buildOpenAiRequest(req, ctx, { url: `${base}/chat/completions`, apiKey });
  }

  parseChunk(raw: string): ParsedChunk | null {
    return parseOpenAiChunk(raw);
  }

  computeCost(usage: TokenUsage, pricing: Pricing, at: Date): number {
    return computeCost(usage, pricing, at);
  }
}

export const glmAdapter = new GlmAdapter();
