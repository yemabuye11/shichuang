/**
 * EF `POST /functions/v1/practice` —— 每日一练「出题」入口，一个函数承担两件事：
 *
 *   action: 'generate'  AI 生成题目（按年级/学科/章节/天数/题型/难度）
 *   action: 'import'    老师上传题目文本（CSV / Word 复制的乱文本）→ AI 识别结构化
 *
 * 设计要点（见 docs/PLAN_每日一练.md 第二节 / 第五节 / 第七节）：
 * 1. 骨架照抄 `verify-email-code/index.ts`（`handleCors` / `jsonOk` / `jsonError` / `Deno.serve` / POST 校验）；
 * 2. 鉴权 `requireUser`：生成与识别都要求老师登录（未登录 401）；
 * 3. 模型走 `chooseAdapter()`（`_shared/llm/index.ts`），可用 `app_type_profiles.model_override` 指定便宜模型；
 * 4. 本项目 LLM 适配器**不支持 response_format**，只能靠 system 提示词约束输出 ```json 代码块，
 *    再用 `_shared/doc/validate.ts` 的 `extractDocJson` 抽 JSON 块并 `JSON.parse`；
 * 5. 积分照搬 `generate` 流程：**先 `reserve_credits` → 插 `generation_jobs` 行（写 `reserved_credits`）
 *    → 成功 `settle_generation` / 任何异常 `refund_generation`**（`refund_generation` 依赖 job 行的
 *    `reserved_credits`，不插 job 行就退不了钱）；
 * 6. 填空题硬约束：多空用竖线 `|` 合并成**同一个字符串**（数组只一个元素），绝不分拆成多个数组元素；
 *    每个空多个可接受答案也用 `|` 分隔。否则服务端判分会把多空当成「多个空」而整题判错。
 *
 * 安全红线：API Key 只从 `Deno.env.get()` 读取（适配器内部），绝不出现在日志与响应中。
 */

import { handleCors } from '../_shared/cors.ts';
import { jsonOk, jsonError } from '../_shared/json.ts';
import { AppError, toAppError } from '../_shared/errors.ts';
import { requireUser, type Caller } from '../_shared/auth.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';
import { loadAppType, loadModel } from '../_shared/config.ts';
import { chooseAdapter } from '../_shared/llm/index.ts';
import { extractDocJson } from '../_shared/doc/validate.ts';
import type { LlmRequest } from '../_shared/llm/types.ts';

/** 单次模型调用超时（毫秒），与 `generate` 保持一致。 */
const MODEL_TIMEOUT_MS = 120_000;

/** 每题估算输出 token（中文约 1.5 字符/token，客观题含解析约 200 token）。 */
const TOKENS_PER_QUESTION = 200;
/** 上浮系数 30%。 */
const TOKEN_HEADROOM = 1.3;
/** 单次输出上限（DeepSeek 等默认 8k，超过会截断）。 */
const MAX_OUTPUT_CAP = 8000;

/** 填空题多空分隔符（与判分 RPC `practice_grade_question` 一致）。 */
const BLANK_SEP = '|';

/** 输出 JSON 代码块的标记（单引号字符串，可安全包含反引号，不进任何模板字面量）。 */
const JSON_FENCE = '```json';
/** 固定提示语：要求把结果放进 ```json 代码块（同样用单引号，避免模板字面量里写三个反引号）。 */
const FENCE_HINT = '只输出一个 ' + JSON_FENCE + ' 代码块，代码块外不要写任何文字。';

/**
 * system 段：固定前缀，逐字节稳定 → 命中 DeepSeek 上下文缓存（顺序也不能变，否则缓存失效）。
 * 动态内容一律进 user 段。填空题 `|` 合并规则在这里写死，模型必须遵循。
 */
const SYSTEM_PROMPT = [
  '你是小学语文命题助手，服务对象是小学二年级语文老师，为人教版教材出客观题。',
  '只输出 JSON，不要输出任何解释性文字、不要寒暄、不要输出 markdown 代码块之外的其它内容。',
  '题型只有三种：choice（选择题）、fill（填空题）、judge（判断题）。',
  '填空题若有多个空，把这些空用竖线 | 合并写在同一个字符串里，不要拆成数组多个元素；每个空若有多个可接受的答案，也用 | 分隔。',
  '题目必须适合小学二年级语文（人教版），以字词句基础、课文内容理解为主，难度适当，不拔高。',
  '每题必须有解析（explanation 字段）：说明答案为什么对、错在哪里、或易错点提示。',
  '输出是一个 JSON 数组，每个元素是一道题；字段见下方 user 段说明。',
  '只输出一个 ' + JSON_FENCE + ' 代码块，代码块外不要有任何文字。',
].join('\n');

// ---------------------------------------------------------------------------
// 入参类型
// ---------------------------------------------------------------------------

interface GenerateBody {
  action: 'generate';
  subject: string;
  grade: string;
  chapter: string;
  dayCount: number;
  questionPerDay: number;
  qtypes: ('choice' | 'fill' | 'judge')[];
  difficulty: string;
  textbookVersionId?: string | null;
  extra?: string;
}

interface ImportBody {
  action: 'import';
  text: string;
}

type PracticeBody = GenerateBody | ImportBody;

/** 对外返回的题目结构（与前端 `src/types/practice.ts` 对齐）。 */
interface PracticeQuestion {
  dayNo: number;
  seq: number;
  qtype: 'choice' | 'fill' | 'judge';
  stem: string;
  options?: string[];
  answer: string[];
  explanation?: string;
}

/** 系统配置 `practice` 的结构（见 `0038_practice_daily.sql`）。 */
interface PracticeConfig {
  discountByDays?: Record<string, number>;
  minDiscount?: number;
  importCostCredits?: number;
}

// ---------------------------------------------------------------------------
// 提示词拼装（system 固定，动态内容只在 user 段）
// ---------------------------------------------------------------------------

/**
 * 渲染「AI 生成」的 user 段。
 *
 * @param b 生成参数。
 */
function buildGenerateUserPrompt(b: GenerateBody): string {
  const dayCount = Math.max(1, Math.floor(Number(b.dayCount) || 1));
  const questionPerDay = Math.max(1, Math.floor(Number(b.questionPerDay) || 1));
  const qtypes = Array.isArray(b.qtypes) && b.qtypes.length > 0 ? b.qtypes : (['choice'] as string[]);
  const subject = (b.subject ?? '').trim() || '语文';
  const grade = (b.grade ?? '').trim() || '二年级';
  const chapter = (b.chapter ?? '').trim();
  const difficulty = (b.difficulty ?? '').trim() || '基础';
  const extra = (b.extra ?? '').trim();
  const total = dayCount * questionPerDay;

  const lines: string[] = [];
  lines.push(`请为小学${grade}（${subject}）生成一套"每日一练"客观题。`);
  lines.push('');
  lines.push('【要求】');
  lines.push(`- 教材章节/范围：${chapter || '（由你按${grade}${subject}常见内容合理选取）'}`);
  if (b.textbookVersionId) lines.push(`- 教材版本 id：${b.textbookVersionId}`);
  lines.push(`- 练习天数：${dayCount} 天`);
  lines.push(`- 每天题量：${questionPerDay} 题`);
  lines.push(`- 题型：${qtypes.join('、')}（choice=选择题，fill=填空题，judge=判断题）`);
  lines.push(`- 难度：${difficulty}`);
  if (extra) lines.push(`- 补充要求：${extra}`);
  lines.push(`- 共需生成 ${total} 题，请平均分配到第 1 天到第 ${dayCount} 天（每天 ${questionPerDay} 题）。`);
  lines.push('- 同一天内的题目不要重复；跨天难度由易到难递增。');
  lines.push(`- 每道题都要带 dayNo（第几天，从 1 开始）和 seq（当天内序号，从 1 开始）。`);
  lines.push('');
  lines.push('【每题字段】');
  lines.push('{');
  lines.push('  "dayNo": 1,');
  lines.push('  "seq": 1,');
  lines.push('  "qtype": "choice",             // 三选一：choice | fill | judge');
  lines.push('  "stem": "题干",');
  lines.push('  "options": ["A. ...", "B. ..."], // 仅选择题需要，至少 2 个；填空/判断为 null');
  lines.push('  "answer": ["A"],               // 选择填选项字母；判断填"对"或"错"；填空每个空一个字符串，多个空用 | 合并成一个字符串');
  lines.push('  "explanation": "解析"');
  lines.push('}');
  lines.push('');
  lines.push('- 填空题：多个空必须合并成**一个字符串**用 | 分隔（如 "又大又红|又香又甜"），不要写成多个数组元素。');
  lines.push('- 选择题：options 至少 2 个，answer 是正确选项的字母（如 ["A"]）。');
  lines.push('- 判断题：answer 填 ["对"] 或 ["错"]。');
  lines.push('');
  lines.push(FENCE_HINT);

  return lines.join('\n');
}

/**
 * 渲染「AI 识别」的 user 段：原样结构化，不改编、不新增、不删减。
 *
 * @param text 老师上传的原文（CSV 或 Word 复制文本）。
 */
function buildImportUserPrompt(text: string): string {
  const lines: string[] = [];
  lines.push('以下是老师提供的题目原文（可能来自 CSV 或 Word 复制，格式不规整，可能有换行/空格错位）：');
  lines.push('');
  lines.push('"""');
  lines.push(text);
  lines.push('"""');
  lines.push('');
  lines.push('请**原样**把这些题目结构化成一个 JSON 数组：');
  lines.push('- 不要改编题意、不要新增题目、不要删减题目，保持原文顺序；');
  lines.push('- 每道题字段：');
  lines.push('  { "qtype": "choice"|"fill"|"judge", "stem": "题干", "options": ["A. ...","B. ..."], "answer": ["A"], "explanation": "解析" }');
  lines.push('- options：仅选择题需要（至少 2 个）；填空题、判断题为 null。');
  lines.push('- answer：选择题填正确选项字母（如 ["A"]）；判断题填 ["对"] 或 ["错"]；');
  lines.push('  填空题每个空一个字符串，多个空用竖线 | 合并写成**同一个字符串**（如 ["又大又红|又香又甜"]），不要拆成多个数组元素。');
  lines.push('- 看不清、拿不准的题目：qtype 标为 "fill"，并在 explanation 写"请老师核对"。');
  lines.push('- 原文没有解析的，explanation 留空字符串 ""。');
  lines.push('');
  lines.push(FENCE_HINT);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 模型调用（非流式，本项目不支持 response_format，靠提示词约束）
// ---------------------------------------------------------------------------

/**
 * 非流式调用一次模型，返回 `choices[0].message.content`。
 *
 * @param adapter 适配器。
 * @param req 请求。
 * @param modelCfg 模型配置（取 modelId / apiBase）。
 */
async function callModel(
  adapter: ReturnType<typeof chooseAdapter>['adapter'],
  req: LlmRequest,
  modelCfg: Awaited<ReturnType<typeof loadModel>>,
): Promise<string> {
  const ctx = {
    modelId: modelCfg?.modelId ?? 'deepseek-chat',
    apiBase: modelCfg?.apiBase ?? '',
    maxOutputTokens: req.maxOutputTokens,
    stream: false,
  };
  const built = adapter.buildRequest(req, ctx);

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

  if (!res.ok) {
    // 只记录状态码，绝不记录请求头（含 Authorization）
    console.error(`[practice] 模型返回 ${res.status}`);
    throw new AppError('MODEL_ERROR', 'AI 服务开小差了，本次不扣积分');
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// 输出校验
// ---------------------------------------------------------------------------

/**
 * 从模型输出抽取 JSON 数组并逐题校验结构。
 *
 * 失败统一抛 `AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试')`，
 * 由调用方负责退款。
 *
 * @param raw 模型原始输出。
 * @param isImport 是否为 import（import 不要求模型给 dayNo/seq，由代码补 1/序号）。
 */
function parseQuestions(raw: string, isImport: boolean): PracticeQuestion[] {
  const json = extractDocJson(raw);
  if (!json) {
    throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
  }

  const out: PracticeQuestion[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown> | null;
    if (typeof item !== 'object' || item === null) {
      throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
    }

    // qtype 三选一，否则纠正为 fill
    const rawQtype = String(item.qtype ?? '');
    const qtype: PracticeQuestion['qtype'] =
      rawQtype === 'choice' || rawQtype === 'fill' || rawQtype === 'judge' ? rawQtype : 'fill';

    const stem = typeof item.stem === 'string' ? item.stem : '';
    const answerRaw = Array.isArray(item.answer) ? (item.answer as unknown[]) : [];
    const answer = answerRaw.map((x) => String(x));

    if (!stem || answer.length === 0) {
      throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
    }

    let options: string[] | undefined;
    if (qtype === 'choice') {
      const opts = Array.isArray(item.options) ? (item.options as unknown[]).map((x) => String(x)) : [];
      if (opts.length < 2) {
        throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
      }
      options = opts;
      // answer 必须是选项字母（单字母，忽略大小写）
      for (const a of answer) {
        if (!/^[A-Za-z]$/.test(a.trim())) {
          throw new AppError('VALIDATE_FAILED', 'AI 返回的题目格式有问题，请重试');
        }
      }
    }

    const dayNo = isImport ? 1 : typeof item.dayNo === 'number' ? item.dayNo : 1;
    const seq = isImport ? i + 1 : typeof item.seq === 'number' ? item.seq : i + 1;
    const explanation = typeof item.explanation === 'string' ? item.explanation : undefined;

    out.push({ dayNo, seq, qtype, stem, options, answer, explanation });
  }

  return out;
}

/**
 * 估算 maxOutputTokens。
 *
 * @param questionCount 题目总数。
 */
function estimateMaxTokens(questionCount: number): number {
  const est = Math.ceil(questionCount * TOKENS_PER_QUESTION * TOKEN_HEADROOM);
  return Math.min(est, MAX_OUTPUT_CAP);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonError(405, { code: 'UNKNOWN', message: '请使用 POST 请求' });
  }

  // ---- 1. 鉴权 + 入参 ----
  let caller: Caller;
  let body: PracticeBody;
  try {
    caller = await requireUser(req);
    body = (await req.json()) as PracticeBody;
  } catch (err) {
    const e = toAppError(err);
    return jsonError(e.httpStatus, { code: e.code, message: e.message });
  }

  const action = body?.action;
  if (action !== 'generate' && action !== 'import') {
    return jsonError(422, { code: 'VALIDATE_FAILED', message: 'action 必须是 generate 或 import' });
  }

  const isImport = action === 'import';

  // ---- 2. 生成参数校验（import 只需 text 非空）----
  if (isImport) {
    const importBody = body as ImportBody;
    if (!importBody.text || importBody.text.trim().length < 2) {
      return jsonError(422, { code: 'VALIDATE_FAILED', message: '请粘贴需要识别的题目文本' });
    }
  } else {
    const gen = body as GenerateBody;
    const dayCount = Math.max(1, Math.floor(Number(gen.dayCount) || 1));
    const questionPerDay = Math.max(1, Math.floor(Number(gen.questionPerDay) || 1));
    const qtypes = Array.isArray(gen.qtypes) ? gen.qtypes : [];
    if (qtypes.length === 0) {
      return jsonError(422, { code: 'VALIDATE_FAILED', message: '请至少选择一种题型' });
    }
    if (dayCount < 1 || questionPerDay < 1) {
      return jsonError(422, { code: 'VALIDATE_FAILED', message: '天数和每天题量必须为正整数' });
    }
  }

  // ---- 3. 模型路由（app_type_profiles.model_override 可指定便宜模型）----
  const typeCfg = await loadAppType('daily_practice');
  const preferred = typeCfg?.modelOverride ?? undefined;
  const modelCfg = await loadModel(preferred);
  const { adapter } = chooseAdapter(preferred);

  // ---- 4. 积分计算 ----
  const sb = adminClient();
  const { data: sysRow } = await sb
    .from('system_config')
    .select('value')
    .eq('key', 'practice')
    .maybeSingle();
  const sys = ((sysRow?.value ?? {}) as PracticeConfig);

  let cost: number;
  let questionCount = 1;
  if (isImport) {
    cost = Number(sys.importCostCredits ?? 0.5);
  } else {
    const gen = body as GenerateBody;
    const dayCount = Math.max(1, Math.floor(Number(gen.dayCount) || 1));
    const questionPerDay = Math.max(1, Math.floor(Number(gen.questionPerDay) || 1));
    questionCount = dayCount * questionPerDay;

    const baseCost = typeCfg?.creditCost ?? 1;
    const tierKey = String(dayCount);
    const tierDiscount = Number(sys.discountByDays?.[tierKey] ?? 1);
    const minDiscount = Number(sys.minDiscount ?? 0.6);
    // 折扣 = max(下限, 档位折扣)；档位缺失时按 1（不打折）
    const discount = Math.max(minDiscount, tierDiscount);
    // 最终积分：基准价 * 天数 * 折扣，保留 2 位小数
    cost = Math.ceil(baseCost * dayCount * discount * 100) / 100;
  }

  // ---- 5. 预扣积分（先扣，不足直接返回，不插 job、不退款）----
  const jobId = crypto.randomUUID();
  const modelId = modelCfg?.id ?? '';
  const reserve = await sb.rpc('reserve_credits', {
    p_amount: cost,
    p_job_id: jobId,
    p_app_type: 'daily_practice',
    p_model: modelId,
  });
  const reserveRaw = (reserve.data ?? {}) as { ok?: boolean; balance?: number; code?: string };
  if (reserveRaw.ok !== true) {
    return jsonError(402, { code: 'INSUFFICIENT_CREDITS', message: '积分不足啦，可以用兑换码充值，或联系管理员' });
  }

  // ---- 6. 插 job 行（写 reserved_credits，供失败退款）----
  let reserved = true;
  await sb.from('generation_jobs').insert({
    id: jobId,
    user_id: caller.userId,
    app_id: null,
    app_type: 'daily_practice',
    model: modelId,
    status: 'running',
    reserved_credits: cost,
    idempotency_key: jobId,
  });

  // ---- 7. 拼提示词 + 调模型 + 校验（失败重试 1 次）----
  try {
    const userPrompt = isImport
      ? buildImportUserPrompt((body as ImportBody).text)
      : buildGenerateUserPrompt(body as GenerateBody);

    const maxOutput = estimateMaxTokens(questionCount);
    const llmReq: LlmRequest = {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: maxOutput,
      temperature: 0.7,
    };

    const startedAt = Date.now();
    let raw = await callModel(adapter, llmReq, modelCfg);

    let questions: PracticeQuestion[];
    try {
      questions = parseQuestions(raw, isImport);
    } catch (firstErr) {
      // 自修复重试 1 次：把校验错误回灌，要求重新输出完整合法 JSON
      const reason = firstErr instanceof Error ? firstErr.message : '格式有误';
      const repairUser = userPrompt + '\n\n你上一次的输出没有通过格式校验（' + reason + '）。请重新输出**完整**的 JSON 数组，' + FENCE_HINT;
      raw = await callModel(adapter, { ...llmReq, userPrompt: repairUser }, modelCfg);
      questions = parseQuestions(raw, isImport); // 仍失败则抛出 → 外层退款
    }

    // ---- 8. 结算 ----
    const generationMs = Date.now() - startedAt;
    await sb.rpc('settle_generation', {
      p_job_id: jobId,
      p_tokens_in: 0,
      p_tokens_out: 0,
      p_cost_cny: 0,
      p_model: modelId,
      p_ms: generationMs,
    });

    return jsonOk({ ok: true, questions });
  } catch (err) {
    // ---- 任何异常：全额退还（依赖上面插的 job 行）----
    if (reserved) {
      try {
        await sb.rpc('refund_generation', {
          p_job_id: jobId,
          p_error_code: err instanceof AppError ? err.code : 'UNKNOWN',
          p_error_message: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // 退款失败也不阻断返回错误
      }
    }
    const e = toAppError(err);
    return jsonError(e.httpStatus, { code: e.code, message: e.message });
  }
});
