/**
 * DeepSeek 适配器（P0 默认供应商，OpenAI 兼容协议）。
 *
 * 密钥：`DEEPSEEK_API_KEY`，通过 `supabase secrets set` 注入。
 */

import { NotEnabledError } from '../errors.ts';
import { buildOpenAiRequest, parseOpenAiChunk, type AdapterContext, type BuiltRequest, type LlmAdapter, type LlmRequest, type ParsedChunk, type Pricing, type TokenUsage } from './types.ts';
import { computeCost } from './pricing.ts';

const DEFAULT_BASE = 'https://api.deepseek.com/v1';

export class DeepSeekAdapter implements LlmAdapter {
  readonly provider = 'deepseek' as const;

  isAvailable(): boolean {
    return (Deno.env.get('DEEPSEEK_API_KEY') ?? '').length > 0;
  }

  buildRequest(req: LlmRequest, ctx: AdapterContext): BuiltRequest {
    const apiKey = Deno.env.get('DEEPSEEK_API_KEY') ?? '';
    if (!apiKey) throw new NotEnabledError('deepseek');
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

export const deepseekAdapter = new DeepSeekAdapter();
