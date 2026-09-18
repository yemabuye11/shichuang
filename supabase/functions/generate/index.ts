/**
 * EF-1 `POST /functions/v1/generate` —— 生成应用 / 文档（SSE 流式）。
 *
 * 服务端流程（ARCHITECTURE.md §3.4，顺序不可颠倒）：
 * 1. 校验 JWT → 校验入参 → `check_generation_allowed()`（日限/并发/月度阀）
 * 2. 读 `app_type_profiles` 取 `credit_cost` → `reserve_credits()`（**先扣**）
 * 3. 创建 `generation_jobs(running)` + `apps(draft)`
 * 4. 拼装提示词 → 调模型（SSE 透传 `delta`）
 * 5. 校验产物；失败 → 携带错误信息重试 1 次
 * 6. 仍失败 → `refund_generation()` → 发 `error` 事件 → 结束
 * 7. 成功 → 写产物 → 预热 → 写影子副本 → 更新 `apps` → `settle_generation()` → 发 `done`
 *
 * T06 扩展：入参新增 `category`（默认 'app'）；当 `category='doc'` 时走文档分支——
 * 期望模型输出 DocModel JSON（而非 HTML），经 `validateDoc` 校验后：
 *   - 结构化 JSON 存 Storage（`doc_json_url`，守 500MB 红线）；
 *   - 经 `renderDoc` 渲染为自包含 Web HTML，发布到 `/d/` 路径；
 *   - SSE `done` 携带 { docId, renderUrl, docJsonUrl }。
 *
 * 安全红线：API Key 只从 `Deno.env.get()` 读取，绝不出现在日志与响应中。
 */

import { handleCors } from '../_shared/cors.ts';
import { SSE_HEADERS, jsonError } from '../_shared/json.ts';
import { AppError, toAppError } from '../_shared/errors.ts';
import { requireUser, type Caller } from '../_shared/auth.ts';
import { adminClient, userClient } from '../_shared/supabaseAdmin.ts';
import { loadAppType, loadConfig, loadModel } from '../_shared/config.ts';
import { compose, composeDoc, composeRepair } from '../_shared/prompt/compose.ts';
import { chooseAdapter, isMock } from '../_shared/llm/index.ts';
import { buildMockHtml, buildMockDoc } from '../_shared/llm/mock.ts';
import type { LlmRequest, TokenUsage } from '../_shared/llm/types.ts';
import { normalizeUsage } from '../_shared/llm/pricing.ts';
import { getStore, shadowStore } from '../_shared/store/index.ts';
import { extractTitle, validateHtml } from '../_shared/validateHtml.ts';
import {
  validateDoc,
  buildDocRepairPrompt,
  buildDocCompactRepairPrompt,
  MAX_DOC_BYTES,
} from '../_shared/doc/validate.ts';
import { renderDoc } from '../_shared/doc/render.ts';
import { isDocType, type DocModel } from '../_shared/doc/types.ts';
import { assertUnderMonthlyCap, checkTokenLimit, costOf, currentPeriod } from '../_shared/cost.ts';
import { getSearchAdapter } from '../_shared/search/index.ts';

/** 单次生成超时（毫秒）。 */
const MODEL_TIMEOUT_MS = 90_000;
/** 文档流等待首包 / 下一个增量的最大空闲时间。 */
const DOC_STREAM_IDLE_TIMEOUT_MS = 60_000;
/** 文档流从发起到收尾的总上限，给 16k 长 JSON 留出余量，同时为退款收尾预留时间。 */
const DOC_STREAM_MAX_TIMEOUT_MS = 130_000;
/** 心跳间隔（毫秒）。 */
const HEARTBEAT_MS = 10_000;
/**
 * 超过模型超时并留出少量收尾时间仍为 running 的任务视为孤儿任务。
 * 不能使用过长阈值，否则旧请求会在数据库里长期占住单用户并发锁。
 */
const STALE_JOB_TIMEOUT_MS = DOC_STREAM_MAX_TIMEOUT_MS + 15_000;

/** 文档模型流没有可靠 finish 帧时，用完整 JSON 作为收尾信号。 */
function isCompleteJsonObject(text: string): boolean {
  const candidate = text
    .trim()
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  if (candidate.length < 64 || !candidate.endsWith('}')) return false;
  try {
    const value = JSON.parse(candidate) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

/** 兼容 LF / CRLF 的上游 SSE 空行分隔。 */
function nextSseFrame(buffer: string): { frame: string; rest: string } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  if (!match || match.index === undefined) return null;
  return {
    frame: buffer.slice(0, match.index),
    rest: buffer.slice(match.index + match[0].length),
  };
}

/**
 * 「超范围需求」关键词：一次要生成整学期 / 全册 / 整个单元的内容。
 *
 * 背景（docs/QUALITY_BASELINE.md ③ 问题 1）：按次计费下，这类请求**不会**多烧钱
 * （输出被 maxOutputTokens 硬顶），但会有两种伤害体验的结局：
 *   A. JSON 被截断 → 校验失败 → 重试 → 仍失败 → 退款（教师白等 1~2 分钟）；
 *   B. 模型压缩成 20 行提纲塞进上限 → 校验通过、**正常扣积分** → 教师拿到"看起来成功了"的垃圾。
 * 与其让它跑到 B，不如**在扣积分之前就拦下来**，秒回中文提示。
 */
const OUT_OF_SCOPE_PATTERNS: readonly RegExp[] = [
  /整学[期年]/,
  /全[册本]?\s*(学[期年]|教材|课本)/,
  /整个?单元/,
  /全套/,
  /[一1]学期/,
  /所有课时/,
  /全部课时/,
  /[1-9]\d*\s*-\s*[1-9]\d*\s*课/,
];

/** 超范围时的中文提示（不扣积分，直接 422 返回）。 */
const OUT_OF_SCOPE_MESSAGE =
  '一次只能生成一节课（1 课时）的内容哦。请指定具体课时，例如「二次函数图像与性质 第1课时」，这样生成质量更高，也不浪费积分。';

/**
 * 校验积分预扣 RPC 的结果。
 *
 * Supabase RPC 同时返回 data/error 两个通道；只看 data 会把数据库函数
 * 冲突、权限或参数错误误报成“积分不足”。只有 RPC 明确返回
 * INSUFFICIENT_CREDITS 时才显示余额不足，其余情况保留为服务异常，便于排查。
 */
function describeRpcError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const raw = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    const parts = [raw.message, raw.details, raw.hint]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim());
    const code = typeof raw.code === 'string' && raw.code.trim() ? `[${raw.code.trim()}] ` : '';
    if (parts.length > 0) return `${code}${parts.join('；')}`;
  }
  return String(error ?? '未知错误');
}

function readReserveBalance(reserve: { data: unknown; error: unknown }): number {
  if (reserve.error) {
    const detail = describeRpcError(reserve.error);
    const safeDetail = detail.replace(/\s+/g, ' ').trim().slice(0, 180);
    throw new AppError(
      'UNKNOWN',
      safeDetail ? `积分服务暂时异常，请稍后重试（${safeDetail}）` : '积分服务暂时异常，请稍后重试',
      { refundable: false, retryable: true },
    );
  }

  const raw = (reserve.data ?? {}) as { ok?: boolean; balance?: number; code?: string; message?: string };
  if (raw.ok !== true) {
    const code = raw.code === 'INSUFFICIENT_CREDITS' ? 'INSUFFICIENT_CREDITS' : 'UNKNOWN';
    throw new AppError(
      code,
      code === 'INSUFFICIENT_CREDITS'
        ? '积分不足啦，可以用兑换码充值，或联系管理员'
        : raw.message || '积分服务暂时异常，请稍后重试',
      { refundable: false, retryable: code === 'UNKNOWN' },
    );
  }
  return Number(raw.balance ?? 0);
}

/** 将模型 HTTP 状态映射为可操作的提示，不把供应商原始响应直接回显给用户。 */
function modelErrorMessage(provider: string, status: number): string {
  const source = provider || '当前模型';
  if (status === 401 || status === 403) return `模型服务鉴权失败（${source}），请检查 API Key 配置`;
  if (status === 402) return `模型服务余额不足（${source}），请先为模型账户充值`;
  if (status === 429) return `模型服务繁忙（${source}），请稍后重试`;
  if (status >= 400 && status < 500) return `模型请求参数错误（${source}，HTTP ${status}）`;
  return `AI 服务暂时异常（${source}，HTTP ${status}），本次不扣积分`;
}

/** 任务行尚未写入时的兜底退款（例如幂等键冲突）。 */
async function refundOrphanReserve(opts: {
  userId: string;
  jobId: string;
  amount: number;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  const { error } = await adminClient().rpc('refund_orphan_generation', {
    p_user_id: opts.userId,
    p_job_id: opts.jobId,
    p_amount: opts.amount,
    p_error_code: opts.errorCode,
    p_error_message: opts.errorMessage,
  });
  if (error) console.error('[generate] 孤儿预扣退款失败：', error.message);
}

/**
 * 回收上一次请求异常断开后遗留的 running 任务。
 *
 * Edge Function 的整体超时/客户端断网可能绕过当前请求的 finally，
 * 令 generation_jobs 长时间保持 running，进而永久触发单用户并发限制。
 * 只处理超过服务端模型超时两倍以上的任务，并复用幂等退款 RPC，
 * 不影响仍在正常执行的生成。
 */
async function recoverStaleRunningJobs(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS).toISOString();
  const sb = adminClient();
  const { data, error } = await sb
    .from('generation_jobs')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .order('started_at', { ascending: true })
    .limit(3);

  if (error) {
    console.warn('[generate] 孤儿任务检查失败，继续按正常并发规则处理：', error.message);
    return;
  }

  for (const row of data ?? []) {
    const jobId = typeof row.id === 'string' ? row.id : '';
    if (!jobId) continue;
    const result = await sb.rpc('refund_generation', {
      p_job_id: jobId,
      p_error_code: 'TIMEOUT',
      p_error_message: '生成任务超过服务端超时时间，系统自动退款',
    });
    if (result.error) {
      console.warn('[generate] 孤儿任务退款失败：', result.error.message);
      // 退款 RPC 异常时仍必须释放并发锁；下次请求会再次按幂等 RPC 尝试退款。
      await sb
        .from('generation_jobs')
        .update({
          status: 'failed',
          error_code: 'TIMEOUT',
          error_message: '生成任务超过服务端超时时间，等待退款重试',
          finished_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('status', 'running');
    }
  }
}

/**
 * 判断需求是否超出「一次一课时」的范围。
 *
 * @param prompt 教师原始需求。
 */
function isOutOfScopePrompt(prompt: string): boolean {
  return OUT_OF_SCOPE_PATTERNS.some((re) => re.test(prompt));
}

interface GenerateBody {
  prompt?: string;
  appType?: string;
  /** T06：产物大类，'app'（默认，单文件 HTML）或 'doc'（结构化文档）。 */
  category?: string;
  /** T06：文档类型（仅 category='doc' 时有效）。 */
  docType?: string;
  /** 多格式勾选：文档类可一次生成多种格式，积分分开计算。 */
  docTypes?: string[];
  /** T09：生成成功后是否公开沉淀到内容市场（doc_library.is_public）。 */
  publishToLibrary?: boolean;
  /** 上传的参考模板正文（教师上传文本模板，截断后注入）。 */
  templateContent?: string;
  /** 参考公开课标题（注入提示词让内容更厚实）。 */
  referenceTitle?: string;
  /** 参考公开课来源。 */
  referenceSource?: string;
  /** T06：教材版本 id（T07 回填用）。 */
  textbookVersionId?: string | null;
  /** T07：教材检索上下文（文本，由后端注入；前端可透传为空）。 */
  textbookContext?: string;
  subject?: string;
  grade?: string;
  textbook?: string;
  duration?: string;
  difficulty?: string;
  modelKey?: string;
  idempotencyKey?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonError(405, { code: 'UNKNOWN', message: '请使用 POST 请求' });
  }

  let caller: Caller;
  let body: GenerateBody;
  try {
    caller = await requireUser(req);
    body = (await req.json()) as GenerateBody;
  } catch (err) {
    const e = toAppError(err);
    return jsonError(e.httpStatus, { code: e.code, message: e.message });
  }

  const prompt = (body.prompt ?? '').trim();
  if (prompt.length < 5) {
    return jsonError(422, { code: 'VALIDATE_FAILED', message: '请把需求写得更具体一些（至少 5 个字）' });
  }

  const category = body.category === 'doc' ? 'doc' : 'app';

  // ---- 范围护栏：一次只生成一课时（**在预扣积分之前**，命中不扣积分、秒回）----
  // 详见 docs/QUALITY_BASELINE.md ③ 问题 1：不拦的话会退化成"压缩成提纲却正常扣费"。
  if (category === 'doc' && isOutOfScopePrompt(prompt)) {
    return jsonError(422, { code: 'VALIDATE_FAILED', message: OUT_OF_SCOPE_MESSAGE });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let heartbeatTimer: number | undefined;
      let settled = false;
      let currentStage = 'starting';
      /** 当前任务 ID（预扣后设置，供失败时退还）。 */
      let currentJobId: string | null = null;

      const send = (event: string, data: unknown): void => {
        if (event === 'stage' && data && typeof data === 'object' && 'stage' in data) {
          currentStage = String((data as { stage?: unknown }).stage ?? currentStage);
        }
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* 流已关闭 */
        }
      };

      const heartbeat = (): void => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          /* 忽略 */
        }
      };

      const fail = async (err: unknown, jobId: string | null, reserved: number): Promise<void> => {
        const e = toAppError(err);
        let balance = 0;
        let refunded = false;
        if (jobId && e.refundable) {
          const sb = adminClient();
          const { data } = await sb.rpc('refund_generation', {
            p_job_id: jobId,
            p_error_code: e.code,
            p_error_message: e.message,
          });
          const raw = (data ?? {}) as { refunded?: boolean; balance?: number };
          refunded = raw.refunded === true;
          balance = Number(raw.balance ?? 0);
        }
        send('error', {
          code: e.code,
          message: e.message,
          refunded,
          creditsBalance: balance,
          retryable: e.retryable,
          jobId: jobId ?? undefined,
          stage: currentStage,
        });
        if (!settled) {
          settled = true;
          controller.close();
        }
      };

      try {
        heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
        const sb = adminClient();
        // 依赖 auth.uid() 的额度/并发 RPC 必须使用调用方 JWT；service_role
        // 客户端只适合可信写入，否则数据库会把调用者识别成匿名用户。
        const userSb = userClient(caller.token);

        // ---- 1. 生成前检查（日限 / 并发 / 月度阀）----
        await assertUnderMonthlyCap();
        await recoverStaleRunningJobs(caller.userId);
        const allowed = await userSb.rpc('check_generation_allowed');
        const allowedRaw = (allowed.data ?? {}) as { allowed?: boolean; code?: string; message?: string };
        if (allowedRaw.allowed === false) {
          throw new AppError(
            (allowedRaw.code ?? 'DAILY_LIMIT') as AppError['code'],
            allowedRaw.message ?? '暂时无法生成，请稍后再试',
            { retryable: false, refundable: false },
          );
        }

        // ---- 文档分支（category='doc'）----
        if (category === 'doc') {
          const rawFormats = Array.isArray(body.docTypes) ? body.docTypes.filter((x) => isDocType(x)) : [];
          const formats = rawFormats.length ? rawFormats : [isDocType(body.docType) ? body.docType : 'lesson_plan'];

          // 单次加载共享模型配置（文档类不因格式切换模型，以首个格式为准）。
          const firstTypeCfg = await loadAppType(formats[0]);
          const preferredKey = body.modelKey || firstTypeCfg?.modelOverride || undefined;
          const modelCfg = await loadModel(preferredKey);

          // ---- 2. 预算各格式积分，合并一次性预扣 ----
          // 野马需求：多格式勾选时积分分开计算（公开课教案？PPT？3D课件？各算各的）。
          let totalCost = 0;
          const perFormatCost: Record<string, number> = {};
          for (const f of formats) {
            const tc = await loadAppType(f);
            const c = tc?.creditCost ?? 1;
            perFormatCost[f] = c;
            totalCost += c;
          }

          const jobId = crypto.randomUUID();
          const idem = body.idempotencyKey ?? jobId;

          const reserve = await userSb.rpc('reserve_credits', {
            p_amount: totalCost,
            p_job_id: jobId,
            p_app_type: formats[0],
            p_model: modelCfg?.id ?? '',
          });
          const balanceAfterReserve = readReserveBalance(reserve);
          currentJobId = jobId;

          // T09：公开内容市场所需的作者昵称（Caller 无 nickname 字段，从 profiles 取）。
          // 失败不阻断主流程——昵称缺失只是市场展示少了作者名，不影响生成。
          let callerNickname = '';
          try {
            const { data: prof } = await adminClient()
              .from('profiles')
              .select('nickname')
              .eq('id', caller.userId)
              .single();
            callerNickname = prof?.nickname ?? '';
          } catch {
            callerNickname = '';
          }

          // 先创建可退款的 job；app_id 等 apps 草稿成功后再回填，避免外键指向不存在的占位 UUID。
          const firstAppId = crypto.randomUUID();
          const jobInsert = await sb.from('generation_jobs').insert({
            id: jobId,
            user_id: caller.userId,
            app_id: null,
            app_type: formats[0],
            model: modelCfg?.id ?? '',
            status: 'running',
            reserved_credits: totalCost,
            idempotency_key: idem,
          });
          if (jobInsert.error) {
            await refundOrphanReserve({
              userId: caller.userId,
              jobId,
              amount: totalCost,
              errorCode: 'STORE_FAILED',
              errorMessage: `生成任务创建失败：${jobInsert.error.message}`,
            });
            throw new AppError('STORE_FAILED', `生成任务创建失败：${jobInsert.error.message}`);
          }

          // ---- 4. 进度阶段事件（一次性发出，保持前端进度条工作）----
          send('stage', { stage: 'understand', label: '理解教学需求', status: 'running' });

          // ---- 4.5 教材检索阶段（一次性，跨格式共享）----
          let textbookContext = body.textbookContext ?? '';
          if (body.textbookVersionId) {
            send('stage', { stage: 'textbook_search', label: '检索教材内容', status: 'running' });
            try {
              const resolved = await resolveTextbookContext({
                versionId: body.textbookVersionId,
                chapter: body.textbookContext,
                sb,
              });
              textbookContext = resolved.context || textbookContext;
            } catch (searchErr) {
              // 检索链路整体兜底：继续生成，结果会由 composeDoc 的「待核对」硬约束标注
              console.warn('[generate:doc] 教材检索兜底，继续生成并标注待核对：', searchErr);
            }
            send('stage', { stage: 'textbook_search', label: '检索教材内容', status: 'done' });
          }

          send('stage', { stage: 'understand', label: '理解教学需求', status: 'done' });
          send('stage', { stage: 'design', label: '设计文档结构', status: 'done' });
          send('stage', { stage: 'code', label: '生成文档内容', status: 'running' });

          // 共享的模型调用上下文（所有格式复用同一模型 / 适配器）。
          const { adapter, provider } = chooseAdapter(modelCfg?.provider);
          // 首选模型没有密钥而发生 provider 降级时，不能继续携带首选模型的 API 地址。
          // 例如 deepseek 配置降级到 siliconflow，必须让适配器使用自己的默认 endpoint。
          const selectedApiBase = provider === modelCfg?.provider ? (modelCfg?.apiBase ?? '') : '';
          const isMockFlag = isMock(adapter);
          const cfg = await loadConfig();
          const maxOutput = Number(cfg.limit.maxOutputTokens ?? modelCfg?.maxOutputTokens ?? 8000);
          /** loadAppType 的解析后返回类型（避免额外 import）。 */
          type AppTypeCfg = Awaited<ReturnType<typeof loadAppType>>;

          /**
           * 单个文档格式的生成：composeDoc → 调模型 → 校验/修复 → 写产物 → 更新 apps → 沉淀 → 发 done。
           *
           * 任何一步失败都会向上抛出，由外层 catch 触发 `refund_generation(jobId)` 整体退还。
           *
           * @param f 文档格式（如 'lesson_plan' / 'ppt' / 'courseware_3d'）。
           * @param appId 本次格式对应的 apps 行 id。
           * @param typeCfg 该格式的应用类型配置（取 promptKey / 兜底）。
           * @param perCost 该格式单价（积分）。
           * @returns 累计到 job 的 token / 成本 / 耗时。
           */
          async function generateDocFormat(
            f: string,
            appId: string,
            typeCfg: AppTypeCfg,
            perCost: number,
          ): Promise<{ tokensIn: number; tokensOut: number; costCny: number; ms: number }> {
            // 该格式的 apps 草稿行（与单格式逻辑一致：doc_type / credits_cost / 其他字段）。
            const appInsert = await sb.from('apps').insert({
              id: appId,
              author_id: caller.userId,
              title: prompt.slice(0, 40),
              prompt_raw: prompt,
              app_type: f,
              category: 'doc',
              doc_type: f,
              subject: body.subject ?? '',
              grade: body.grade ?? '',
              textbook: body.textbook ?? '',
              duration: body.duration ?? '',
              difficulty: body.difficulty ?? '',
              textbook_version_id: body.textbookVersionId ?? null,
              status: 'draft',
              html_status: 'pending',
              credits_cost: perCost,
            });
            if (appInsert.error) {
              throw new AppError('STORE_FAILED', `文档草稿保存失败：${appInsert.error.message}`);
            }
            if (appId === firstDoneAppId) {
              const attachJob = await sb
                .from('generation_jobs')
                .update({ app_id: appId })
                .eq('id', jobId);
              if (attachJob.error) {
                throw new AppError('STORE_FAILED', `生成任务关联失败：${attachJob.error.message}`);
              }
            }

            // ---- 4. 拼装本格式提示词（含模板 / 参考课例注入）----
            const composed = await composeDoc({
              docType: f,
              promptKey: typeCfg?.promptKey ?? '',
              prompt,
              subject: body.subject,
              grade: body.grade,
              textbook: body.textbook,
              duration: body.duration,
              difficulty: body.difficulty,
              textbookContext,
              templateContent: body.templateContent,
              referenceTitle: body.referenceTitle,
              referenceSource: body.referenceSource,
            });
            await sb
              .from('generation_jobs')
              .update({ prompt_version: composed.promptVersion })
              .eq('id', jobId);

            // ---- 5. 调模型（文档类流式收集完整 JSON）----
            const llmReq: LlmRequest = {
              systemPrompt: composed.systemPrompt,
              userPrompt: composed.userPrompt,
              maxOutputTokens: maxOutput,
              temperature: 0.7,
            };

            const startedAt = Date.now();
            let raw = '';
            let finishReason = '';
            let usage: TokenUsage = {
              promptTokens: 0,
              completionTokens: 0,
              cachedTokens: 0,
              estimated: true,
            };

            if (isMockFlag) {
              const docJson = buildMockDoc(f, prompt);
              const chunk = 240;
              for (let i = 0; i < docJson.length; i += chunk) {
                send('delta', { text: docJson.slice(i, i + chunk) });
                raw += docJson.slice(i, i + chunk);
              }
              usage = normalizeUsage(null, docJson, composed.systemPrompt + composed.userPrompt);
            } else {
              // 文档必须流式收集：首个 token 就反馈到页面，避免非流式请求在
              // 模型写长 JSON 时一直显示 0 B；同时以空闲超时和总超时双重兜底。
              const called = await callDocStreaming(
                adapter,
                { ...llmReq, userPrompt: composed.userPrompt },
                {
                  modelId: modelCfg?.modelId ?? 'deepseek-chat',
                  apiBase: selectedApiBase,
                  maxOutputTokens: maxOutput,
                },
                (text) => send('delta', { text }),
              );
              raw = called.content;
              finishReason = called.finishReason;
              usage = called.usage ??
                normalizeUsage(null, raw, composed.systemPrompt + composed.userPrompt);
            }

            // ---- 6. 校验 + 重试 1 次 ----
            let result = validateDoc(raw, MAX_DOC_BYTES);
            if (!result.ok && !isMockFlag) {
              const truncated =
                finishReason === 'length' ||
                isProbablyTruncatedDoc(raw);
              const repairPrompt = truncated
                ? buildDocCompactRepairPrompt(composed.userPrompt, result.errors)
                : buildDocRepairPrompt(composed.userPrompt, result.errors);
              const repaired = await callOnce(adapter, {
                ...llmReq,
                userPrompt: repairPrompt,
              }, {
                modelId: modelCfg?.modelId ?? 'deepseek-chat',
                apiBase: selectedApiBase,
                maxOutputTokens: maxOutput,
                stream: false,
              });
              raw = repaired.content;
              finishReason = repaired.finishReason;
              if (repaired.usage) usage = repaired.usage;
              result = validateDoc(raw, MAX_DOC_BYTES);
            }

            if (!result.ok || !result.model) {
              send('stage', { stage: 'verify', label: '自检与优化', status: 'failed' });
              if (finishReason === 'length' || isProbablyTruncatedDoc(raw)) {
                throw new AppError(
                  'TOKEN_LIMIT',
                  '这次内容超过模型单次输出上限，已退还积分。请减少页数，或拆成两份分别生成',
                );
              }
              throw new AppError('VALIDATE_FAILED', '这次没生成成功，已退还积分，点重试或换个说法');
            }

            // ---- 7. 写产物：DocModel JSON + 渲染 HTML ----
            const generatedAt = new Date().toISOString();
            const finalModel = {
              ...result.model,
              id: appId,
              version: result.model.version && result.model.version > 0 ? result.model.version : 1,
              createdAt: result.model.createdAt ?? generatedAt,
            };
            const json = JSON.stringify(finalModel);
            const store = await getStore();
            const putJson = await store.putDocJson(appId, finalModel.version, json);
            const html = renderDoc(finalModel);
            const putHtml = await store.putDocHtml(appId, finalModel.version, html);

            if (cfg.artifact.warmup) void store.warmup(putHtml.url);
            // 影子副本（供 serve-app /d/ 回源兜底）
            void shadowStore.putDocHtml(appId, finalModel.version, html).catch(() => undefined);
            void shadowStore.putDocJson(appId, finalModel.version, json).catch(() => undefined);

            const title = finalModel.meta?.title || prompt.slice(0, 30);
            const appUpdate = await sb
              .from('apps')
              .update({
                title,
                category: 'doc',
                doc_type: f,
                doc_json_url: putJson.url,
                doc_version: finalModel.version,
                verify_status: finalModel.verifyHints && finalModel.verifyHints.length > 0 ? 'partial' : 'pending',
                html_url: putHtml.url,
                html_status: putHtml.readyNow ? 'ready' : 'pending',
                html_size_bytes: putHtml.sizeBytes,
                html_sha256: putHtml.sha256,
                html_version: finalModel.version,
                model: isMockFlag ? 'mock' : (modelCfg?.id ?? ''),
                tokens_in: usage.promptTokens,
                tokens_out: usage.completionTokens,
                generation_ms: Date.now() - startedAt,
                cover_seed: putHtml.sha256.slice(0, 16),
              })
              .eq('id', appId);
            if (appUpdate.error) {
              throw new AppError('STORE_FAILED', `文档结果保存失败：${appUpdate.error.message}`);
            }

            // ---- 生成即沉淀（BR-014/015）：写入 doc_library，为后续 Skill 提炼降本备料 ----
            // T09：按入参 publishToLibrary 决定是否公开；公开时写入作者昵称与标题快照，供内容市场展示。
            // 失败不影响主流程（沉淀是异步收益，不能因为它退还一次成功的生成）。
            // 固化下载定价：公开内容由调用方把 app_type_profiles.credit_cost 写入 download_credits，
            // 让内容市场列表直接展示价格，无需回查配置表。
            let downloadCredits = 0;
            try {
              const { data: costProf } = await adminClient()
                .from('app_type_profiles')
                .select('credit_cost')
                .eq('app_type', f)
                .single();
              downloadCredits = Number(costProf?.credit_cost ?? 0);
            } catch {
              downloadCredits = 0;
            }
            void sb
              .rpc('deposit_doc_library', {
                p_doc_id: appId,
                p_owner_id: caller.userId,
                p_category: 'doc',
                p_doc_type: f,
                p_subject: finalModel.meta?.subject ?? body.subject ?? '',
                p_grade: finalModel.meta?.grade ?? body.grade ?? '',
                p_textbook_version_id: body.textbookVersionId ?? null,
                p_keywords: deriveKeywords(finalModel, f, body),
                p_is_public: body.publishToLibrary ?? false,
                p_owner_nickname: callerNickname,
                p_title: finalModel.meta?.title ?? prompt.slice(0, 40),
                p_download_credits: downloadCredits,
              })
              .then(() => undefined)
              .catch(() => undefined);

            const costCny = isMockFlag
              ? 0
              : costOf(
                usage,
                modelCfg?.pricing ?? { input: 1.5, cachedInput: 0.05, output: 4.5, peakMultiplier: 2 },
                new Date(startedAt),
              );
            const ms = Date.now() - startedAt;

            send('done', {
              jobId,
              appId,
              docId: appId,
              category: 'doc',
              docType: f,
              title,
              summary: prompt.slice(0, 60),
              renderUrl: putHtml.url,
              docJsonUrl: putJson.url,
              htmlStatus: putHtml.readyNow ? 'ready' : 'pending',
              tokensIn: usage.promptTokens,
              tokensOut: usage.completionTokens,
              creditsCost: perCost,
              creditsBalance: balanceAfterReserve,
              model: isMockFlag ? 'mock' : (modelCfg?.id ?? ''),
              promptVersion: composed.promptVersion,
            });

            return { tokensIn: usage.promptTokens, tokensOut: usage.completionTokens, costCny, ms };
          }

          // ---- 5/7. 逐个格式生成，结束后一次性结算 ----
          let totalIn = 0;
          let totalOut = 0;
          let totalCny = 0;
          let totalMs = 0;
          let firstDoneAppId = firstAppId;
          for (let i = 0; i < formats.length; i++) {
            const f = formats[i];
            const appId = crypto.randomUUID();
            if (i === 0) firstDoneAppId = appId;
            const typeCfg = await loadAppType(f);
            const { tokensIn, tokensOut, costCny, ms } = await generateDocFormat(
              f,
              appId,
              typeCfg,
              perFormatCost[f] ?? 1,
            );
            totalIn += tokensIn;
            totalOut += tokensOut;
            totalCny += costCny;
            totalMs += ms;
          }

          send('stage', { stage: 'code', label: '生成文档内容', status: 'done' });
          send('stage', { stage: 'verify', label: '自检与优化', status: 'done' });

          // ---- 7. 单次结算（覆盖所有格式累计 token / 成本）----
          await sb.rpc('settle_generation', {
            p_job_id: jobId,
            p_tokens_in: totalIn,
            p_tokens_out: totalOut,
            p_cost_cny: totalCny,
            p_model: isMockFlag ? 'mock' : (modelCfg?.id ?? ''),
            p_app_id: firstDoneAppId,
            p_ms: totalMs,
          });

          void sb
            .from('events')
            .insert({
              name: 'generate_doc_success',
              user_id: caller.userId,
              app_id: firstDoneAppId,
              props: { docType: formats.join(','), model: modelCfg?.id ?? provider, period: currentPeriod(), formats },
            })
            .then(() => undefined)
            .catch(() => undefined);

          return;
        }

        // ---- 应用分支（category='app'，原有逻辑）----
        const appType = body.appType ?? 'auto';
        const typeCfg = await loadAppType(appType);
        const creditCost = typeCfg?.creditCost ?? 1;
        const preferredKey = body.modelKey || typeCfg?.modelOverride || undefined;
        const modelCfg = await loadModel(preferredKey);

        // ---- 3. 预扣积分（先扣，失败退还）----
        const jobId = crypto.randomUUID();
        const appId = crypto.randomUUID();
        const idem = body.idempotencyKey ?? jobId;

        const reserve = await userSb.rpc('reserve_credits', {
          p_amount: creditCost,
          p_job_id: jobId,
          p_app_type: appType,
          p_model: modelCfg?.id ?? '',
        });
        const balanceAfterReserve = readReserveBalance(reserve);
        currentJobId = jobId;

        // 先创建 job（app_id 暂空），保证后续草稿/模型失败时能按 job 退款。
        const jobInsert = await sb.from('generation_jobs').insert({
          id: jobId,
          user_id: caller.userId,
          app_id: null,
          app_type: appType,
          model: modelCfg?.id ?? '',
          status: 'running',
          reserved_credits: creditCost,
          idempotency_key: idem,
        });
        if (jobInsert.error) {
          await refundOrphanReserve({
            userId: caller.userId,
            jobId,
            amount: creditCost,
            errorCode: 'STORE_FAILED',
            errorMessage: `生成任务创建失败：${jobInsert.error.message}`,
          });
          throw new AppError('STORE_FAILED', `生成任务创建失败：${jobInsert.error.message}`);
        }
        const appInsert = await sb.from('apps').insert({
          id: appId,
          author_id: caller.userId,
          title: prompt.slice(0, 40),
          prompt_raw: prompt,
          app_type: appType,
          subject: body.subject ?? '',
          grade: body.grade ?? '',
          textbook: body.textbook ?? '',
          duration: body.duration ?? '',
          difficulty: body.difficulty ?? '',
          status: 'draft',
          html_status: 'pending',
          credits_cost: creditCost,
        });
        if (appInsert.error) {
          throw new AppError('STORE_FAILED', `应用草稿保存失败：${appInsert.error.message}`);
        }
        const attachJob = await sb
          .from('generation_jobs')
          .update({ app_id: appId })
          .eq('id', jobId);
        if (attachJob.error) {
          throw new AppError('STORE_FAILED', `生成任务关联失败：${attachJob.error.message}`);
        }

        // ---- 4. 拼装提示词 ----
        send('stage', { stage: 'understand', label: '理解教学需求', status: 'running' });
        const composed = await compose({
          appType,
          promptKey: typeCfg?.promptKey ?? '',
          prompt,
          subject: body.subject,
          grade: body.grade,
          textbook: body.textbook,
          duration: body.duration,
          difficulty: body.difficulty,
        });
        await sb
          .from('generation_jobs')
          .update({ prompt_version: composed.promptVersion })
          .eq('id', jobId);
        send('stage', { stage: 'understand', label: '理解教学需求', status: 'done' });
        send('stage', { stage: 'design', label: '设计应用结构', status: 'done' });
        send('stage', { stage: 'code', label: '编写应用代码', status: 'running' });

        // ---- 5. 调模型（SSE 透传）----
        const { adapter, provider } = chooseAdapter(modelCfg?.provider);
        const selectedApiBase = provider === modelCfg?.provider ? (modelCfg?.apiBase ?? '') : '';
        const cfg = await loadConfig();
        const maxOutput = Number(cfg.limit.maxOutputTokens ?? modelCfg?.maxOutputTokens ?? 8000);
        const maxHtmlBytes = Number(cfg.limit.maxHtmlBytes ?? 204800);

        const llmReq: LlmRequest = {
          systemPrompt: composed.systemPrompt,
          userPrompt: composed.userPrompt,
          maxOutputTokens: maxOutput,
          temperature: 0.7,
        };

        const startedAt = Date.now();
        let raw = '';
        let usage: TokenUsage = {
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          estimated: true,
        };

        if (isMock(adapter)) {
          // 无 Key 降级：分块吐出示例应用，帧格式与真实模型一致
          const html = buildMockHtml(prompt);
          const chunk = 240;
          for (let i = 0; i < html.length; i += chunk) {
            send('delta', { text: html.slice(i, i + chunk) });
            raw += html.slice(i, i + chunk);
          }
          usage = normalizeUsage(null, html, composed.systemPrompt + composed.userPrompt);
        } else {
          const ctx = {
            modelId: modelCfg?.modelId ?? 'deepseek-chat',
            apiBase: selectedApiBase,
            maxOutputTokens: maxOutput,
            stream: true,
          };
          const built = adapter.buildRequest(llmReq, ctx);

          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), MODEL_TIMEOUT_MS);
          let res: Response;
          try {
            res = await fetch(built.url, {
              method: 'POST',
              headers: built.headers,
              body: JSON.stringify(built.body),
              signal: ac.signal,
            });
          } finally {
            clearTimeout(timer);
          }

          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => '');
            // ⚠️ 只记录状态码，绝不记录请求头（含 Authorization）
            console.error(`[generate] 模型返回 ${res.status}`);
            void text;
            throw new AppError('MODEL_ERROR', modelErrorMessage(provider, res.status));
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const streamTimer = setTimeout(() => ac.abort(), MODEL_TIMEOUT_MS);
          let providerFinished = false;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let next = nextSseFrame(buffer);
              while (next) {
                const frame = next.frame;
                buffer = next.rest;
                for (const line of frame.split('\n')) {
                  const parsed = adapter.parseChunk(line);
                  if (!parsed) continue;
                  if (parsed.text) {
                    raw += parsed.text;
                    send('delta', { text: parsed.text });
                  }
                  if (parsed.usage) usage = parsed.usage;
                  if (parsed.finish) {
                    providerFinished = true;
                    break;
                  }
                }
                if (providerFinished) break;
                next = nextSseFrame(buffer);
              }
              if (providerFinished) {
                await reader.cancel().catch(() => undefined);
                break;
              }
            }
          } finally {
            clearTimeout(streamTimer);
          }
          if (usage.promptTokens === 0) {
            usage = normalizeUsage(null, raw, composed.systemPrompt + composed.userPrompt);
          }
        }

        // ---- 6. 校验 + 重试 1 次 ----
        send('stage', { stage: 'code', label: '编写应用代码', status: 'done' });
        send('stage', { stage: 'verify', label: '自检与优化', status: 'running' });

        let result = validateHtml(raw, maxHtmlBytes);
        if (!result.ok && !isMock(adapter)) {
          const repairPrompt = await composeRepair(composed.userPrompt, result.errors);
          raw = (await callOnce(adapter, {
            ...llmReq,
            userPrompt: repairPrompt,
          }, {
            modelId: modelCfg?.modelId ?? 'deepseek-chat',
            apiBase: selectedApiBase,
            maxOutputTokens: maxOutput,
            stream: false,
          })).content;
          result = validateHtml(raw, maxHtmlBytes);
        }

        if (!result.ok) {
          send('stage', { stage: 'verify', label: '自检与优化', status: 'failed' });
          throw new AppError('VALIDATE_FAILED', '这次没生成成功，已退还积分，点重试或换个说法');
        }

        // ---- 7. token 上限与成本 ----
        checkTokenLimit(
          usage,
          Number(cfg.limit.maxInputTokens ?? 8000),
          Number(cfg.limit.maxOutputTokens ?? 8000),
        );
        const pricing = modelCfg?.pricing ?? { input: 1.5, cachedInput: 0.05, output: 4.5, peakMultiplier: 2 };
        const costCny = isMock(adapter) ? 0 : costOf(usage, pricing, new Date(startedAt));
        const generationMs = Date.now() - startedAt;

        // ---- 8. 写产物 ----
        const html = result.html;
        const store = await getStore();
        const put = await store.putAppHtml(appId, 1, html);
        if (cfg.artifact.warmup) void store.warmup(put.url);
        // 影子副本（供 serve-app 回源兜底）
        void shadowStore.putAppHtml(appId, 1, html).catch(() => undefined);

        const title = extractTitle(html) || prompt.slice(0, 30);
        const appUpdate = await sb
          .from('apps')
          .update({
            title,
            html_url: put.url,
            html_status: put.readyNow ? 'ready' : 'pending',
            html_size_bytes: put.sizeBytes,
            html_sha256: put.sha256,
            html_version: 1,
            model: isMock(adapter) ? 'mock' : (modelCfg?.id ?? ''),
            tokens_in: usage.promptTokens,
            tokens_out: usage.completionTokens,
            generation_ms: generationMs,
            cover_seed: put.sha256.slice(0, 16),
          })
          .eq('id', appId);
        if (appUpdate.error) {
          throw new AppError('STORE_FAILED', `应用结果保存失败：${appUpdate.error.message}`);
        }

        await sb.rpc('settle_generation', {
          p_job_id: jobId,
          p_tokens_in: usage.promptTokens,
          p_tokens_out: usage.completionTokens,
          p_cost_cny: costCny,
          p_model: isMock(adapter) ? 'mock' : (modelCfg?.id ?? ''),
          p_app_id: appId,
          p_ms: generationMs,
        });

        // 埋点：生成成功
        void sb
          .from('events')
          .insert({
            name: 'generate_success',
            user_id: caller.userId,
            app_id: appId,
            props: { appType, model: modelCfg?.id ?? provider, costCny, period: currentPeriod() },
          })
          .then(() => undefined)
          .catch(() => undefined);

        send('stage', { stage: 'verify', label: '自检与优化', status: 'done' });
        send('done', {
          jobId,
          appId,
          title,
          summary: prompt.slice(0, 60),
          html,
          htmlUrl: put.url,
          htmlStatus: put.readyNow ? 'ready' : 'pending',
          tokensIn: usage.promptTokens,
          tokensOut: usage.completionTokens,
          creditsCost: creditCost,
          creditsBalance: balanceAfterReserve,
          model: isMock(adapter) ? 'mock' : (modelCfg?.id ?? ''),
          promptVersion: composed.promptVersion,
        });
      } catch (err) {
        await fail(err, currentJobId, 0);
      } finally {
        if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
        if (!settled) {
          settled = true;
          try {
            controller.close();
          } catch {
            /* 已关闭 */
          }
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
});

/**
 * 从 DocModel 推导沉淀关键词（供 doc_library 同类聚合与后续 Skill 命中判定）。
 *
 * 只取结构化元信息，不塞正文，避免关键词列膨胀。
 *
 * @param model 文档模型。
 * @param docType 文档类型。
 * @param body 原始请求（补齐 meta 缺失时的学科/年级）。
 * @returns 去重后的关键词数组（≤12 个）。
 */
function deriveKeywords(model: DocModel, docType: string, body: GenerateBody): string[] {
  const raw: string[] = [
    docType,
    model.meta?.subject ?? '',
    body.subject ?? '',
    model.meta?.grade ?? '',
    body.grade ?? '',
    model.meta?.textbook ?? '',
    body.textbook ?? '',
    model.meta?.title ?? '',
    ...(model.verifyHints ?? []).slice(0, 3),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const v = String(item ?? '').trim();
    if (v.length === 0 || v.length > 40) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * 教材检索成本（元/次），仅作后台月度看板参考；精确单价由检索服务商账单为准。
 */
const SEARCH_COST_CNY_PER_CALL = 0.01;

/** textbook_versions 行（仅取用字段）。 */
interface TextbookVersionRow {
  year?: string | null;
  version?: string | null;
  publisher?: string | null;
  subject?: string | null;
  grade?: string | null;
  chapter?: string | null;
  status?: string | null;
}

/** 把版本维度拼成可读描述。 */
function describeVersion(v: TextbookVersionRow | null): string {
  if (!v) return '';
  const parts = [v.grade, v.subject, v.publisher, v.version, v.year]
    .filter((x) => x && String(x).trim().length > 0)
    .map(String);
  return parts.length > 0 ? `教材版本：${parts.join(' / ')}` : '';
}

/** 无检索密钥/检索失败时的兜底上下文（仅版本元信息 + 章节）。 */
function fallbackContext(v: TextbookVersionRow | null, chapter?: string): string {
  const meta = describeVersion(v);
  const lines: string[] = [];
  if (meta) lines.push(meta);
  if (chapter && chapter.trim()) lines.push(`本节课章节：${chapter.trim()}`);
  return lines.join('\n');
}

/** 拼装联网检索式。 */
function buildSearchQuery(v: TextbookVersionRow | null, chapter?: string): string {
  const meta = [v?.subject, v?.grade, v?.publisher, v?.version, v?.year]
    .filter((x) => x && String(x).trim())
    .map(String)
    .join(' ');
  const focus = chapter && chapter.trim() ? chapter.trim() : (v?.subject ?? '教材');
  return `${meta} ${focus} 教材内容 知识点 例题`.trim();
}

/** 教材上下文解析结果。 */
interface ResolveResult {
  context: string;
  searched: boolean;
}

/**
 * 解析教材上下文（T07 textbook_search 阶段核心）。
 *
 * 命中 `textbook_knowledge` 缓存 → 直接复用（省检索成本）；
 * 未命中 → 调 SearchAdapter 联网检索，并沉淀为待核对知识；
 * 任何失败 / 无密钥 → 兜底为仅版本元信息，保证生成不中断。
 *
 * @param opts 版本 id / 章节自由文本 / service_role 客户端。
 */
async function resolveTextbookContext(opts: {
  versionId: string;
  chapter: string | undefined;
  sb: ReturnType<typeof adminClient>;
}): Promise<ResolveResult> {
  const { versionId, chapter, sb } = opts;

  const { data: ver } = await sb
    .from('textbook_versions')
    .select('year, version, publisher, subject, grade, chapter, status')
    .eq('id', versionId)
    .maybeSingle();
  const { data: knowledge } = await sb
    .from('textbook_knowledge')
    .select('section, content, status')
    .eq('textbook_version_id', versionId);

  // 命中缓存：直接复用，省检索成本
  const cached = (knowledge ?? [])
    .filter((k) => k && k.content)
    .map((k) => `- ${k.section ?? '知识点'}：${k.content}`);
  if (cached.length > 0) {
    const meta = describeVersion(ver as TextbookVersionRow | null);
    return {
      context:
        `${meta}\n\n## 已沉淀教材知识（优先对齐）\n${cached.join('\n')}` +
        (chapter && chapter.trim() ? `\n\n## 本节课章节\n${chapter.trim()}` : ''),
      searched: false,
    };
  }

  // 未命中：尝试联网检索（无密钥 → 优雅跳过）
  const adapter = getSearchAdapter();
  if (!adapter) {
    return { context: fallbackContext(ver as TextbookVersionRow | null, chapter), searched: false };
  }

  try {
    const results = await adapter.search({
      query: buildSearchQuery(ver as TextbookVersionRow | null, chapter),
      topK: 5,
    });
    if (results.length > 0) {
      // 沉淀为待教师核对的知识（verified_by 为空 → 仅版本 owner 可读，命中缓存供二次生成复用）
      await sb.from('textbook_knowledge').insert(
        results.map((r) => ({
          textbook_version_id: versionId,
          section: chapter && chapter.trim() ? chapter.trim().slice(0, 120) : (ver?.subject ?? '教材'),
          content: `${r.title}\n${r.snippet}\n来源：${r.url}`,
          status: 'pending',
          source: 'ai',
        })),
      );
      await recordSearchSpend(sb, adapter.name);
      const meta = describeVersion(ver as TextbookVersionRow | null);
      const ctx = results.map((r, i) => `${i + 1}. ${r.title}：${r.snippet}`).join('\n');
      return {
        context:
          `${meta}\n\n## 联网检索到的教材参考（待教师核对）\n${ctx}` +
          (chapter && chapter.trim() ? `\n\n## 本节课章节\n${chapter.trim()}` : ''),
        searched: true,
      };
    }
  } catch (e) {
    console.warn('[textbook_search] 检索失败，兜底为版本元信息：', e);
  }
  return { context: fallbackContext(ver as TextbookVersionRow | null, chapter), searched: false };
}

/**
 * 把教材检索成本记入 `monthly_spend`（model='web_search'），供后台月度看板。
 * 失败不影响主流程（仅是成本归因）。
 */
async function recordSearchSpend(sb: ReturnType<typeof adminClient>, provider: string): Promise<void> {
  try {
    const period = currentPeriod();
    await sb.from('monthly_spend').upsert(
      {
        period,
        model: 'web_search',
        provider,
        calls: 1,
        tokens_in: 0,
        tokens_out: 0,
        cost_cny: SEARCH_COST_CNY_PER_CALL,
      },
      { onConflict: 'period' },
    );
  } catch (e) {
    console.warn('[textbook_search] 检索成本记账失败（不影响生成）：', e);
  }
}

/**
 * 单次模型调用结果。
 */
interface ModelCallResult {
  content: string;
  /** OpenAI 兼容协议的结束原因；`length` 表示被 max_tokens 截断。 */
  finishReason: string;
  usage?: TokenUsage;
}

/** 判断异常是否来自 AbortController。 */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';
}

/**
 * 粗略识别 DocModel 是否在 token 上限处被截断。
 *
 * 只对“JSON 没有闭合 / 解析器明确报 unexpected end”判真，避免把普通格式错误
 * 误当成截断而走紧凑修复。
 */
function isProbablyTruncatedDoc(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const candidate = trimmed
    .replace(/^```(?:json|JSON)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  if (!candidate) return false;
  if (!candidate.endsWith('}') && !candidate.endsWith(']')) return true;
  try {
    JSON.parse(candidate);
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return /unexpected end|end of json|unterminated/i.test(message);
  }
}

/**
 * 流式收集文档 JSON。
 *
 * 与非流式请求相比，模型每吐出一个增量就立即转发到前端，教师不会再长时间看到
 * 0 B；同时用“空闲超时 + 总超时”兜底，避免个别网关保持连接但不继续产出。
 * 一旦识别到完整 JSON 或 finish_reason，主动取消上游读取，避免继续占着连接。
 */
async function callDocStreaming(
  adapter: ReturnType<typeof chooseAdapter>['adapter'],
  req: LlmRequest,
  ctx: { modelId: string; apiBase: string; maxOutputTokens: number },
  sendDelta: (text: string) => void,
): Promise<ModelCallResult> {
  const built = adapter.buildRequest(req, { ...ctx, stream: true });
  const ac = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutKind: '' | 'idle' | 'total' = '';

  const abortForTimeout = (kind: 'idle' | 'total'): void => {
    if (ac.signal.aborted) return;
    timeoutKind = kind;
    ac.abort();
  };
  const armIdleTimeout = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abortForTimeout('idle'), DOC_STREAM_IDLE_TIMEOUT_MS);
  };

  totalTimer = setTimeout(() => abortForTimeout('total'), DOC_STREAM_MAX_TIMEOUT_MS);
  try {
    const res = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      console.error(`[generate:doc] 模型返回 ${res.status}`);
      void text;
      throw new AppError('MODEL_ERROR', modelErrorMessage(adapter.provider, res.status));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let raw = '';
    let finishReason = '';
    let usage: TokenUsage | undefined;

    const consumeFrame = (frame: string): boolean => {
      for (const line of frame.split(/\r?\n/)) {
        const parsed = adapter.parseChunk(line);
        if (!parsed) continue;
        if (parsed.text) {
          raw += parsed.text;
          sendDelta(parsed.text);
        }
        if (parsed.usage) usage = parsed.usage;
        if (parsed.finishReason) finishReason = parsed.finishReason;
        if (parsed.finish) return true;
        if (parsed.text && isCompleteJsonObject(raw)) return true;
      }
      return false;
    };

    let providerFinished = false;
    armIdleTimeout();
    try {
      readLoop: for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armIdleTimeout();
        buffer += decoder.decode(value, { stream: true });
        let next = nextSseFrame(buffer);
        while (next) {
          buffer = next.rest;
          if (consumeFrame(next.frame)) {
            providerFinished = true;
            await reader.cancel().catch(() => undefined);
            break readLoop;
          }
          next = nextSseFrame(buffer);
        }
      }

      // 某些网关的最后一帧没有补空行；流关闭时仍要尝试解析残留内容。
      if (!providerFinished) {
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail) consumeFrame(tail);
      }
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    }

    if (!raw.trim()) {
      throw new AppError('MODEL_ERROR', 'AI 服务未返回有效内容，本次不扣积分');
    }
    return { content: raw, finishReason, usage };
  } catch (err) {
    if (isAbortError(err) && timeoutKind) {
      throw new AppError(
        'TIMEOUT',
        timeoutKind === 'idle'
          ? 'AI 连续 60 秒没有返回新内容，已停止本次任务，请缩小范围后重试'
          : 'AI 生成超过 130 秒，已停止本次任务，请缩小范围后重试',
      );
    }
    throw err;
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (totalTimer !== undefined) clearTimeout(totalTimer);
  }
}

/**
 * 非流式调用一次模型（用于自修复重试）。
 *
 * @param adapter 适配器。
 * @param req 请求。
 * @param ctx 上下文。
 */
async function callOnce(
  adapter: ReturnType<typeof chooseAdapter>['adapter'],
  req: LlmRequest,
  ctx: { modelId: string; apiBase: string; maxOutputTokens: number; stream: boolean },
): Promise<ModelCallResult> {
  const built = adapter.buildRequest(req, ctx);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch(built.url, {
      method: 'POST',
      headers: built.headers,
      body: JSON.stringify(built.body),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new AppError('MODEL_ERROR', modelErrorMessage(adapter.provider, res.status));
    }
    const json = (await res.json()) as {
      choices?: {
        message?: { content?: string };
        finish_reason?: string | null;
      }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
      };
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new AppError('MODEL_ERROR', 'AI 服务未返回有效内容，本次不扣积分');
    const usage = json.usage
      ? {
        promptTokens: Number(json.usage.prompt_tokens ?? 0),
        completionTokens: Number(json.usage.completion_tokens ?? 0),
        cachedTokens: Number(json.usage.prompt_cache_hit_tokens ?? 0),
        estimated: false,
      }
      : undefined;
    return {
      content,
      finishReason: String(json.choices?.[0]?.finish_reason ?? ''),
      usage,
    };
  } catch (err) {
    if (isAbortError(err)) {
      throw new AppError('TIMEOUT', 'AI 生成超过 90 秒，已停止本次任务，请缩小范围后重试');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
