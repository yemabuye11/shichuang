/**
 * 大模型适配器接口（ARCHITECTURE.md §3.6 Q3）。
 *
 * 设计要点：
 * - 模型 ID、单价、峰谷系数、积分换算全部读 `model_profiles` 表，**代码零硬编码**；
 * - 密钥只从 `Deno.env.get()` 读取，**永不写进日志**；
 * - P0 完整实现：deepseek + qwen（OpenAI 兼容协议，改动最小）；
 * - glm / doubao 建文件、同接口、未配置 Key 时抛 `NotEnabledError`；
 * - 任何一家 Key 都没配置 → 由 `index.ts` 自动降级为 `MockAdapter`。
 */

export type LlmProvider = 'deepseek' | 'siliconflow' | 'qwen' | 'glm' | 'doubao' | 'mock';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  /** 缓存命中的输入 token 数（DeepSeek 会返回）。 */
  cachedTokens: number;
  /** 是否返回了真实 usage（未返回时按字符数估算）。 */
  estimated: boolean;
}

export interface Pricing {
  input: number;
  cachedInput: number;
  output: number;
  peakMultiplier: number;
}

export interface LlmRequest {
  /** 固定前缀，逐字节稳定 → 命中上下文缓存。 */
  systemPrompt: string;
  /** 用户消息（结构化字段在这里，不在 system 里）。 */
  userPrompt: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ParsedChunk {
  text?: string;
  finish?: boolean;
  usage?: TokenUsage;
}

/**
 * 大模型适配器接口。
 *
 * 所有供应商实现必须满足该接口，新增供应商只需：
 * 1. 新建 `_shared/llm/<provider>.ts` 实现本接口；
 * 2. 在 `index.ts` 的 `REGISTRY` 里注册；
 * 3. 在 `model_profiles` 表插入一行配置 + `supabase secrets set <PROVIDER>_API_KEY`。
 */
export interface LlmAdapter {
  readonly provider: LlmProvider;
  /** 是否可用（一般取决于是否配置了 API Key）。 */
  isAvailable(): boolean;
  /** 构造 HTTP 请求。 */
  buildRequest(req: LlmRequest, ctx: AdapterContext): BuiltRequest;
  /** 解析一行 SSE 数据；返回 null 表示忽略（如 [DONE]）。 */
  parseChunk(raw: string): ParsedChunk | null;
  /** 按 token 用量计算真实成本（元），含峰谷系数。 */
  computeCost(usage: TokenUsage, pricing: Pricing, at: Date): number;
}

export interface AdapterContext {
  /** 厂商 API 的 model 字段。 */
  modelId: string;
  /** API 基地址（可为空，用适配器内置默认）。 */
  apiBase: string;
  /** 最大输出 token。 */
  maxOutputTokens: number;
  /** 是否开启流式。 */
  stream: boolean;
}

/** OpenAI 兼容协议的通用 SSE 解析（deepseek / qwen / doubao 复用）。 */
export function parseOpenAiChunk(raw: string): ParsedChunk | null {
  const line = raw.trim();
  if (line.length === 0) return null;
  if (line === '[DONE]') return { finish: true };
  if (!line.startsWith('data:')) return null;

  const payload = line.slice(5).trim();
  if (payload === '[DONE]') return { finish: true };

  try {
    const json = JSON.parse(payload) as {
      choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
      };
    };

    const text = json.choices?.[0]?.delta?.content ?? '';
    const finished = json.choices?.[0]?.finish_reason != null;

    let usage: TokenUsage | undefined;
    if (json.usage) {
      const prompt = Number(json.usage.prompt_tokens ?? 0);
      const completion = Number(json.usage.completion_tokens ?? 0);
      const hit = Number(json.usage.prompt_cache_hit_tokens ?? 0);
      usage = {
        promptTokens: prompt,
        completionTokens: completion,
        cachedTokens: hit,
        estimated: false,
      };
    }

    return {
      ...(text ? { text } : {}),
      ...(finished ? { finish: true } : {}),
      ...(usage ? { usage } : {}),
    };
  } catch {
    return null;
  }
}

/** 构造 OpenAI 兼容协议的请求体（deepseek / qwen / doubao 复用）。 */
export function buildOpenAiRequest(
  req: LlmRequest,
  ctx: AdapterContext,
  options: { url: string; apiKey: string; extra?: Record<string, unknown> },
): BuiltRequest {
  return {
    url: options.url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: {
      model: ctx.modelId,
      messages: [
        // ⚠️ system 必须是逐字节稳定的固定前缀，禁止插入时间戳/随机数/用户信息
        { role: 'system', content: req.systemPrompt },
        { role: 'user', content: req.userPrompt },
      ],
      stream: ctx.stream,
      max_tokens: ctx.maxOutputTokens,
      temperature: req.temperature,
      // 流式场景下让厂商回传 usage
      stream_options: ctx.stream ? { include_usage: true } : undefined,
      ...(options.extra ?? {}),
    },
  };
}

/**
 * 未拿到 usage 时按字符数粗估 token（中文约 1.5 字符/token）。
 *
 * @param text 文本。
 */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1.6));
}
