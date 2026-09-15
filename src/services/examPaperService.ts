import { getSupabase } from './supabaseClient';
import { AppError } from './http/errors';
import { downloadCsv } from '@/utils/csv';
import type {
  ExamConfig,
  ExamPaper,
  ExamPaperSet,
  ExamPaperSource,
  ExamPaperStats,
  ExamQType,
  ExamQuestion,
  ExamSection,
  KnowledgePoint,
  QuestionBankItem,
  StudentExamPaper,
  StudentExamQuestion,
} from '@/types/examPaper';

/**
 * 组卷（T11）前端服务层。
 *
 * 设计要点（照 `practiceService.ts` 的写法）：
 * - 所有请求经此层收口，页面组件禁止直接 import supabaseClient（安全红线）；
 * - 积分只读 `system_config.exam` 与 `app_type_profiles.credit_cost`，绝不写死数字；
 * - 学生端读题 / 判分一律走白名单 RPC，前端不持有答案；
 * - 新表（exam_papers / exam_paper_questions / exam_paper_submissions / question_bank /
 *   knowledge_points）与 RPC 尚未进入 `src/types/database.ts`，故统一用 `ExamClient`
 *   （any 过渡）访问，待重新 `supabase gen types` 后可整体移除。
 */

/** 过渡用客户端：把 SupabaseClient 断言成「含组卷新表 / 新 RPC」的形状。 */
type ExamClient = {
  from(table: string): any;
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }>;
  functions: {
    invoke(name: string, opts: { body: Record<string, unknown> }): Promise<{ data: any; error: any }>;
  };
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } | null }>;
  };
};

/** 取组卷客户端；未连接后端时抛可展示的中文错误。 */
function examClient(): ExamClient {
  const sb = getSupabase();
  if (!sb) {
    throw new AppError('NETWORK', '还没有连接云端服务，无法使用组卷。请在 .env.local 配置 Supabase。');
  }
  return sb as unknown as ExamClient;
}

/**
 * 取出 Edge Function 返回的真实错误文案。
 *
 * `functions.invoke` 在非 2xx 时只给一句通用的英文，真正的中文提示
 * （如「积分不足，请先充值」）藏在 `error.context`（原始 Response）里。
 * 逻辑与 `practiceService.edgeErrorMessage` 完全一致。
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

/** 组卷配置兜底值（与迁移 0040 的默认配置保持一致；读取失败时使用）。 */
const EXAM_CONFIG_DEFAULT: ExamConfig = {
  questionCost: { choice: 0.1, fill: 0.1, judge: 0.08, subjective: 0.25 },
  bulkTiers: [
    { min: 1, discount: 1 },
    { min: 20, discount: 0.9 },
    { min: 40, discount: 0.8 },
  ],
  minDiscount: 0.6,
  importCostCredits: 0.5,
  defaultQuestionCount: 20,
};

// ---------------------------------------------------------------------------
// 配置 / 积分预估
// ---------------------------------------------------------------------------

/**
 * 读取组卷配置（来自 system_config.exam）。
 *
 * @returns 配置对象；读取失败或未连接后端时返回内置默认值（数值与 0040 迁移一致）。
 */
export async function getExamConfig(): Promise<ExamConfig> {
  const sb = getSupabase();
  if (!sb) return { ...EXAM_CONFIG_DEFAULT };
  try {
    const { data, error } = await sb.rpc('get_system_config', { p_key: 'exam' });
    if (error || data == null) return { ...EXAM_CONFIG_DEFAULT };
    const obj = data as unknown as Record<string, unknown>;
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return { ...EXAM_CONFIG_DEFAULT };
    }
    const qc =
      obj.questionCost && typeof obj.questionCost === 'object' && !Array.isArray(obj.questionCost)
        ? (obj.questionCost as Record<string, number>)
        : EXAM_CONFIG_DEFAULT.questionCost;
    const tiers = Array.isArray(obj.bulkTiers)
      ? (obj.bulkTiers as Array<{ min?: number; discount?: number }>).map((t) => ({
          min: Number(t?.min ?? 1),
          discount: Number(t?.discount ?? 1),
        }))
      : EXAM_CONFIG_DEFAULT.bulkTiers;
    return {
      questionCost: qc,
      bulkTiers: tiers.length > 0 ? tiers : EXAM_CONFIG_DEFAULT.bulkTiers,
      minDiscount: typeof obj.minDiscount === 'number' ? obj.minDiscount : EXAM_CONFIG_DEFAULT.minDiscount,
      importCostCredits:
        typeof obj.importCostCredits === 'number'
          ? obj.importCostCredits
          : EXAM_CONFIG_DEFAULT.importCostCredits,
      defaultQuestionCount:
        typeof obj.defaultQuestionCount === 'number'
          ? obj.defaultQuestionCount
          : EXAM_CONFIG_DEFAULT.defaultQuestionCount,
    };
  } catch {
    return { ...EXAM_CONFIG_DEFAULT };
  }
}

/** 读取 exam_paper 的基准价（app_type_profiles.credit_cost）；读不到时回落 2。 */
async function getExamBaseCredits(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 2;
  try {
    const { data, error } = await (sb as unknown as ExamClient)
      .from('app_type_profiles')
      .select('credit_cost')
      .eq('app_type', 'exam_paper')
      .maybeSingle();
    if (error || !data) return 2;
    const cost = (data as { credit_cost?: number }).credit_cost;
    return typeof cost === 'number' ? cost : 2;
  } catch {
    return 2;
  }
}

/** 大题规格（积分预估入参，与 Edge 的 SectionSpec 对齐）。 */
export interface ExamSectionSpec {
  qtype: ExamQType;
  count: number;
  score: number;
}

/**
 * 预估一次组卷的积分消耗（展示用，非实际扣费）。
 *
 * 公式（与 Edge `computeExamCost` 同口径）：
 * raw = Σ(单题积分 × 题数)；discount = max(minDiscount, 命中的最小阶梯折扣)；
 * 取 max(基准价 × discount, raw × discount)，保留 1 位小数。
 *
 * @param sections 大题规格列表。
 */
export async function estimateExamCredits(sections: ExamSectionSpec[]): Promise<number> {
  const cfg = await getExamConfig();
  const baseline = await getExamBaseCredits();
  let total = 0;
  let raw = 0;
  for (const s of sections) {
    const c = Math.max(0, Math.floor(s.count || 0));
    total += c;
    raw += (cfg.questionCost[s.qtype] ?? 0.1) * c;
  }
  if (total === 0) return 0;

  let discount = 1;
  for (const t of cfg.bulkTiers) {
    if (total >= (t.min ?? 1)) discount = Math.min(discount, t.discount ?? 1);
  }
  discount = Math.max(cfg.minDiscount, discount);

  const byBase = Math.ceil(baseline * discount * 100) / 100;
  const byDetail = Math.ceil(raw * discount * 100) / 100;
  return Number(Math.max(byBase, byDetail).toFixed(1));
}

// ---------------------------------------------------------------------------
// AI 出卷：解析原卷 / 生成 / 导入
// ---------------------------------------------------------------------------

/** 大题（Edge 返回的原始结构，未带 sectionNo/seq）。 */
interface EdgeSection {
  sectionTitle?: string;
  questions?: unknown[];
}

/** 把 Edge 返回的大题数组规整成强类型 ExamSection[]（补 sectionNo / seq）。 */
function normalizeSections(raw: unknown, fallbackScore = 1): ExamSection[] {
  if (!Array.isArray(raw)) return [];
  const sections: ExamSection[] = [];
  (raw as EdgeSection[]).forEach((sec, si) => {
    const s = (sec ?? {}) as EdgeSection;
    const questions: ExamQuestion[] = Array.isArray(s.questions)
      ? (s.questions as Array<Record<string, unknown>>).map((q, i) => normalizeQuestion(q, si + 1, i + 1, fallbackScore))
      : [];
    if (questions.length === 0) return;
    sections.push({
      sectionNo: si + 1,
      sectionTitle: String(s.sectionTitle ?? `第 ${si + 1} 大题`),
      qtype: questions[0].qtype,
      score: questions[0].score,
      questions,
    });
  });
  return sections;
}

/** 把 Edge 返回的题目规整成强类型 ExamQuestion（缺省字段补兜底值）。 */
function normalizeQuestion(
  raw: unknown,
  sectionNo: number,
  seq: number,
  fallbackScore = 1,
): ExamQuestion {
  const r = (raw ?? {}) as Record<string, unknown>;
  const qtype = (['choice', 'fill', 'judge', 'subjective'] as string[]).includes(String(r.qtype))
    ? (String(r.qtype) as ExamQType)
    : 'fill';
  const options = Array.isArray(r.options) ? (r.options as string[]) : undefined;
  return {
    sectionNo,
    sectionTitle: String(r.sectionTitle ?? ''),
    seq,
    qtype,
    stem: String(r.stem ?? ''),
    options: qtype === 'choice' ? options : undefined,
    answer: Array.isArray(r.answer) ? (r.answer as string[]) : [],
    explanation: typeof r.explanation === 'string' && r.explanation ? r.explanation : undefined,
    score: typeof r.score === 'number' ? r.score : fallbackScore,
    knowledgePoint: typeof r.knowledgePoint === 'string' ? r.knowledgePoint : undefined,
  };
}

/** 原卷解析入参。 */
export interface ParseOriginalPaperInput {
  text: string;
  subject?: string;
  grade?: string;
  unit?: string;
}

/** 原卷解析结果（免费，仅分析）。 */
export interface ParseOriginalPaperResult {
  paper: ExamPaper;
  knowledgePoints: string[];
  /** 顺手沉淀进题库的题数（0 = 未沉淀，不影响主流程）。 */
  bankSaved: number;
}

/**
 * 解析老师上传的原卷（AI 免费分析）：抽出知识点清单 + 结构化大题。
 *
 * @param input 原卷文本 + 可选的 学科/年级/单元（用于题库沉淀定位）。
 */
export async function parseOriginalPaper(input: ParseOriginalPaperInput): Promise<ParseOriginalPaperResult> {
  const cl = examClient();
  const { data, error } = await cl.functions.invoke('exam-paper', {
    body: {
      action: 'parse',
      text: input.text,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      unit: input.unit ?? null,
    },
  });
  if (error) {
    throw new AppError('UNKNOWN', await edgeErrorMessage(error, '解析原卷失败，请稍后重试'), error);
  }
  const raw = (data ?? {}) as { paper?: Record<string, unknown>; bankSaved?: number };
  const p = (raw.paper ?? {}) as Record<string, unknown>;
  const sections = normalizeSections(p.sections);
  const knowledgePoints = Array.isArray(p.knowledgePoints)
    ? (p.knowledgePoints as unknown[]).map((k) => String(k ?? '').trim()).filter((k) => k.length > 0)
    : [];
  return {
    paper: {
      title: String(p.title ?? '未命名测验卷'),
      subject: input.subject ?? '',
      grade: input.grade ?? '',
      unit: input.unit ?? '',
      chapter: '',
      sections,
      knowledgePoints,
    },
    knowledgePoints,
    bankSaved: Number(raw.bankSaved ?? 0),
  };
}

/** AI 生成入参。 */
export interface GenerateExamInput {
  grade: string;
  subject: string;
  unit?: string;
  title?: string;
  sections: ExamSectionSpec[];
  /** 原卷文本（变式时提供，仅供提取知识点与结构）。 */
  sourceText?: string;
  knowledgePoints?: string[];
  extra?: string;
}

/** AI 生成结果。 */
export interface GenerateExamResult {
  paper: ExamPaper;
  bankSaved: number;
}

/**
 * 调用 Edge Function 按 年级+科目+单元+大题结构 生成一套新测验卷。
 *
 * @param input 生成参数。
 */
export async function generateExam(input: GenerateExamInput): Promise<GenerateExamResult> {
  const cl = examClient();
  const { data, error } = await cl.functions.invoke('exam-paper', {
    body: {
      action: 'generate',
      grade: input.grade,
      subject: input.subject,
      unit: input.unit ?? null,
      textbookVersionId: null,
      title: input.title ?? '',
      sections: input.sections.map((s) => ({
        sectionTitle: qtypeLabel(s.qtype),
        qtype: s.qtype,
        count: s.count,
        score: s.score,
      })),
      sourceText: input.sourceText ?? '',
      knowledgePoints: input.knowledgePoints ?? [],
      extra: input.extra ?? '',
    },
  });
  if (error) {
    throw new AppError('UNKNOWN', await edgeErrorMessage(error, '生成测验卷失败，请稍后重试'), error);
  }
  const raw = (data ?? {}) as { paper?: Record<string, unknown>; bankSaved?: number };
  const p = (raw.paper ?? {}) as Record<string, unknown>;
  return {
    paper: {
      title: String(p.title ?? '').trim() || (input.title ?? '').trim() || '未命名测验卷',
      subject: input.subject,
      grade: input.grade,
      unit: input.unit ?? '',
      chapter: '',
      sections: normalizeSections(p.sections),
    },
    bankSaved: Number(raw.bankSaved ?? 0),
  };
}

/** AI 原样结构化入参。 */
export interface ImportExamInput {
  text: string;
  subject?: string;
  grade?: string;
  unit?: string;
}

/**
 * 调用 Edge Function 把老师粘贴的原卷**原样**结构化成测验卷（不改编）。
 *
 * @param input 原卷文本 + 可选定位信息。
 */
export async function importExamWithAi(input: ImportExamInput): Promise<GenerateExamResult> {
  const cl = examClient();
  const { data, error } = await cl.functions.invoke('exam-paper', {
    body: {
      action: 'import',
      text: input.text,
      subject: input.subject ?? null,
      grade: input.grade ?? null,
      unit: input.unit ?? null,
    },
  });
  if (error) {
    throw new AppError('UNKNOWN', await edgeErrorMessage(error, 'AI 识别原卷失败，请稍后重试'), error);
  }
  const raw = (data ?? {}) as { paper?: Record<string, unknown>; bankSaved?: number };
  const p = (raw.paper ?? {}) as Record<string, unknown>;
  return {
    paper: {
      title: String(p.title ?? '').trim() || '未命名测验卷（导入）',
      subject: input.subject ?? '',
      grade: input.grade ?? '',
      unit: input.unit ?? '',
      chapter: '',
      sections: normalizeSections(p.sections),
    },
    bankSaved: Number(raw.bankSaved ?? 0),
  };
}

// ---------------------------------------------------------------------------
// 保存 / 列表
// ---------------------------------------------------------------------------

/** 保存试卷入参。 */
export interface SaveExamInput {
  title: string;
  subject: string;
  grade: string;
  unit: string;
  source: ExamPaperSource;
  sections: ExamSection[];
}

/** 保存试卷结果。 */
export interface SaveExamResult {
  id: string;
  shareSlug: string;
}

/** 题型 → 中文标签（生成大题兜底标题用）。 */
function qtypeLabel(qtype: ExamQType): string {
  switch (qtype) {
    case 'choice':
      return '选择题';
    case 'fill':
      return '填空题';
    case 'judge':
      return '判断题';
    case 'subjective':
      return '主观题';
    default:
      return '题目';
  }
}

/**
 * 保存一套测验卷并发布（拿 /e/{slug} 链接）。
 *
 * 流程：insert exam_papers（status='draft'，share_slug 用 DB 默认值）→
 * 批量 insert exam_paper_questions（section_no/seq 重新编号）→ update status='published'。
 *
 * ⚠️ `source='bank'`（从题库挑题组成）在数据库 check 里没有，统一落成 'upload'
 * （语义上都是"非 AI 生成的卷"），避免违反 exam_papers_source 约束。
 */
export async function saveExam(input: SaveExamInput): Promise<SaveExamResult> {
  const cl = examClient();
  const { data: sessionData } = await cl.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '请先登录后再保存测验卷');

  const { data: paperRow, error: insertErr } = await cl
    .from('exam_papers')
    .insert({
      owner_id: uid,
      title: input.title,
      subject: input.subject,
      grade: input.grade,
      unit: input.unit,
      source: input.source === 'ai' ? 'ai' : 'upload',
      status: 'draft',
    })
    .select('id, share_slug')
    .single();
  if (insertErr || !paperRow) {
    throw new AppError('UNKNOWN', '保存测验卷失败，请稍后重试', insertErr);
  }
  const id = String((paperRow as { id?: string }).id ?? '');
  if (!id) throw new AppError('UNKNOWN', '保存测验卷失败，请稍后重试');

  const questionRows: Array<Record<string, unknown>> = [];
  input.sections.forEach((sec, si) => {
    const sectionNo = si + 1;
    sec.questions.forEach((q, qi) => {
      questionRows.push({
        paper_id: id,
        section_no: sectionNo,
        section_title: sec.sectionTitle || qtypeLabel(sec.qtype),
        seq: qi + 1,
        qtype: q.qtype,
        stem: q.stem,
        options: q.qtype === 'choice' ? q.options ?? null : null,
        answer: q.answer,
        explanation: q.explanation ?? null,
        score: q.score,
        knowledge_point: q.knowledgePoint ?? null,
      });
    });
  });

  if (questionRows.length === 0) {
    throw new AppError('VALIDATE_FAILED', '这套卷还没有题目，请先添加题目');
  }

  const { error: qErr } = await cl.from('exam_paper_questions').insert(questionRows);
  if (qErr) {
    throw new AppError('UNKNOWN', '保存题目失败，请稍后重试', qErr);
  }

  const { error: pubErr } = await cl
    .from('exam_papers')
    .update({ status: 'published' })
    .eq('id', id);
  if (pubErr) {
    throw new AppError('UNKNOWN', '发布测验卷失败，请稍后重试', pubErr);
  }

  return { id, shareSlug: String((paperRow as { share_slug?: string }).share_slug ?? '') };
}

/**
 * 列出当前用户自己的测验卷（created_at 倒序）。
 * 题数用 exam_paper_questions 的 count 嵌套 select；总分用 score 求和（前端累加）。
 */
export async function listMyExams(): Promise<ExamPaperSet[]> {
  const cl = examClient();
  const { data: sessionData } = await cl.auth.getSession();
  const uid = sessionData?.session?.user?.id;
  if (!uid) throw new AppError('UNAUTHORIZED', '请先登录后再查看');

  const { data, error } = await cl
    .from('exam_papers')
    .select(
      'id, title, subject, grade, unit, chapter, status, share_slug, source, created_at, exam_paper_questions(score)',
    )
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });
  if (error) {
    throw new AppError('UNKNOWN', '读取我的组卷失败，请稍后重试', error);
  }

  const rows = (data ?? []) as Array<Record<string, any>>;
  return rows.map((r) => {
    const arr = r.exam_paper_questions as Array<{ count?: number; score?: number | string }> | undefined;
    const questionCount = Array.isArray(arr) ? arr.length : 0;
    const totalScore = Array.isArray(arr)
      ? arr.reduce((sum, x) => sum + Number(x?.score ?? 0), 0)
      : 0;
    return {
      id: String(r.id),
      title: String(r.title ?? ''),
      subject: String(r.subject ?? ''),
      grade: String(r.grade ?? ''),
      unit: String(r.unit ?? ''),
      chapter: String(r.chapter ?? ''),
      status: r.status as ExamPaperSet['status'],
      shareSlug: String(r.share_slug ?? ''),
      source: r.source as ExamPaperSet['source'],
      questionCount,
      totalScore: Math.round(totalScore * 10) / 10,
      createdAt: String(r.created_at ?? ''),
    };
  });
}

// ---------------------------------------------------------------------------
// 学生端（免登录）
// ---------------------------------------------------------------------------

/** 学生端试卷概要 + 题目（去敏，无答案）。 */
export interface GetExamForStudentResult {
  paper: StudentExamPaper;
  questions: StudentExamQuestion[];
}

/**
 * 学生端读取一套测验卷（免登录，走白名单 RPC，绝不含 answer / explanation）。
 *
 * @param slug 分享短码（/e/{slug}）。
 */
export async function getExamForStudent(slug: string): Promise<GetExamForStudentResult> {
  const cl = examClient();
  const { data, error } = await cl.rpc('get_exam_paper_for_student', { p_slug: slug });
  if (error) {
    throw new AppError('UNKNOWN', '读取测验卷失败，请稍后重试', error);
  }
  const rows = (data ?? []) as Array<Record<string, any>>;
  if (rows.length === 0) {
    throw new AppError('NOT_FOUND', '测验卷不存在，或已关闭作答');
  }
  const first = rows[0];
  const paper: StudentExamPaper = {
    title: String(first.title ?? ''),
    grade: String(first.grade ?? ''),
    subject: String(first.subject ?? ''),
    unit: String(first.unit ?? ''),
    chapter: String(first.chapter ?? ''),
    status: String(first.status ?? ''),
  };
  const questions: StudentExamQuestion[] = rows.map((r) => ({
    sectionNo: Number(r.section_no ?? 1),
    sectionTitle: String(r.section_title ?? ''),
    seq: Number(r.seq ?? 0),
    qtype: r.qtype as ExamQType,
    stem: String(r.stem ?? ''),
    options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
    score: Number(r.score ?? 1),
  }));
  return { paper, questions };
}

/** 学生提交作答入参。 */
export interface SubmitExamAnswersInput {
  slug: string;
  studentName: string;
  /** 全部题目按 (section_no, seq) 排好的 0 基全局下标答案数组。 */
  answers: string[];
}

/** 学生提交作答结果（客观题判分结果；主观题 perQuestion 为 null）。 */
export interface ExamSubmitResult {
  objectiveScore: number;
  objectiveTotal: number;
  perQuestion: (boolean | null)[];
  explanations: string[];
}

/**
 * 学生提交作答（服务端判分，前端不持有答案）。
 *
 * @param input slug + 昵称（可选）+ 全局下标答案数组。
 */
export async function submitExamAnswers(input: SubmitExamAnswersInput): Promise<ExamSubmitResult> {
  const cl = examClient();
  const { data, error } = await cl.rpc('submit_exam_paper_answer', {
    p_slug: input.slug,
    p_student_name: input.studentName,
    p_answers: input.answers,
  });
  if (error) {
    throw new AppError('UNKNOWN', '提交失败，请稍后重试', error);
  }
  const d = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    objectiveScore?: number;
    objectiveTotal?: number;
    perQuestion?: unknown[];
    explanations?: unknown[];
  };
  if (d.ok === false) {
    throw new AppError('UNKNOWN', d.error ?? '提交失败，请稍后重试');
  }
  return {
    objectiveScore: Number(d.objectiveScore ?? 0),
    objectiveTotal: Number(d.objectiveTotal ?? 0),
    perQuestion: Array.isArray(d.perQuestion)
      ? (d.perQuestion as unknown[]).map((v) => (v === null ? null : Boolean(v)))
      : [],
    explanations: Array.isArray(d.explanations) ? d.explanations.map((e) => String(e ?? '')) : [],
  };
}

// ---------------------------------------------------------------------------
// 教师看板
// ---------------------------------------------------------------------------

/**
 * 读取某套测验卷的完成情况与每题统计（仅作者 / 管理员）。
 *
 * @param paperId 试卷 id。
 */
export async function getExamStats(paperId: string): Promise<ExamPaperStats> {
  const cl = examClient();
  const { data, error } = await cl.rpc('list_exam_paper_stats', { p_paper_id: paperId });
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
    throw new AppError('FORBIDDEN', d.error ?? '无权查看该测验卷');
  }
  const submissions = Array.isArray(d.submissions)
    ? (d.submissions as Array<Record<string, any>>).map((s) => ({
        submissionId: String(s.submissionId ?? ''),
        studentName: String(s.studentName ?? ''),
        score: Number(s.score ?? 0),
        objectiveTotal: Number(s.objectiveTotal ?? 0),
        subjectiveTotal: Number(s.subjectiveTotal ?? 0),
        finalScore: Number(s.finalScore ?? 0),
        submittedAt: String(s.submittedAt ?? ''),
        answers: Array.isArray(s.answers) ? (s.answers as unknown[]).map((a) => String(a ?? '')) : [],
      }))
    : [];
  const perQuestion = Array.isArray(d.perQuestion)
    ? (d.perQuestion as Array<Record<string, any>>).map((p) => {
        const metric = (p.metric ?? {}) as { type?: string; value?: number };
        return {
          questionId: String(p.questionId ?? ''),
          sectionNo: Number(p.sectionNo ?? 0),
          seq: Number(p.seq ?? 0),
          qtype: p.qtype as ExamQType,
          stem: String(p.stem ?? ''),
          metricType: metric.type === 'avgScore' ? ('avgScore' as const) : ('correctRate' as const),
          metricValue: Number(metric.value ?? 0),
        };
      })
    : [];
  return { submissions, perQuestion };
}

/**
 * 教师给某份提交的主观题打分（服务端合并进 subjective_scores）。
 *
 * @param submissionId 提交 id。
 * @param questionId 题目 id。
 * @param score 该题得分（numeric，支持 0.5）。
 * @returns 该学生的客观 + 主观总分。
 */
export async function setSubjectiveScore(
  submissionId: string,
  questionId: string,
  score: number,
): Promise<number> {
  const cl = examClient();
  const { data, error } = await cl.rpc('set_exam_subjective_score', {
    p_submission_id: submissionId,
    p_question_id: questionId,
    p_score: score,
  });
  if (error) {
    throw new AppError('UNKNOWN', '打分失败，请稍后重试', error);
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string; finalScore?: number };
  if (d.ok === false) {
    throw new AppError('FORBIDDEN', d.error ?? '无权批改');
  }
  return Number(d.finalScore ?? 0);
}

/**
 * 关闭某套测验卷的作答（学生端一律拒绝）。
 *
 * @param paperId 试卷 id。
 */
export async function closeExam(paperId: string): Promise<void> {
  const cl = examClient();
  const { error } = await cl.from('exam_papers').update({ status: 'closed' }).eq('id', paperId);
  if (error) {
    throw new AppError('UNKNOWN', '关闭测验卷失败，请稍后重试', error);
  }
}

/**
 * 一键清空某套测验卷的全部学生提交（数据最小化要求）。
 *
 * @param paperId 试卷 id。
 */
export async function clearSubmissions(paperId: string): Promise<void> {
  const cl = examClient();
  const { data, error } = await cl.rpc('clear_exam_paper_submissions', { p_paper_id: paperId });
  if (error) {
    throw new AppError('UNKNOWN', '清空提交失败，请稍后重试', error);
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string };
  if (d.ok === false) {
    throw new AppError('FORBIDDEN', d.error ?? '无权清空该测验卷');
  }
}

// ---------------------------------------------------------------------------
// 题库
// ---------------------------------------------------------------------------

/** 题库检索入参（全部可选；不传 = 不过滤）。 */
export interface ListQuestionBankInput {
  subject?: string;
  grade?: string;
  unit?: string;
  qtype?: ExamQType;
  knowledgePointId?: string;
  /** true = 只看公开题（不含自己的私有题）。 */
  publicOnly?: boolean;
}

/**
 * 检索题库：自己的题 + 公开题（管理员可见全部）。
 *
 * @param filter 学科 / 年级 / 单元 / 题型 / 知识点 id / 只看公开。
 */
export async function listQuestionBank(filter: ListQuestionBankInput = {}): Promise<QuestionBankItem[]> {
  const cl = examClient();
  const { data, error } = await cl.rpc('list_question_bank', {
    p_subject: filter.subject?.trim() ? filter.subject.trim() : null,
    p_grade: filter.grade?.trim() ? filter.grade.trim() : null,
    p_unit: filter.unit?.trim() ? filter.unit.trim() : null,
    p_qtype: filter.qtype ?? null,
    p_knowledge_point_id: filter.knowledgePointId ?? null,
    p_public_only: Boolean(filter.publicOnly),
  });
  if (error) {
    throw new AppError('UNKNOWN', '读取题库失败，请稍后重试', error);
  }
  const rows = (data ?? []) as Array<Record<string, any>>;
  return rows.map(toQuestionBankItem);
}

/** 把 RPC 返回的一行规整成强类型 QuestionBankItem。 */
function toQuestionBankItem(r: Record<string, any>): QuestionBankItem {
  const qtype = (['choice', 'fill', 'judge', 'subjective'] as string[]).includes(String(r.qtype))
    ? (String(r.qtype) as ExamQType)
    : 'fill';
  return {
    id: String(r.id ?? ''),
    ownerId: String(r.owner_id ?? ''),
    subject: String(r.subject ?? ''),
    grade: String(r.grade ?? ''),
    unit: String(r.unit ?? ''),
    qtype,
    stem: String(r.stem ?? ''),
    options: Array.isArray(r.options) ? (r.options as string[]) : undefined,
    answer: Array.isArray(r.answer) ? (r.answer as string[]) : [],
    explanation: typeof r.explanation === 'string' && r.explanation ? r.explanation : undefined,
    difficulty: typeof r.difficulty === 'string' ? r.difficulty : undefined,
    knowledgePoint: typeof r.knowledge_point === 'string' ? r.knowledge_point : undefined,
    knowledgePointId: r.knowledge_point_id ? String(r.knowledge_point_id) : undefined,
    score: Number(r.score ?? 1),
    isPublic: Boolean(r.is_public),
    usageCount: Number(r.usage_count ?? 0),
    createdAt: String(r.created_at ?? ''),
  };
}

/** 录入题库入参。 */
export interface AddQuestionToBankInput {
  subject?: string;
  grade?: string;
  unit?: string;
  knowledgePointId?: string | null;
  knowledgePoint?: string;
  qtype: ExamQType;
  stem: string;
  options?: string[];
  answer: string[];
  explanation?: string;
  difficulty?: string;
  score?: number;
  isPublic?: boolean;
}

/**
 * 录入一道题到题库（owner 由服务端强制为当前登录用户；非管理员 is_public 强制 false）。
 *
 * @param input 题目内容。
 * @returns 新题目 id。
 */
export async function addQuestionToBank(input: AddQuestionToBankInput): Promise<string> {
  const cl = examClient();
  const { data, error } = await cl.rpc('add_question_to_bank', {
    p_subject: input.subject ?? null,
    p_grade: input.grade ?? null,
    p_unit: input.unit ?? null,
    p_knowledge_point_id: input.knowledgePointId ?? null,
    p_qtype: input.qtype,
    p_stem: input.stem,
    p_options: input.options ?? null,
    p_answer: input.answer ?? [],
    p_explanation: input.explanation ?? null,
    p_difficulty: input.difficulty ?? null,
    p_knowledge_point: input.knowledgePoint ?? null,
    p_score: input.score ?? 1,
    p_is_public: Boolean(input.isPublic),
  });
  if (error) {
    throw new AppError('UNKNOWN', error.message ?? '录入题库失败，请稍后重试', error);
  }
  const id = data == null ? '' : String(data);
  if (!id) throw new AppError('UNKNOWN', '录入题库失败，请稍后重试');
  return id;
}

/**
 * 删除题库中的一道题（仅作者本人 / 管理员）。
 *
 * @param id 题目 id。
 */
export async function deleteQuestionFromBank(id: string): Promise<void> {
  const cl = examClient();
  const { data, error } = await cl.rpc('delete_question_from_bank', { p_id: id });
  if (error) {
    throw new AppError('UNKNOWN', error.message ?? '删除题目失败，请稍后重试', error);
  }
  const d = (data ?? {}) as { ok?: boolean; error?: string };
  if (d.ok === false) {
    throw new AppError('FORBIDDEN', d.error ?? '题目不存在或无权删除');
  }
}

/**
 * 批量累加题库题目的被引用次数（组卷引用后调用；失败不影响组卷）。
 *
 * @param ids 题目 id 列表。
 */
export async function incrementBankUsage(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const cl = examClient();
    await cl.rpc('increment_bank_usage', { p_ids: ids });
  } catch {
    // 只是计数，失败忽略
  }
}

/**
 * 读取知识点列表（自己的 + 公开的），用于题库筛选下拉。
 * 直接走表查询，RLS 已限定可见范围（作者 / 公开 / 管理员）。
 */
export async function listKnowledgePoints(): Promise<KnowledgePoint[]> {
  const cl = examClient();
  const { data, error } = await cl
    .from('knowledge_points')
    .select('id, owner_id, subject, grade, unit, name, description, is_public, created_at')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    throw new AppError('UNKNOWN', '读取知识点失败，请稍后重试', error);
  }
  const rows = (data ?? []) as Array<Record<string, any>>;
  return rows.map((r) => ({
    id: String(r.id ?? ''),
    ownerId: String(r.owner_id ?? ''),
    subject: String(r.subject ?? ''),
    grade: String(r.grade ?? ''),
    unit: String(r.unit ?? ''),
    name: String(r.name ?? ''),
    description: typeof r.description === 'string' ? r.description : undefined,
    isPublic: Boolean(r.is_public),
    createdAt: String(r.created_at ?? ''),
  }));
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

/**
 * 导出某套测验卷的完成记录 CSV（完成名单 + 每题统计，带 BOM）。
 *
 * @param paperId 试卷 id。
 * @param meta 标题（用于文件名）。
 */
export async function exportExamPaperRecords(
  paperId: string,
  meta: { title: string },
): Promise<void> {
  const stats = await getExamStats(paperId);
  const dateStr = new Date().toISOString().slice(0, 10);
  const safeTitle = (meta.title || '测验卷').replace(/[\\/:*?"<>|]/g, '_');

  const rows: (string | number)[][] = [];
  rows.push(['完成名单']);
  rows.push(['昵称', '客观得分', '客观题数', '主观得分', '总分', '提交时间']);
  for (const s of stats.submissions) {
    rows.push([
      s.studentName,
      s.score,
      s.objectiveTotal,
      s.subjectiveTotal,
      s.finalScore,
      s.submittedAt,
    ]);
  }
  rows.push([]);
  rows.push(['每题统计']);
  rows.push(['大题', '题号', '题型', '题干', '指标', '数值']);
  for (const q of stats.perQuestion) {
    rows.push([
      q.sectionNo,
      q.seq,
      q.qtype,
      q.stem,
      q.metricType === 'correctRate' ? '正确率' : '主观均分',
      q.metricType === 'correctRate'
        ? `${Math.round(q.metricValue * 1000) / 10}%`
        : String(Math.round(q.metricValue * 100) / 100),
    ]);
  }

  downloadCsv(rows, `${safeTitle}_完成记录_${dateStr}.csv`);
}
