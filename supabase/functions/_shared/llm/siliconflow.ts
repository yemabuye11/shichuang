/**
 * 硅基流动（SiliconFlow）适配器 —— 备份 / 多模型源（OpenAI 兼容协议）。
 *
 * 一个 key 调 DeepSeek / Qwen / GLM 等全家，适合先用硅基流动额度、余额用完再切 DeepSeek。
 *
 * 协议：SiliconFlow 提供 OpenAI 兼容的 `/v1/chat/completions`，与 DeepSeek 完全一致，
 *       因此直接复用 `buildOpenAiRequest` / `parseOpenAiChunk`，改动最小。
 *
 * 密钥：`SILICONFLOW_API_KEY`（`supabase secrets set SILICONFLOW_API_KEY=sk-xxx`）。
 * 模型：model_profiles 里 provider='siliconflow' 的行决定具体 model_id（如硅基流动托管的 `deepseek-chat`）。
 */

import { NotEnabledError } from '../errors.ts';
import {
  buildOpenAiRequest,
  parseOpenAiChunk,
  type AdapterContext,
  type BuiltRequest,
  type LlmAdapter,
  type LlmRequest,
  type ParsedChunk,
  type Pricing,
  type TokenUsage,
} from './types.ts';
import { computeCost } from './pricing.ts';

const DEFAULT_BASE = 'https://api.siliconflow.cn/v1';

export class SiliconFlowAdapter implements LlmAdapter {
  readonly provider = 'siliconflow' as const;

  isAvailable(): boolean {
    return (Deno.env.get('SILICONFLOW_API_KEY') ?? '').length > 0;
  }

  buildRequest(req: LlmRequest, ctx: AdapterContext): BuiltRequest {
    const apiKey = Deno.env.get('SILICONFLOW_API_KEY') ?? '';
    if (!apiKey) throw new NotEnabledError('siliconflow');
    const base = (ctx.apiBase || DEFAULT_BASE).replace(/\/$/, '');
    return buildOpenAiRequest(req, ctx, {
      url: `${base}/chat/completions`,
      apiKey,
    });
  }

  parseChunk(raw: string): ParsedChunk | null {
    return parseOpenAiChunk(raw);
  }

  computeCost(usage: TokenUsage, pricing: Pricing, at: Date): number {
    return computeCost(usage, pricing, at);
  }
}

export const siliconflowAdapter = new SiliconFlowAdapter();
