import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import type {
  PracticeQType,
  PracticeQuestion,
  PracticeSet,
  PracticeConfig,
  StudentQuestion,
  StudentPractice,
  PracticeStats,
} from '@/types/practice';
import { parseCsv } from '@/utils/csv';

/**
 * 每日一练（T10）前端服务层。
 *
 * 设计要点：
 * - 所有请求经此层收口，页面组件禁止直接 import supabaseClient；
 * - 积分只从 `app_type_profiles` / `system_config` 读取，绝不写死数字（见 PLAN §5）；
 * - 学生端读题 / 判分一律走白名单 RPC，前端不持有答案（见 PLAN §三 / §六）；
 * - 新表（practices / practice_questions / practice_submissions）与四个 RPC 尚未进入
 *   `src/types/database.ts`（待 0038 迁移上线后再 `supabase gen types` 补回），
 *   故本文件统一用 `PracticeClient`（any 过渡）访问它们，待类型补全后可整体移除。
 *
 * 出口契约（供页面并行开发，签名不要改）：见 docs/PLAN_每日一练.md 第八节。
 */

/** 过渡用客户端：把 SupabaseClient 断言成「含每日一练新表 / 新 RPC」的形状。
 *  ⚠️ 待 0038 迁移上线、重新生成 src/types/database.ts 后删除本类型与所有 as unknown as。 */
type PracticeClient = {
  from(table: string): any;
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }>;
  functions: {
    invoke(name: string, opts: { body: Record<string, unknown> }): Promise<{ data: any; error: any }>;
  };
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } | null }>;
  };
};

/** 取每日一练客户端；未连接后端时抛可展示的中文错误。 */
function practiceClient(): PracticeClient {
  const sb = getSupabase();
  if (!sb) {
    throw new AppError('NETWORK', '还没有连接云端服务，无法访问每日一练。请在 .env.local 配置 Supabase。');
  }
  return sb as unknown as PracticeClient;
}

/**
 * 取出 Edge Function 返回的真实错误文案。
 *
 * `functions.invoke` 在非 2xx 时只给一句通用的
 * "Edge Function returned a non-2xx status code"，真正的中文提示
 * （如「积分不足，请先充值」）藏在 `error.context`（原始 Response）里。
 * 这里解析出来，避免教师只看到一句没用的英文。逻辑与 authService.edgeErrorMessage 一致。
 */
async function edgeErrorMessage(error: unknown, fallback: string): Promise<string> {
  const res = (error as { context?: Response } | null)?.context;
  try {
    if (res && typeof (res as Response).json === 'function') {
      const body = (await (res as Response).json()) as { message?: string };
      if (body?.message) return body.message;
    }
  } catch {
    /* 解析失败就用兜底文案 */
  }
  const msg = (error as { message?: string } | null)?.message;
  return msg && !/non-2xx/i.test(msg) ? msg : fallback;
}

/** 每日一练配置兜底值（与迁移 0038 默认配置保持一致；读取失败时使用）。 */
const PRACTICE_CONFIG_DEFAULT: PracticeConfig = {
  dayTiers: [1, 3, 5, 10, 20],
  discountByDays: { '1': 1, '3': 0.9, '5': 0.84, '10': 0.68, '20': 0.6 },
  minDiscount: 0.6,
  importCostCredits: 0.5,
  questionPerDayDefault: 5,
};

// ---------------------------------------------------------------------------
// 配置 / 积分预估
// ---------------------------------------------------------------------------

/**
 * 读取每日一练配置（来自 system_config.practice）。
 *
 * @returns 配置对象；读取失败或未连接后端时返回内置默认值。
 */
export async function getPracticeConfig(): Promise<PracticeConfig> {
  const sb = getSupabase();
  if (!sb) return { ...PRACTICE_CONFIG_DEFAULT };
  try {
    const { data, error } = await sb.rpc('get_system_config', { p_key: 'practice' });
    if (error || data == null) return { ...PRACTICE_CONFIG_DEFAULT };
    const obj = data as unknown as Record<string, unknown>;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return { ...PRACTICE_CONFIG_DEFAULT };
    }
    const discountByDays =
      obj.discountByDays && typeof obj.discountByDays === 'object' && !Array.isArray(obj.discountByDays)
        ? (obj.discountByDays as Record<string, number>)
        : PRACTICE_CONFIG_DEFAULT.discountByDays;
    return {
      dayTiers: Array.isArray(obj.dayTiers) ? (obj.dayTiers as number[]) : PRACTICE_CONFIG_DEFAULT.dayTiers,
      discountByDays,
      minDiscount: typeof obj.minDiscount === 'number' ? obj.minDiscount : PRACTICE_CONFIG_DEFAULT.minDiscount,
      importCostCredits:
        typeof obj.importCostCredits === 'number'
          ? obj.importCostCredits
          : PRACTICE_CONFIG_DEFAULT.importCostCredits,
      questionPerDayDefault:
        typeof obj.questionPerDayDefault === 'number'
          ? obj.questionPerDayDefault
          : PRACTICE_CONFIG_DEFAULT.questionPerDayDefault,
    };
  } catch {
    return { ...PRACTICE_CONFIG_DEFAULT };
  }
}

/** 读取 daily_practice 的基准价（app_type_profiles.credit_cost）；读不到时回落 1。 */
async function getDailyPracticeBaseCredits(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 1;
  try {
    const { data, error } = await (sb as unknown as PracticeClient)
      .from('app_type_profiles')
      .select('credit_cost')
      .eq('app_type', 'daily_practice')
      .maybeSingle();
    if (error || !data) return 1;
    const cost = (data as { credit_cost?: number }).credit_cost;
    return typeof cost === 'number' ? cost : 1;
  } catch {
    return 1;
  }
}

/**
 * 预估一次 AI 生成的积分消耗（展示用，非实际扣费）。
 *
 * 公式：基准价 × 天数 × 折扣，折扣 = max(minDiscount, discountByDays[天数] ?? 1)。
 * 结果保留 1 位小数；积分系统支持小数，这里返回 number（不取整），
 * 具体四舍五入以 Edge 端扣费为准，前端只做预估展示。
 *
 * @param dayCount 练习天数。
 */
export async function estimatePracticeCredits(dayCount: number): Promise<number> {
  const cfg = await getPracticeConfig();
  const baseline = await getDailyPracticeBaseCredits();
  const discount = Math.max(cfg.minDiscount, cfg.discountByDays[String(dayCount)] ?? 1);
  const credits = baseline * dayCount * discount;
  // 保留 1 位小数；返回 number，不 Math.round/ceil 成整数
  return Number(credits.toFixed(1));
}

// ---------------------------------------------------------------------------
// 生成 / 导入题目
// ---------------------------------------------------------------------------

/** AI 生成题目入参（与 Edge `practice` action:'generate' 对齐）。 */
export interface GeneratePracticeInput {
  subject: string;
  grade: string;
  chapter: string;
  textbookVersionId: string | null;
  dayCount: number;
  questionPerDay: number;
  qtypes: PracticeQType[];
  difficulty: string;
}

/** AI 生成 / AI 识别题目结果。 */
export interface GeneratePracticeResult {
  questions: PracticeQuestion[];
}

/**
 * 调用 Edge Function 生成每日一练题目。
 *
 * @param input 生成参数（学科 / 年级 / 章节 / 天数 / 每天题量 / 题型 / 难度）。
 */
export async function generatePractice(input: GeneratePracticeInput): Promise<GeneratePracticeResult> {
  const cl = practiceClient();
  const { data, error } = await cl.functions.invoke('practice', {
    body: { action: 'generate', ...input },
  });
  if (error) {
    throw new AppError('UNKNOWN', await edgeErrorMessage(error, '生成练习失败，请稍后重试'), error);
  }
  const raw = (data ?? {}) as { questions?: unknown[] };
  const questions: PracticeQuestion[] = Array.isArray(raw.questions)
    ? raw.questions.map((q, i) => normalizeQuestion(q, i))
    : [];
  return { questions };
}

/**
 * 调用 Edge Function 用 AI 识别老师粘贴 / 上传的题目文本。
 *
 * @param text 老师粘贴的题面文本（模板规整时建议先走 parseQuestionsLocally 省积分）。
 */
export async function importQuestionsWithAi(text: string): Promise<GeneratePracticeResult> {
  const cl = practiceClient();
  const { data, error } = await cl.functions.invoke('practice', {
    body: { action: 'import', text },
  });
  if (error) {
    throw new AppError('UNKNOWN', await edgeErrorMessage(error, 'AI 识别题目失败，请稍后重试'), error);
  }
  const raw = (data ?? {}) as { questions?: unknown[] };
  const questions: PracticeQuestion[] = Array.isArray(raw.questions)
    ? raw.questions.map((q, i) => normalizeQuestion(q, i))
    : [];
  return { questions };
}

/** 把 Edge 返回的题目规整成强类型 PracticeQuestion（缺省字段补兜底值）。 */
function normalizeQuestion(raw: unknown, index: number): PracticeQuestion {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    dayNo: typeof r.dayNo === 'number' ? r.dayNo : 1,
    seq: typeof r.seq === 'number' ? r.seq : index + 1,
    qtype: r.qtype as PracticeQType,
    stem: String(r.stem ?? ''),
    options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
    answer: Array.isArray(r.answer) ? (r.answer as string[]) : [],
    explanation: typeof r.explanation === 'string' ? r.explanation : undefined,
  };
}

// ---------------------------------------------------------------------------
// 本地 CSV 解析（纯前端，省积分）
// ---------------------------------------------------------------------------

/** 题型别名 → 标准题型。 */
const QTYPE_ALIASES: Record<string, PracticeQType> = {
  单选: 'choice',
  选择题: 'choice',
  选择: 'choice',
  choice: 'choice',
  填空: 'fill',
  填空题: 'fill',
  fill: 'fill',
  判断: 'judge',
  判断题: 'judge',
  judge: 'judge',
};

/** 判断题「对」的同义词。 */
const JUDGE_TRUE = ['对', '正确', '√', 't', 'true'];
/** 判断题「错」的同义词。 */
const JUDGE_FALSE = ['错', '错误', '×', 'f', 'false'];

/** 把老师填的题型文案映射成标准题型；识别不出返回 null。 */
function mapQType(raw: string): PracticeQType | null {
  if (!raw) return null;
  const t = raw.trim();
  if (QTYPE_ALIASES[t]) return QTYPE_ALIASES[t];
  const low = t.toLowerCase();
  return QTYPE_ALIASES[low] ?? null;
}

/**
 * 把老师填的答案按题型组装成 answer 数组。
 * ⚠️ 填空：老师填的本来就是 `|` 分隔的多个空，照搬到**单个数组元素**里
 * （如 ["又大又红|又香又甜"]），与数据库约定一致，绝不拆成多个数组元素。
 */
function buildAnswer(qtype: PracticeQType, rawAnswer: string): string[] {
  const s = (rawAnswer ?? '').trim();
  if (!s) return [];
  if (qtype === 'choice') {
    const m = s.match(/[A-Za-z]/);
    return m ? [m[0].toUpperCase()] : [];
  }
  if (qtype === 'judge') {
    const low = s.toLowerCase();
    if (JUDGE_TRUE.includes(low)) return ['对'];
    if (JUDGE_FALSE.includes(low)) return ['错'];
    return [];
  }
  // fill：单个数组元素，内部 `|` 分隔多个空
  return [s];
}

/** 一列 CSV 行（8 列）转成 PracticeQuestion；非法行返回 null。 */
function rowToQuestion(cols: string[], seq: number): PracticeQuestion | null {
  if (!cols || cols.length === 0) return null;
  const qtype = mapQType(cols[0] ?? '');
  if (!qtype) return null;
  const stem = (cols[1] ?? '').trim();
  if (!stem) return null;
  const answer = buildAnswer(qtype, cols[6] ?? '');
  if (answer.length === 0) return null;
  const options =
    qtype === 'choice'
      ? cols.slice(2, 6).map((o) => (o ?? '').trim()).filter((o) => o.length > 0)
      : undefined;
  const explanation = (cols[7] ?? '').trim();
  return {
    dayNo: 1,
    seq,
    qtype,
    stem,
    options,
    answer,
    explanation: explanation.length > 0 ? explanation : undefined,
  };
}

/**
 * 纯前端按模板解析 CSV（不调模型，0 成本）。
 *
 * 列序：题型, 题干, 选项A, 选项B, 选项C, 选项D, 答案, 解析。
 * 题型映射：单选/选择/choice→choice，填空/fill→fill，判断/判断题→judge。
 * 答案：choice 取字母；judge 映射成对/错；fill 按 `|` 存成**单个数组元素**。
 *
 * @param csvText 老师上传 / 粘贴的 CSV 文本（可带 UTF-8 BOM）。
 * @returns 解析出的题目；解析不出任何题目返回 []。
 */
export function parseQuestionsLocally(csvText: string): PracticeQuestion[] {
  const text = (csvText ?? '').replace(/^﻿/, ''); // 去掉可能的 UTF-8 BOM
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  // 若首行是表头则跳过
  const header = ['题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析'];
  let start = 0;
  const first = rows[0].map((c) => (c ?? '').trim());
  if (first.length >= header.length && header.every((h, idx) => first[idx] === h)) {
    start = 1;
  }

  const questions: PracticeQuestion[] = [];
  for (let i = start; i < rows.length; i += 1) {
    const q = rowToQuestion(rows[i], questions.length + 1);
    if (q) questions.push(q);
  }
  return questions;
}

// ---------------------------------------------------------------------------
// 保存 / 列表
// ---------------------------------------------------------------------------

/** 保存练习入参。 */
export interface SavePracticeInput {
  title: string;
  subject: string;
  grade: string;
  chapter: string;
  textbookVersionId: string | null;
  dayCount: number;
  source: 'ai' | 'upload';
  questions: PracticeQuestion[];
}

/** 保存练习结果。 */
export interface SavePracticeResult {
  id: string;
  shareSlug: string;
}

/**
 * 保存一套每日一练并发布（拿 /p/{slug} 链接）。
 *
 * 流程：insert practices（status='draft'，share_slug 用 DB 默认值）→
 * 批量 insert practice_questions → update status='published'。
 */
export async function savePractice(input: SavePracticeInput): Promise<SavePracticeResult> {
  const cl = practiceClient();

  // 取当前登录用户作为 owner（practices.owner_id 非空，RLS 校验）
  const { data: sessionData } = await cl.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '请先登录后再保存练习');

  const { data: practiceRow, error: insertErr } = await cl
    .from('practices')
    .insert({
      owner_id: uid,
      title: input.title,
      subject: input.subject,
      grade: input.grade,
      chapter: input.chapter,
      textbook_version_id: input.textbookVersionId,
      day_count: input.dayCount,
      source: input.source,
      status: 'draft',
    })
    .select('id, share_slug')
    .single();
  if (insertErr || !practiceRow) {
    throw new AppError('UNKNOWN', '保存练习失败，请稍后重试', insertErr);
  }
  const id = String((practiceRow as { id?: string }).id ?? '');
  if (!id) throw new AppError('UNKNOWN', '保存练习失败，请稍后重试');

  const questionRows = input.questions.map((q) => ({
    practice_id: id,
    day_no: q.dayNo,
    seq: q.seq,
    qtype: q.qtype,
    stem: q.stem,
    options: q.options ?? null,
    answer: q.answer,
    explanation: q.explanation ?? null,
  }));
  const { error: qErr } = await cl.from('practice_questions').insert(questionRows);
  if (qErr) {
    throw new AppError('UNKNOWN', '保存题目失败，请稍后重试', qErr);
  }

  const { error: pubErr } = await cl.from('practices').update({ status: 'published' }).eq('id', id);
  if (pubErr) {
    throw new AppError('UNKNOWN', '发布练习失败，请稍后重试', pubErr);
  }

  const shareSlug = String((practiceRow as { share_slug?: string }).share_slug ?? '');
  return { id, shareSlug };
}

/**
 * 列出当前用户自己的每日一练（created_at 倒序）。
 * 题目数量用 practice_questions 的 count 嵌套 select 获取。
 */
export async function listMyPractices(): Promise<PracticeSet[]> {
  const cl = practiceClient();
  const { data: sessionData } = await cl.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '请先登录后再查看');

  const { data, error } = await cl
    .from('practices')
    .select(
      'id, title, subject, grade, chapter, day_count, status, share_slug, source, created_at, practice_questions(count)',
    )
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });
  if (error) {
    throw new AppError('UNKNOWN', '读取我的练习失败，请稍后重试', error);
  }

  const rows = (data ?? []) as Array<Record<string, any>>;
  return rows.map((r) => {
    const countArr = r.practice_questions as Array<{ count?: number }> | undefined;
    const questionCount =
      Array.isArray(countArr) && countArr[0]?.count != null ? Number(countArr[0].count) : 0;
    return {
      id: String(r.id),
      title: String(r.title ?? ''),
      subject: String(r.subject ?? ''),
      grade: String(r.grade ?? ''),
      chapter: String(r.chapter ?? ''),
      dayCount: Number(r.day_count ?? 1),
      status: r.status as PracticeSet['status'],
      shareSlug: String(r.share_slug ?? ''),
      source: r.source as PracticeSet['source'],
      questionCount,
      createdAt: String(r.created_at ?? ''),
    };
  });
}

// ---------------------------------------------------------------------------
// 学生端（免登录）
// ---------------------------------------------------------------------------

/** 学生端练习概要 + 题目（去敏，无答案）。 */
export interface GetPracticeForStudentResult {
  set: StudentPractice;
  questions: StudentQuestion[];
}

/**
 * 学生端读取一套练习（免登录，走白名单 RPC，绝不含 answer / explanation）。
 *
 * @param slug 分享短码（/p/{slug}）。
 */
export async function getPracticeForStudent(slug: string): Promise<GetPracticeForStudentResult> {
  const cl = practiceClient();
  const { data, error } = await cl.rpc('get_practice_for_student', { p_slug: slug });
  if (error) {
    throw new AppError('UNKNOWN', '读取练习失败，请稍后重试', error);
  }
  const rows = (data ?? []) as Array<Record<string, any>>;
  if (rows.length === 0) {
    throw new AppError('NOT_FOUND', '练习不存在，或已关闭作答');
  }
  const first = rows[0];
  const set: StudentPractice = {
    title: String(first.title ?? ''),
    grade: String(first.grade ?? ''),
    subject: String(first.subject ?? ''),
    chapter: String(first.chapter ?? ''),
    dayCount: Number(first.day_count ?? 1),
    status: String(first.status ?? ''),
  };
  const questions: StudentQuestion[] = rows.map((r) => ({
    dayNo: Number(r.day_no ?? 1),
    seq: Number(r.seq ?? 0),
    qtype: r.qtype as PracticeQType,
    stem: String(r.stem ?? ''),
    options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
  }));
  return { set, questions };
}

/** 学生提交作答入参。 */
export interface SubmitAnswersInput {
  slug: string;
  dayNo: number;
  studentName: string;
  answers: string[];
}

/** 学生提交作答结果。 */
export interface SubmitResult {
  score: number;
  total: number;
  perQuestion: boolean[];
  explanations: string[];
}

/**
 * 学生提交某天作答（服务端判分，前端不持有答案）。
 *
 * @param input slug + 第几天 + 昵称（可选）+ 作答数组（下标对齐该天题目）。
 */
export async function submitPracticeAnswers(input: SubmitAnswersInput): Promise<SubmitResult> {
  const cl = practiceClient();
  const { data, error } = await cl.rpc('submit_practice_answer', {
    p_slug: input.slug,
    p_day_no: input.dayNo,
    p_student_name: input.studentName,
    p_answers: input.answers,
  });
  if (error) {
    throw new AppError('UNKNOWN', '提交失败，请稍后重试', error);
  }
  const d = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    score?: number;
    total?: number;
    perQuestion?: unknown[];
    explanations?: unknown[];
  };
  if (d.ok === false) {
    throw new AppError('UNKNOWN', d.error ?? '提交失败，请稍后重试');
  }
  return {
    score: Number(d.score ?? 0),
    total: Number(d.total ?? 0),
    perQuestion: Array.isArray(d.perQuestion) ? (d.perQuestion as boolean[]) : [],
    explanations: Array.isArray(d.explanations) ? d.explanations.map((e) => String(e ?? '')) : [],
  };
}

// ---------------------------------------------------------------------------
// 教师看板
// ---------------------------------------------------------------------------

/**
 * 读取某次练习的完成情况与每题正确率（仅作者 / 管理员）。
 *
 * @param practiceId 练习集 id。
 */
export async function getPracticeStats(practiceId: string): Promise<PracticeStats> {
  const cl = practiceClient();
  const { data, error } = await cl.rpc('list_practice_stats', { p_practice_id: practiceId });
  if (error) {
    throw new AppError('UNKNOWN', '读取统计失败，请稍后重试', error);
  }
  const d = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    submissions?: unknown[];
    perQuestion?: unknown[];
  };
  if (d.ok === false) {
    throw new AppError('FORBIDDEN', d.error ?? '无权查看该练习');
  }
  const submissions = Array.isArray(d.submissions)
    ? (d.submissions as Array<Record<string, any>>).map((s) => ({
        studentName: String(s.studentName ?? ''),
        dayNo: Number(s.dayNo ?? 0),
        score: Number(s.score ?? 0),
        total: Number(s.total ?? 0),
        submittedAt: String(s.submittedAt ?? ''),
      }))
    : [];
  const perQuestion = Array.isArray(d.perQuestion)
    ? (d.perQuestion as Array<Record<string, any>>).map((p) => ({
        dayNo: Number(p.dayNo ?? 0),
        seq: Number(p.seq ?? 0),
        stem: String(p.stem ?? ''),
        correctRate: Number(p.correctRate ?? 0),
      }))
    : [];
  return { submissions, perQuestion };
}

/**
 * 关闭某次练习的作答（学生端一律拒绝）。
 *
 * @param practiceId 练习集 id。
 */
export async function closePractice(practiceId: string): Promise<void> {
  const cl = practiceClient();
  const { error } = await cl.from('practices').update({ status: 'closed' }).eq('id', practiceId);
  if (error) {
    throw new AppError('UNKNOWN', '关闭练习失败，请稍后重试', error);
  }
}

/**
 * 一键清空某次练习的全部学生提交（数据最小化要求）。
 *
 * @param practiceId 练习集 id。
 */
export async function clearSubmissions(practiceId: string): Promise<void> {
  const cl = practiceClient();
  const { data, error } = await cl.rpc('clear_practice_submissions', { p_practice_id: practiceId });
  if (error) {
    throw new AppError('UNKNOWN', '清空提交失败，请稍后重试', error);
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string };
  if (d.ok === false) {
    throw new AppError('FORBIDDEN', d.error ?? '无权清空该练习');
  }
}
