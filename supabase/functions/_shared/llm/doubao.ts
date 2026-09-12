/**
 * 豆包（火山方舟 Doubao）适配器（**接入点已建，P0 默认未启用**）。
 *
 * 协议：火山方舟同样提供 OpenAI 兼容端点
 * `https://ark.cn-beijing.volces.com/api/v3/chat/completions`，
 * model 字段需填方舟的 Endpoint ID（在 `model_profiles.model_id` 配置）。
 *
 * 启用步骤：
 * 1. `supabase secrets set DOUBAO_API_KEY=<key>`；
 * 2. 在 `model_profiles` 表插入/启用一行（provider='doubao'）。
 *
 * 未配置 Key 时抛 `NotEnabledError`，上层会降级到其它可用供应商。
 */

import { NotEnabledError } from '../errors.ts';
import { buildOpenAiRequest, parseOpenAiChunk, type AdapterContext, type BuiltRequest, type LlmAdapter, type LlmRequest, type ParsedChunk, type Pricing, type TokenUsage } from './types.ts';
import { computeCost } from './pricing.ts';

const DEFAULT_BASE = 'https://ark.cn-beijing.volces.com/api/v3';

export class DoubaoAdapter implements LlmAdapter {
  readonly provider = 'doubao' as const;

  isAvailable(): boolean {
    return (Deno.env.get('DOUBAO_API_KEY') ?? '').length > 0;
  }

  buildRequest(req: LlmRequest, ctx: AdapterContext): BuiltRequest {
    const apiKey = Deno.env.get('DOUBAO_API_KEY') ?? '';
    if (!apiKey) throw new NotEnabledError('doubao');
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

export const doubaoAdapter = new DoubaoAdapter();
