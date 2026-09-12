/**
 * 通义千问（Qwen）适配器 —— P0 第二供应商。
 *
 * 协议：DashScope **OpenAI 兼容模式**
 * `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`
 * 与 DeepSeek 完全一致，因此复用 OpenAI 兼容的解析与构造逻辑，改动最小。
 *
 * 密钥：`QWEN_API_KEY`（`supabase secrets set QWEN_API_KEY=sk-xxx`）。
 */

import { NotEnabledError } from '../errors.ts';
import { buildOpenAiRequest, parseOpenAiChunk, type AdapterContext, type BuiltRequest, type LlmAdapter, type LlmRequest, type ParsedChunk, type Pricing, type TokenUsage } from './types.ts';
import { computeCost } from './pricing.ts';

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export class QwenAdapter implements LlmAdapter {
  readonly provider = 'qwen' as const;

  isAvailable(): boolean {
    return (Deno.env.get('QWEN_API_KEY') ?? '').length > 0;
  }

  buildRequest(req: LlmRequest, ctx: AdapterContext): BuiltRequest {
    const apiKey = Deno.env.get('QWEN_API_KEY') ?? '';
    if (!apiKey) throw new NotEnabledError('qwen');
    const base = (ctx.apiBase || DEFAULT_BASE).replace(/\/$/, '');
    // 通义在兼容模式下通过 extra body 开启增量输出，与 OpenAI 语义一致
    return buildOpenAiRequest(req, ctx, {
      url: `${base}/chat/completions`,
      apiKey,
      extra: { incremental_output: true },
    });
  }

  parseChunk(raw: string): ParsedChunk | null {
    return parseOpenAiChunk(raw);
  }

  computeCost(usage: TokenUsage, pricing: Pricing, at: Date): number {
    return computeCost(usage, pricing, at);
  }
}

export const qwenAdapter = new QwenAdapter();
