/**
 * EF `POST /functions/v1/exam-paper` —— 组卷「命题」入口，一个函数承担三件事：
 *
 *   action: 'parse'     解析老师上传的原卷 → 知识点清单 + 结构化大题（免费，仅分析）
 *   action: 'generate'  按 年级+科目+单元(+教材版本) / 知识点 / 原卷变式 → 生成一套新测验卷
 *   action: 'import'    老师上传原卷文本 → AI 原样结构化（不改编）→ 直接当测验卷用
 *
 * 设计要点（见 docs/PLAN_组卷.md）：
 * 1. 骨架照抄 `practice/index.ts`，复用 requireUser / 积分 reserve→settle→refund / LLM 适配器；
 * 2. 鉴权：parse/generate/import 都要求老师登录（未登录 401）；
 * 3. 模型走 `chooseAdapter()`，可用 `app_type_profiles.model_override` 指定便宜模型；
 * 4. 适配器不支持 response_format，靠 system 提示词约束 ```json 代码块 + `extractDocJson` 抽取；
 * 5. 积分：generate/import 先 reserve → 插 generation_jobs（写 reserved_credits）→
 *    成功 settle / 异常 refund；parse 免费（仅分析，不碰积分）；
 * 6. 填空题硬约束：多空用竖线 | 合并成同一个字符串，绝不分拆成多个数组元素；
 * 7. 与每日一练不同：本函数产出"大题分组(section)"结构，含主观题(subjective)。
 *
 * 安全红线：API Key 只从 `Deno.env.get()` 读取，绝不出现在日志与响应中。
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

/** 单次模型调用超时（毫秒）。 */
const MODEL_TIMEOUT_MS = 120_000;
/** 客观题每题估算输出 token；主观题更肥，下面单独加权。 */
const TOKENS_OBJECTIVE = 220;
const TOKENS_SUBJECTIVE = 420;
const TOKEN_HEADROOM = 1.3;
const MAX_OUTPUT_CAP = 8000;

/** 填空题多空分隔符（与判分 RPC `practice_grade_question` 一致）。 */
const BLANK_SEP = '|';

/** 输出 JSON 代码块的标记（单引号，避免模板字面量里写三反引号）。 */
const JSON_FENCE = '```json';
const FENCE_HINT = '只输出一个 ' + JSON_FENCE + ' 代码块，代码块外不要写任何文字。';

/** 四种题型。 */
type QType = 'choice' | 'fill' | 'judge' | 'subjective';

/**
 * system 段：固定前缀逐字节稳定 → 命中 DeepSeek 上下文缓存。动态内容只在 user 段。
 */
const SYSTEM_PROMPT = [
  '你是中小学 AI 命题助手，服务对象是一线教师，能按任意年级、学科、单元生成或重组测验卷。',
  '只输出 JSON，不要解释、不要寒暄、不要代码块之外的任何文字。',
  '题型共四种：choice（选择题）、fill（填空题）、judge（判断题）、subjective（主观题：简答/作文/应用题/计算等）。',
  '填空题若有多个空，把这些空用竖线 | 合并写在同一个字符串里；每个空若有多个可接受的答案也用 | 分隔。',
  '客观题（choice/fill/judge）必须有解析 explanation；主观题必须有 answer（字符串数组，可多条要点）与 explanation（评分要点/参考答案）。',
  '题目难度需匹配所给年级，不拔高、不超纲。',
  '输出结构见下方 user 段说明。',
  '只输出一个 ' + JSON_FENCE + ' 代码块，代码块外不要有任何文字。',
].join('\n');

// ---------------------------------------------------------------------------
// 入参类型
// ---------------------------------------------------------------------------

/** 大题规格（生成时由前端给结构；变式时照搬原卷结构）。 */
interface SectionSpec {
  sectionTitle: string;
  qtype: QType;
  count: number;
  score: number;
}

interface ParseBody {
  action: 'parse';
  text: string;
}

interface GenerateBody {
  action: 'generate';
  grade: string;
  subject: string;
  unit?: string | null;
  textbookVersionId?: string | null;
  title?: string;
  sections: SectionSpec[];
  sourceText?: string;          // 原卷文本（变式时提供，仅用于提取知识点与结构）
  knowledgePoints?: string[];   // 指定知识点清单（可选）
  extra?: string;
}

interface ImportBody {
  action: 'import';
  text: string;
}

type ExamBody = ParseBody | GenerateBody | ImportBody;

/** 单题（与前端 src/types/examPaper.ts 对齐）。 */
interface ExamQuestion {
  qtype: QType;
  stem: string;
  options?: string[];
  answer: string[];
  explanation?: string;
  score: number;
  knowledgePoint?: string;
}

/** 大题（含若干题）。 */
interface ExamSection {
  sectionTitle: string;
  questions: ExamQuestion[];
}

/** 试卷（parse/generate/import 的统一返回）。 */
interface ExamPaper {
  title: string;
  sections: ExamSection[];
}

/** 系统配置 `exam` 的结构。 */
interface ExamConfig {
  questionCost?: Record<string, number>;
  bulkTiers?: { min: number; discount: number }[];
  minDiscount?: number;
  importCostCredits?: number;
}

// ---------------------------------------------------------------------------
// 提示词拼装（system 固定，动态内容只在 user 段）
// ---------------------------------------------------------------------------

/** 渲染「原卷解析(parse)」的 user 段。 */
function buildParseUserPrompt(text: string): string {
  const lines: string[] = [];
  lines.push('以下是老师提供的原卷文本，请解析并结构化：');
  lines.push('1) 提取知识点清单 knowledgePoints（字符串数组，如 ["多音字辨析","比喻句仿写"]）；');
  lines.push('2) 按原卷大题结构整理 sections（每大题含 sectionTitle 与 questions，每题含 qtype/stem/options/answer/explanation/score/knowledgePoint）。');
  lines.push('保持原卷内容，不要改写题目、不要新增或删减。');
  lines.push('');
  lines.push('"""');
  lines.push(text);
  lines.push('"""');
  lines.push('');
  lines.push('输出 JSON 结构：');
  lines.push('{ "title": "卷名", "knowledgePoints": ["..."], "sections": [ { "sectionTitle": "一、选择题", "questions": [ { "qtype":"choice", "stem":"题干", "options":["A. ..","B. .."], "answer":["A"], "explanation":"解析", "score":3, "knowledgePoint":"知识点" } ] } ] }');
  lines.push('');
  lines.push(FENCE_HINT);
  return lines.join('\n');
}

/** 渲染「生成(generate)」的 user 段。 */
function buildGenerateUserPrompt(b: GenerateBody): string {
  const grade = (b.grade ?? '').trim() || '未知年级';
  const subject = (b.subject ?? '').trim() || '未知学科';
  const unit = (b.unit ?? '').trim();
  const title = (b.title ?? '').trim();
  const extra = (b.extra ?? '').trim();

  const lines: string[] = [];
  lines.push(`请为${grade}（${subject}）${unit ? unit + ' ' : ''}生成一套测验卷。`);
  if (title) lines.push(`卷名建议：${title}（可微调）。`);
  lines.push('');
  lines.push('【大题结构（严格按此生成，题数/分值/题型一一对应）】');
  for (const s of b.sections) {
    lines.push(`- ${s.sectionTitle}：题型=${s.qtype}，题数=${s.count}，每题${s.score}分`);
  }
  if (b.knowledgePoints && b.knowledgePoints.length) {
    lines.push('');
    lines.push('【重点考察知识点】');
    for (const k of b.knowledgePoints) lines.push(`- ${k}`);
  }
  if (b.sourceText && b.sourceText.trim()) {
    lines.push('');
    lines.push('【参考卷（仅供提取知识点与结构，禁止照搬原题，必须出新题）】');
    lines.push('"""');
    lines.push(b.sourceText);
    lines.push('"""');
    lines.push('请生成"同知识点、不同题目"的变式卷：题干/数字/材料/选项都要换，但大题结构(题型/题数/分值)与原卷一致。');
  }
  if (extra) {
    lines.push('');
    lines.push(`【补充要求】${extra}`);
  }
  lines.push('');
  lines.push('【输出 JSON 结构】');
  lines.push('{ "title":"卷名", "sections":[ { "sectionTitle":"一、选择题（每题3分，共30分）", "questions":[ { "qtype":"choice", "stem":"题干", "options":["A. ..","B. .."], "answer":["A"], "explanation":"解析", "score":3, "knowledgePoint":"知识点" } ] } ] }');
  lines.push('- choice：options 至少 2 个，answer 是正确选项字母（如 ["A"]）；');
  lines.push('- fill：answer 每个空一个字符串，多个空用竖线 | 合并成**同一个字符串**（如 ["又大又红|又香又甜"]）；');
  lines.push('- judge：answer 填 ["对"] 或 ["错"]；');
  lines.push('- subjective：answer 是要点数组（如 ["要点一","要点二"]），explanation 写评分要点/参考答案；');
  lines.push('- 每题 score 必须等于该大题设定分值；knowledgePoint 标该题知识点。');
  lines.push('');
  lines.push(FENCE_HINT);
  return lines.join('\n');
}

/** 渲染「原卷结构化(import)」的 user 段。 */
function buildImportUserPrompt(text: string): string {
  const lines: string[] = [];
  lines.push('以下是老师提供的测验卷原文（可能来自 Word/PDF 复制，格式不规整），请**原样**结构化成一个试卷 JSON：');
  lines.push('{ "title":"卷名", "sections":[ { "sectionTitle":"一、选择题", "questions":[ { "qtype":"choice"|"fill"|"judge"|"subjective", "stem":"题干", "options":["A. ..","B. .."], "answer":["A"], "explanation":"解析", "score":3, "knowledgePoint":"知识点" } ] } ] }');
  lines.push('- 不要改编题意、不要新增、不要删减题目，保持原卷大题顺序与题序；');
  lines.push('- options 仅选择题需要（至少 2 个）；fill/judge 为 null；subjective 的 answer 写要点数组。');
  lines.push('- 填空题多个空用竖线 | 合并成一个字符串（如 ["又大又红|又香又甜"]）。');
  lines.push('- 看不清、拿不准的题目：qtype 标 "fill"，explanation 写"请老师核对"。');
  lines.push('- 原文没有解析/知识点的，对应字段留空字符串 ""。');
  lines.push('');
  lines.push('"""');
  lines.push(text);
  lines.push('"""');
  lines.push('');
  lines.push(FENCE_HINT);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 模型调用（非流式）
// ---------------------------------------------------------------------------

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
    console.error(`[exam-paper] 模型返回 ${res.status}`);
    throw new AppError('MODEL_ERROR', 'AI 服务开小差了，本次不扣积分');
  }

  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// 输出校验（试卷级）
// ---------------------------------------------------------------------------

const VALID_QTYPES: QType[] = ['choice', 'fill', 'judge', 'subjective'];

/** 从模型输出抽取并校验试卷 JSON。失败抛 AppError（调用方负责退款）。 */
function parsePaper(raw: string): ExamPaper {
  const json = extractDocJson(raw);
  if (!json) throw new AppError('VALIDATE_FAILED', 'AI 返回的格式有问题，请重试');

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError('VALIDATE_FAILED', 'AI 返回的格式有问题，请重试');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError('VALIDATE_FAILED', 'AI 返回的格式有问题，请重试');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
    throw new AppError('VALIDATE_FAILED', 'AI 返回的试卷没有大题');
  }

  const title = typeof obj.title === 'string' ? obj.title : '未命名测验卷';
  const sections: ExamSection[] = [];

  for (const sec of obj.sections as unknown[]) {
    if (typeof sec !== 'object' || sec === null) {
      throw new AppError('VALIDATE_FAILED', 'AI 返回的试卷格式有问题，请重试');
    }
    const s = sec as Record<string, unknown>;
    const sectionTitle = typeof s.sectionTitle === 'string' ? s.sectionTitle : '';
    if (!Array.isArray(s.questions) || s.questions.length === 0) {
      throw new AppError('VALIDATE_FAILED', 'AI 返回的某大题没有题目');
    }

    const questions: ExamQuestion[] = [];
    for (const item of s.questions as unknown[]) {
      if (typeof item !== 'object' || item === null) {
        throw new AppError('VALIDATE_FAILED', 'AI 返回的试卷格式有问题，请重试');
      }
      const q = item as Record<string, unknown>;
      const rawQtype = String(q.qtype ?? '');
      const qtype: QType = (VALID_QTYPES as string[]).includes(rawQtype)
        ? (rawQtype as QType)
        : 'fill';

      const stem = typeof q.stem === 'string' ? q.stem : '';
      const answerRaw = Array.isArray(q.answer) ? (q.answer as unknown[]) : [];
      const answer = answerRaw.map((x) => String(x));
      const score = typeof q.score === 'number' ? q.score : 1;
      if (!stem || answer.length === 0) {
        throw new AppError('VALIDATE_FAILED', 'AI 返回的试卷格式有问题，请重试');
      }

      let options: string[] | undefined;
      if (qtype === 'choice') {
        const opts = Array.isArray(q.options) ? (q.options as unknown[]).map((x) => String(x)) : [];
        if (opts.length < 2) {
          throw new AppError('VALIDATE_FAILED', 'AI 返回的试卷格式有问题，请重试');
        }
        options = opts;
        for (const a of answer) {
          if (!/^[A-Za-z]$/.test(a.trim())) {
            throw new AppError('VALIDATE_FAILED', 'AI 返回的试卷格式有问题，请重试');
          }
        }
      }

      const explanation = typeof q.explanation === 'string' ? q.explanation : undefined;
      const knowledgePoint = typeof q.knowledgePoint === 'string' ? q.knowledgePoint : undefined;
      questions.push({ qtype, stem, options, answer, explanation, score, knowledgePoint });
    }
    sections.push({ sectionTitle, questions });
  }

  return { title, sections };
}

/** 估算 maxOutputTokens（主观题更肥）。 */
function estimateMaxTokens(sections: SectionSpec[]): number {
  let total = 0;
  for (const s of sections) {
    const per = s.qtype === 'subjective' ? TOKENS_SUBJECTIVE : TOKENS_OBJECTIVE;
    total += Math.max(0, Math.floor(s.count || 0)) * per;
  }
  return Math.min(Math.ceil(total * TOKEN_HEADROOM), MAX_OUTPUT_CAP);
}

/** 按题型明细 + 阶梯折扣算积分。 */
function computeExamCost(
  sections: SectionSpec[],
  examCfg: ExamConfig,
  baseCost: number,
): number {
  const perQ = examCfg.questionCost ?? { choice: 0.1, fill: 0.1, judge: 0.08, subjective: 0.25 };
  let total = 0;
  let raw = 0;
  for (const s of sections) {
    const c = Math.max(0, Math.floor(s.count || 0));
    total += c;
    raw += (perQ[s.qtype] ?? 0.1) * c;
  }
  if (total === 0) return 0;

  const tiers = examCfg.bulkTiers ?? [{ min: 1, discount: 1 }];
  let discount = 1;
  for (const t of tiers) {
    if (total >= (t.min ?? 1)) discount = Math.min(discount, t.discount ?? 1);
  }
  discount = Math.max(examCfg.minDiscount ?? 0.6, discount);

  // 同时与"基准价 * 套数"取较大者，避免大卷倒挂；套数固定 1
  const byBase = Math.ceil(baseCost * 1 * discount * 100) / 100;
  const byDetail = Math.ceil(raw * discount * 100) / 100;
  return Math.max(byBase, byDetail);
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

  let caller: Caller;
  let body: ExamBody;
  try {
    caller = await requireUser(req);
    body = (await req.json()) as ExamBody;
  } catch (err) {
    const e = toAppError(err);
    return jsonError(e.httpStatus, { code: e.code, message: e.message });
  }

  const action = body?.action;
  if (action !== 'parse' && action !== 'generate' && action !== 'import') {
    return jsonError(422, { code: 'VALIDATE_FAILED', message: 'action 必须是 parse / generate / import' });
  }

  // ---- 入参校验 ----
  if (action === 'parse' || action === 'import') {
    const t = (body as ParseBody | ImportBody).text ?? '';
    if (t.trim().length < 2) {
      return jsonError(422, { code: 'VALIDATE_FAILED', message: '请粘贴需要处理的题目文本' });
    }
  } else {
    const gen = body as GenerateBody;
    if (!Array.isArray(gen.sections) || gen.sections.length === 0) {
      return jsonError(422, { code: 'VALIDATE_FAILED', message: '请至少配置一个大题（题型/题数/分值）' });
    }
    for (const s of gen.sections) {
      if (!VALID_QTYPES.includes(s.qtype) || (s.count ?? 0) < 1 || (s.score ?? 0) < 0) {
        return jsonError(422, { code: 'VALIDATE_FAILED', message: '大题配置有误（题型/题数/分值）' });
      }
    }
  }

  // ---- 模型路由 ----
  const typeCfg = await loadAppType('exam_paper');
  const preferred = typeCfg?.modelOverride ?? undefined;
  const modelCfg = await loadModel(preferred);
  const { adapter } = chooseAdapter(preferred);

  // ---- parse 免费：直接调模型返回，不走积分 ----
  if (action === 'parse') {
    const userPrompt = buildParseUserPrompt((body as ParseBody).text);
    try {
      const raw = await callModel(
        adapter,
        { systemPrompt: SYSTEM_PROMPT, userPrompt, maxOutputTokens: MAX_OUTPUT_CAP, temperature: 0.4 },
        modelCfg,
      );
      const paper = parsePaper(raw);
      return jsonOk({ ok: true, paper });
    } catch (err) {
      const e = toAppError(err);
      return jsonError(e.httpStatus, { code: e.code, message: e.message });
    }
  }

  // ---- generate / import：走积分 ----
  const sb = adminClient();
  const { data: sysRow } = await sb
    .from('system_config')
    .select('value')
    .eq('key', 'exam')
    .maybeSingle();
  const examCfg = ((sysRow?.value ?? {}) as ExamConfig);

  let cost = 0;
  let sectionsForTokens: SectionSpec[] = [];
  if (action === 'import') {
    cost = Number(examCfg.importCostCredits ?? 0.5);
    // import 不知道结构，按默认平均估算 token 上限
    sectionsForTokens = [{ sectionTitle: 'x', qtype: 'choice', count: 20, score: 1 }];
  } else {
    const gen = body as GenerateBody;
    sectionsForTokens = gen.sections;
    cost = computeExamCost(gen.sections, examCfg, typeCfg?.creditCost ?? 2);
  }

  // ---- 预扣积分 ----
  const jobId = crypto.randomUUID();
  const modelId = modelCfg?.id ?? '';
  const reserve = await sb.rpc('reserve_credits', {
    p_amount: cost,
    p_job_id: jobId,
    p_app_type: 'exam_paper',
    p_model: modelId,
  });
  const reserveRaw = (reserve.data ?? {}) as { ok?: boolean; balance?: number; code?: string };
  if (reserveRaw.ok !== true) {
    return jsonError(402, { code: 'INSUFFICIENT_CREDITS', message: '积分不足啦，可以用兑换码充值，或联系管理员' });
  }

  // ---- 插 job 行（供失败退款）----
  let reserved = true;
  await sb.from('generation_jobs').insert({
    id: jobId,
    user_id: caller.userId,
    app_id: null,
    app_type: 'exam_paper',
    model: modelId,
    status: 'running',
    reserved_credits: cost,
    idempotency_key: jobId,
  });

  // ---- 拼提示词 + 调模型 + 校验（失败重试 1 次）----
  try {
    const userPrompt =
      action === 'import'
        ? buildImportUserPrompt((body as ImportBody).text)
        : buildGenerateUserPrompt(body as GenerateBody);

    const maxOutput = estimateMaxTokens(sectionsForTokens);
    const llmReq: LlmRequest = {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      maxOutputTokens: maxOutput,
      temperature: 0.7,
    };

    const startedAt = Date.now();
    let raw = await callModel(adapter, llmReq, modelCfg);

    let paper: ExamPaper;
    try {
      paper = parsePaper(raw);
    } catch (firstErr) {
      const reason = firstErr instanceof Error ? firstErr.message : '格式有误';
      const repairUser = userPrompt + '\n\n你上一次的输出没有通过格式校验（' + reason + '）。请重新输出**完整**的试卷 JSON，' + FENCE_HINT;
      raw = await callModel(adapter, { ...llmReq, userPrompt: repairUser }, modelCfg);
      paper = parsePaper(raw); // 仍失败则抛出 → 外层退款
    }

    // ---- 结算 ----
    const generationMs = Date.now() - startedAt;
    await sb.rpc('settle_generation', {
      p_job_id: jobId,
      p_tokens_in: 0,
      p_tokens_out: 0,
      p_cost_cny: 0,
      p_model: modelId,
      p_ms: generationMs,
    });

    return jsonOk({ ok: true, paper });
  } catch (err) {
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
