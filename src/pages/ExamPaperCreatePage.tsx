/**
 * 创建测验卷页（T11「组卷」教师端）。
 *
 * 三条出题路径，用 MUI Tabs 切换：
 * - 路径 A「按规格生成」：填 学科/年级/单元 + 大题结构（题型/题数/分值）→ 实时预估积分
 *   → AI 生成 → **逐题可编辑/删除**预览 → 保存发布拿 /e/{slug} 链接；
 * - 路径 B「上传原卷」：粘贴/上传原卷 → AI 解析（免费，出知识点清单）→ 二选一：
 *   ① 生成同知识点变式卷 ② 原样导入成卷 → 预览 → 发布；
 * - 路径 C「从题库挑题」：按 学科/年级/单元/题型 检索题库（本人 + 公开）→ 勾选
 *   → 按题型自动分大题 → 预览 → 发布。
 *
 * 质量红线（客户验收）：**发布前必须能逐题编辑/删除**，绝不"一键全收"。
 * 预览区的每题都带 题干/选项/答案/解析/分值/知识点 编辑框 + 删除按钮，
 * 并支持整大题重命名、调分值、上下移、删除、以及手动新增题目。
 *
 * 红线：不引入任何新 npm 依赖；页面禁止直接 import supabaseClient（一律走 service 层）。
 */
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import {
  estimateExamCredits,
  generateExam,
  importExamWithAi,
  incrementBankUsage,
  listQuestionBank,
  parseOriginalPaper,
  saveExam,
} from '@/services/examPaperService';
import { copyText } from '@/utils/clipboard';
import { isMockMode } from '@/config/env';
import { useToast } from '@/components/common/ToastHost';
import type {
  ExamPaper,
  ExamQType,
  ExamQuestion,
  ExamSection,
  QuestionBankItem,
} from '@/types/examPaper';

/** 出题路径。 */
type Mode = 'spec' | 'upload' | 'bank';
/** 向导步骤。 */
type Step = 'edit' | 'preview' | 'done';

/** 题型选项。 */
const QTYPES: { key: ExamQType; label: string }[] = [
  { key: 'choice', label: '选择题' },
  { key: 'fill', label: '填空题' },
  { key: 'judge', label: '判断题' },
  { key: 'subjective', label: '主观题' },
];

/** 中文序号（一、二、三…）。 */
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 数字 → 中文序号；超出范围退回阿拉伯数字。 */
function cnNum(n: number): string {
  return CN_NUM[n - 1] ?? String(n);
}

/** 题型 → 中文标签。 */
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

/** 默认大题标题（如「一、选择题（每题3分）」）。 */
function defaultSectionTitle(sectionNo: number, qtype: ExamQType, score: number): string {
  return `${cnNum(sectionNo)}、${qtypeLabel(qtype)}（每题 ${score} 分）`;
}

/** 大题规格（路径 A 表单态）。 */
interface SectionSpecRow {
  qtype: ExamQType;
  count: number;
  score: number;
}

/** 把任意错误转成可展示的中文文案（AppError 的 message 即接口返回的中文）。 */
function toMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return '操作失败，请稍后重试';
}

/** 生成一道空白题（新增题目时使用）。 */
function blankQuestion(sectionNo: number, seq: number, qtype: ExamQType, score: number): ExamQuestion {
  return {
    sectionNo,
    sectionTitle: '',
    seq,
    qtype,
    stem: '',
    options: qtype === 'choice' ? ['', '', '', ''] : undefined,
    answer: [],
    explanation: undefined,
    score,
    knowledgePoint: undefined,
  };
}

/** 答案输入提示（按题型给老师示例）。 */
function answerPlaceholder(qtype: ExamQType): string {
  switch (qtype) {
    case 'choice':
      return '正确选项字母，如 A';
    case 'fill':
      return '多个空用竖线 | 分隔，如 又大又红|又香又甜';
    case 'judge':
      return '对 或 错';
    case 'subjective':
      return '得分要点，多条用换行分隔';
    default:
      return '';
  }
}

/**
 * 把老师填的答案文本按题型转成 answer 数组。
 * 填空：整段（含 |）放进**单个元素**（与判分函数约定一致，绝不拆分）。
 * 主观题：按行拆成要点数组。
 */
function buildAnswer(qtype: ExamQType, text: string): string[] {
  const s = (text ?? '').trim();
  if (!s) return [];
  if (qtype === 'choice') {
    const m = s.match(/[A-Za-z]/);
    return m ? [m[0].toUpperCase()] : [];
  }
  if (qtype === 'judge') {
    if (s === '对' || s.toLowerCase() === 'true' || s === '√') return ['对'];
    if (s === '错' || s.toLowerCase() === 'false' || s === '×') return ['错'];
    return [s];
  }
  if (qtype === 'subjective') {
    return s
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  // fill：单个元素，内部 | 分隔多个空
  return [s];
}

/** answer 数组 → 编辑框里的文本。 */
function answerToText(qtype: ExamQType, answer: string[]): string {
  if (!Array.isArray(answer) || answer.length === 0) return '';
  if (qtype === 'subjective') return answer.join('\n');
  return answer[0] ?? '';
}

/**
 * 逐题校验：返回第一条不合规的原因（发布前把关，避免把残缺卷发给学生）。
 *
 * @param paper 待保存的试卷。
 * @returns 错误文案；全部合规返回 null。
 */
function validatePaper(paper: ExamPaper): string | null {
  if (!paper.title.trim()) return '请填写测验卷标题';
  if (paper.sections.length === 0) return '至少要有 1 个大题';

  let questionCount = 0;
  for (const sec of paper.sections) {
    if (sec.questions.length === 0) return `「${sec.sectionTitle || '未命名大题'}」里没有题目，请删除或补题`;
    for (const q of sec.questions) {
      questionCount += 1;
      if (!q.stem.trim()) return `第 ${questionCount} 题的题干是空的，请补全或删除该题`;
      if (q.answer.length === 0) return `第 ${questionCount} 题没有填答案`;
      if (q.qtype === 'choice') {
        const opts = (q.options ?? []).filter((o) => o.trim().length > 0);
        if (opts.length < 2) return `第 ${questionCount} 题是选择题，至少要填 2 个选项`;
        const letter = (q.answer[0] ?? '').trim().toUpperCase();
        if (!/^[A-Za-z]$/.test(letter)) return `第 ${questionCount} 题的答案必须是选项字母（A/B/C…）`;
      }
      if (q.qtype === 'judge' && !['对', '错'].includes((q.answer[0] ?? '').trim())) {
        return `第 ${questionCount} 题是判断题，答案只能填「对」或「错」`;
      }
      if (!(q.score > 0)) return `第 ${questionCount} 题的分值必须大于 0`;
    }
  }
  if (questionCount === 0) return '这套卷还没有题目';
  return null;
}

// ---------------------------------------------------------------------------
// 私有组件：试卷编辑器（逐题可编辑 / 删除）
// ---------------------------------------------------------------------------

interface PaperEditorProps {
  paper: ExamPaper;
  onChange: (paper: ExamPaper) => void;
}

/**
 * 预览步骤的试卷编辑器。
 *
 * 每个大题：标题、每题分值、上移/下移、删除；
 * 每题：题干、选项（选择题）、答案、解析、分值、知识点、删除。
 */
function PaperEditor({ paper, onChange }: PaperEditorProps) {
  /** 统一重排：sectionNo / seq 连续，并把 section 的标题/分值/题型同步到每题。 */
  const normalize = (sections: ExamSection[]): ExamSection[] =>
    sections.map((sec, si) => ({
      ...sec,
      sectionNo: si + 1,
      questions: sec.questions.map((q, qi) => ({
        ...q,
        sectionNo: si + 1,
        sectionTitle: sec.sectionTitle,
        seq: qi + 1,
      })),
    }));

  const emit = (sections: ExamSection[]) => onChange({ ...paper, sections: normalize(sections) });

  const updateSection = (si: number, patch: Partial<ExamSection>) => {
    const next = paper.sections.map((sec, i) => (i === si ? { ...sec, ...patch } : sec));
    // 改了分值：同步到大题内每题
    if (patch.score !== undefined) {
      next[si] = {
        ...next[si],
        questions: next[si].questions.map((q) => ({ ...q, score: patch.score as number })),
      };
    }
    emit(next);
  };

  const removeSection = (si: number) => {
    emit(paper.sections.filter((_, i) => i !== si));
  };

  const moveSection = (si: number, delta: number) => {
    const target = si + delta;
    if (target < 0 || target >= paper.sections.length) return;
    const next = [...paper.sections];
    const tmp = next[si];
    next[si] = next[target];
    next[target] = tmp;
    emit(next);
  };

  const addSection = () => {
    const sectionNo = paper.sections.length + 1;
    const qtype: ExamQType = 'choice';
    emit([
      ...paper.sections,
      {
        sectionNo,
        sectionTitle: defaultSectionTitle(sectionNo, qtype, 2),
        qtype,
        score: 2,
        questions: [blankQuestion(sectionNo, 1, qtype, 2)],
      },
    ]);
  };

  const updateQuestion = (si: number, qi: number, patch: Partial<ExamQuestion>) => {
    const next = paper.sections.map((sec, i) =>
      i === si
        ? { ...sec, questions: sec.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) }
        : sec,
    );
    emit(next);
  };

  const removeQuestion = (si: number, qi: number) => {
    const next = paper.sections.map((sec, i) =>
      i === si ? { ...sec, questions: sec.questions.filter((_, j) => j !== qi) } : sec,
    );
    // 空大题直接删掉，避免保存时空大题报错
    emit(next.filter((sec) => sec.questions.length > 0));
  };

  const addQuestion = (si: number) => {
    const sec = paper.sections[si];
    const next = paper.sections.map((s, i) =>
      i === si
        ? {
            ...s,
            questions: [
              ...s.questions,
              blankQuestion(s.sectionNo, s.questions.length + 1, s.qtype, s.score),
            ],
          }
        : s,
    );
    emit(next);
  };

  /** 全局题序（跨大题连续计数，展示用）。 */
  let globalSeq = 0;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          共 {paper.sections.reduce((n, s) => n + s.questions.length, 0)} 题 · 逐题可编辑
        </Typography>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addSection}>
          新增大题
        </Button>
      </Stack>

      {paper.sections.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          还没有大题，点「新增大题」手动添加，或返回上一步重新生成。
        </Alert>
      )}

      {paper.sections.map((sec, si) => (
        <Paper key={si} variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, mb: 2.5, borderRadius: 2 }}>
          {/* ---- 大题头 ---- */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Chip
              label={qtypeLabel(sec.qtype)}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
            <TextField
              label="大题标题"
              size="small"
              value={sec.sectionTitle}
              onChange={(e) => updateSection(si, { sectionTitle: e.target.value })}
              sx={{ flex: 1, minWidth: 180 }}
            />
            <TextField
              label="每题分值"
              size="small"
              type="number"
              value={sec.score}
              onChange={(e) => updateSection(si, { score: Number(e.target.value) || 0 })}
              sx={{ width: 110 }}
            />
            <IconButton
              aria-label="上移大题"
              disabled={si === 0}
              onClick={() => moveSection(si, -1)}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
            <IconButton
              aria-label="下移大题"
              disabled={si === paper.sections.length - 1}
              onClick={() => moveSection(si, 1)}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
            <Button size="small" color="error" onClick={() => removeSection(si)}>
              删除大题
            </Button>
          </Stack>

          <Divider sx={{ mb: 1.5 }} />

          {/* ---- 题目 ---- */}
          {sec.questions.map((q, qi) => {
            globalSeq += 1;
            const no = globalSeq;
            return (
              <Box
                key={`${si}-${qi}`}
                sx={{
                  p: 1.5,
                  mb: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.default',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.secondary' }}>
                    第 {no} 题
                    {q.knowledgePoint ? ` · ${q.knowledgePoint}` : ''}
                  </Typography>
                  <Button size="small" color="error" onClick={() => removeQuestion(si, qi)}>
                    删除本题
                  </Button>
                </Stack>

                <TextField
                  label="题干"
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  value={q.stem}
                  onChange={(e) => updateQuestion(si, qi, { stem: e.target.value })}
                  sx={{ mb: 1.25 }}
                />

                {q.qtype === 'choice' && (
                  <Stack spacing={1} sx={{ mb: 1.25 }}>
                    {(q.options ?? ['', '', '', '']).map((opt, oi) => (
                      <TextField
                        key={oi}
                        label={`选项 ${String.fromCharCode(65 + oi)}`}
                        size="small"
                        fullWidth
                        value={opt}
                        onChange={(e) => {
                          const opts = [...(q.options ?? ['', '', '', ''])];
                          opts[oi] = e.target.value;
                          updateQuestion(si, qi, { options: opts });
                        }}
                      />
                    ))}
                  </Stack>
                )}

                <TextField
                  label="答案"
                  size="small"
                  fullWidth
                  multiline={q.qtype === 'subjective'}
                  minRows={q.qtype === 'subjective' ? 2 : 1}
                  placeholder={answerPlaceholder(q.qtype)}
                  value={answerToText(q.qtype, q.answer)}
                  onChange={(e) =>
                    updateQuestion(si, qi, { answer: buildAnswer(q.qtype, e.target.value) })
                  }
                  sx={{ mb: 1.25 }}
                />

                <TextField
                  label={q.qtype === 'subjective' ? '参考答案 / 评分要点' : '解析'}
                  size="small"
                  fullWidth
                  multiline
                  minRows={2}
                  value={q.explanation ?? ''}
                  onChange={(e) =>
                    updateQuestion(si, qi, { explanation: e.target.value || undefined })
                  }
                  sx={{ mb: 1.25 }}
                />

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    label="分值"
                    size="small"
                    type="number"
                    value={q.score}
                    onChange={(e) => updateQuestion(si, qi, { score: Number(e.target.value) || 0 })}
                    sx={{ width: { xs: '100%', sm: 110 } }}
                  />
                  <TextField
                    label="知识点"
                    size="small"
                    fullWidth
                    value={q.knowledgePoint ?? ''}
                    onChange={(e) =>
                      updateQuestion(si, qi, { knowledgePoint: e.target.value || undefined })
                    }
                  />
                </Stack>
              </Box>
            );
          })}

          <Button size="small" startIcon={<AddIcon />} onClick={() => addQuestion(si)}>
            在本大题加一题
          </Button>
        </Paper>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 主页面
// ---------------------------------------------------------------------------

/** 空试卷骨架。 */
function emptyPaper(): ExamPaper {
  return { title: '', subject: '语文', grade: '二年级', unit: '', chapter: '', sections: [] };
}

/**
 * 创建测验卷页。三条路径（规格生成 / 上传原卷 / 题库挑题）最终都收敛到
 * 「逐题可编辑预览 → 保存发布 → 分享链接」。
 */
export default function ExamPaperCreatePage(): JSX.Element {
  const toast = useToast();
  const location = useLocation();

  const [mode, setMode] = useState<Mode>('spec');
  const [step, setStep] = useState<Step>('edit');

  // 通用状态
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paper, setPaper] = useState<ExamPaper>(emptyPaper());
  const [shareSlug, setShareSlug] = useState<string>('');
  const [paperSource, setPaperSource] = useState<'ai' | 'upload' | 'bank'>('ai');

  // 路径 A 表单
  const [subject, setSubject] = useState<string>('语文');
  const [grade, setGrade] = useState<string>('二年级');
  const [unit, setUnit] = useState<string>('');
  const [specRows, setSpecRows] = useState<SectionSpecRow[]>([
    { qtype: 'choice', count: 10, score: 3 },
    { qtype: 'fill', count: 5, score: 2 },
    { qtype: 'subjective', count: 2, score: 8 },
  ]);
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null);

  // 路径 B 上传
  const [uploadText, setUploadText] = useState<string>('');
  const [parsedPoints, setParsedPoints] = useState<string[]>([]);
  const [parsedSpec, setParsedSpec] = useState<SectionSpecRow[]>([]);
  const [uploadSubject, setUploadSubject] = useState<string>('语文');
  const [uploadGrade, setUploadGrade] = useState<string>('二年级');
  const [uploadUnit, setUploadUnit] = useState<string>('');

  // 路径 C 题库
  const [bankItems, setBankItems] = useState<QuestionBankItem[]>([]);
  const [bankLoading, setBankLoading] = useState<boolean>(false);
  const [bankSubject, setBankSubject] = useState<string>('');
  const [bankGrade, setBankGrade] = useState<string>('');
  const [bankUnit, setBankUnit] = useState<string>('');
  const [bankQtype, setBankQtype] = useState<ExamQType | ''>('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const demo = isMockMode();

  // 从「题库」页带过来的预选题目（router state），直接落到预览步骤。
  useEffect(() => {
    const state = location.state as { bankSections?: ExamSection[] } | null;
    const sections = state?.bankSections;
    if (Array.isArray(sections) && sections.length > 0) {
      setMode('bank');
      setPaperSource('bank');
      setPaper({
        title: '从题库挑题组成的测验卷',
        subject: bankSubject || '语文',
        grade: bankGrade || '二年级',
        unit: bankUnit,
        chapter: '',
        sections,
      });
      setStep('preview');
    }
    // 只在挂载时消费一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 实时预估积分（路径 A）：题量/题型/分值变化时重算；展示用，实际以 Edge 扣费为准。
  useEffect(() => {
    let alive = true;
    estimateExamCredits(specRows)
      .then((c) => {
        if (alive) setEstimatedCredits(c);
      })
      .catch(() => {
        if (alive) setEstimatedCredits(null);
      });
    return () => {
      alive = false;
    };
  }, [specRows]);

  /** 切换路径：重置步骤与草稿，避免三路状态串台。 */
  const switchMode = (m: Mode): void => {
    if (m === mode) return;
    setMode(m);
    setStep('edit');
    setError(null);
    setNotice(null);
    setPaper(emptyPaper());
    setShareSlug('');
    setSelectedIds([]);
    setParsedPoints([]);
    setParsedSpec([]);
  };

  /** 路径 A：按规格生成。 */
  const handleGenerate = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (specRows.every((r) => r.count < 1)) throw new Error('请至少配置一道题');
      const res = await generateExam({
        grade,
        subject,
        unit,
        title: unit ? `${grade}${subject}${unit}测验卷` : `${grade}${subject}测验卷`,
        sections: specRows.filter((r) => r.count > 0),
      });
      setPaper({
        ...res.paper,
        subject,
        grade,
        unit,
        title: res.paper.title || `${grade}${subject}测验卷`,
      });
      setPaperSource('ai');
      setNotice(
        res.paper.sections.length === 0
          ? 'AI 没有返回题目，可返回调整参数重试，或在预览里手动新增。'
          : `已生成 ${res.paper.sections.reduce((n, s) => n + s.questions.length, 0)} 题${res.bankSaved > 0 ? `，其中 ${res.bankSaved} 题已沉淀进题库` : ''}。请逐题检查后再发布。`,
      );
      setStep('preview');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  /** 路径 B：读取上传文件。 */
  const handleFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadText(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = () => setError('读取文件失败，请重试');
    reader.readAsText(file);
  };

  /** 路径 B：解析原卷（免费，只做分析）。 */
  const handleParse = async (): Promise<void> => {
    if (uploadText.trim().length < 2) {
      setError('请先粘贴或上传原卷内容');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await parseOriginalPaper({
        text: uploadText,
        subject: uploadSubject,
        grade: uploadGrade,
        unit: uploadUnit,
      });
      const spec: SectionSpecRow[] = res.paper.sections.map((s) => ({
        qtype: s.qtype,
        count: s.questions.length,
        score: s.score,
      }));
      setParsedSpec(spec);
      setParsedPoints(res.knowledgePoints);
      setNotice(
        `解析完成：共 ${spec.reduce((n, s) => n + s.count, 0)} 题。可「生成变式卷」（同知识点出新题）或「原样导入」直接成卷。`,
      );
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  /** 路径 B①：按原卷结构生成变式卷。 */
  const handleVariant = async (): Promise<void> => {
    if (parsedSpec.length === 0) {
      setError('请先解析原卷');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await generateExam({
        grade: uploadGrade,
        subject: uploadSubject,
        unit: uploadUnit,
        title: `${uploadGrade}${uploadSubject}变式测验卷`,
        sections: parsedSpec,
        sourceText: uploadText,
        knowledgePoints: parsedPoints,
      });
      setPaper({
        ...res.paper,
        subject: uploadSubject,
        grade: uploadGrade,
        unit: uploadUnit,
      });
      setPaperSource('ai');
      setStep('preview');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  /** 路径 B②：原样导入原卷。 */
  const handleImport = async (): Promise<void> => {
    if (uploadText.trim().length < 2) {
      setError('请先粘贴或上传原卷内容');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await importExamWithAi({
        text: uploadText,
        subject: uploadSubject,
        grade: uploadGrade,
        unit: uploadUnit,
      });
      setPaper({
        ...res.paper,
        subject: uploadSubject,
        grade: uploadGrade,
        unit: uploadUnit,
      });
      setPaperSource('upload');
      setStep('preview');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  /** 路径 C：检索题库。 */
  const handleSearchBank = async (): Promise<void> => {
    setBankLoading(true);
    setError(null);
    try {
      const items = await listQuestionBank({
        subject: bankSubject,
        grade: bankGrade,
        unit: bankUnit,
        qtype: bankQtype || undefined,
      });
      setBankItems(items);
      setSelectedIds([]);
      if (items.length === 0) setNotice('没找到符合条件的题目，试试放宽筛选条件。');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setBankLoading(false);
    }
  };

  /** 路径 C：勾选/取消勾选。 */
  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** 路径 C：把选中题目按题型分大题，进入预览。 */
  const handleComposeFromBank = (): void => {
    const picked = bankItems.filter((it) => selectedIds.includes(it.id));
    if (picked.length === 0) {
      setError('请先勾选要用的题目');
      return;
    }
    const byType = new Map<ExamQType, QuestionBankItem[]>();
    for (const it of picked) {
      const list = byType.get(it.qtype) ?? [];
      list.push(it);
      byType.set(it.qtype, list);
    }
    const sections: ExamSection[] = [];
    let idx = 0;
    for (const [qtype, list] of byType) {
      idx += 1;
      const score = list[0]?.score ?? 1;
      sections.push({
        sectionNo: idx,
        sectionTitle: defaultSectionTitle(idx, qtype, score),
        qtype,
        score,
        questions: list.map((it, i) => ({
          sectionNo: idx,
          sectionTitle: defaultSectionTitle(idx, qtype, score),
          seq: i + 1,
          qtype,
          stem: it.stem,
          options: it.options,
          answer: it.answer,
          explanation: it.explanation,
          score: it.score,
          knowledgePoint: it.knowledgePoint,
        })),
      });
    }
    setPaper({
      title: `${bankGrade || ''}${bankSubject || ''}${bankUnit || ''}测验卷`.trim() || '从题库挑题组成的测验卷',
      subject: bankSubject,
      grade: bankGrade,
      unit: bankUnit,
      chapter: '',
      sections,
    });
    setPaperSource('bank');
    void incrementBankUsage(selectedIds);
    setStep('preview');
  };

  /** 保存并发布（三条路径共用）。 */
  const handleSave = async (): Promise<void> => {
    const invalid = validatePaper(paper);
    if (invalid) {
      setError(invalid);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await saveExam({
        title: paper.title.trim(),
        subject: paper.subject,
        grade: paper.grade,
        unit: paper.unit,
        source: paperSource,
        sections: paper.sections,
      });
      setShareSlug(res.shareSlug);
      setStep('done');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  /** 复制学生作答链接。 */
  const handleCopy = async (): Promise<void> => {
    const ok = await copyText(`${window.location.origin}/e/${shareSlug}`);
    if (!ok) toast.error('复制失败，请手动复制');
  };

  /** 再出一套：回到编辑态。 */
  const handleCreateAnother = (): void => {
    setStep('edit');
    setPaper(emptyPaper());
    setShareSlug('');
    setError(null);
    setNotice(null);
    setSelectedIds([]);
  };

  /** 路径 A：改大题规格。 */
  const updateSpec = (idx: number, patch: Partial<SectionSpecRow>): void => {
    setSpecRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const totalQuestions = useMemo(
    () => specRows.reduce((n, r) => n + Math.max(0, r.count || 0), 0),
    [specRows],
  );

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
        创建测验卷
      </Typography>

      {demo && (
        <Alert severity="info" sx={{ mb: 2 }}>
          当前为演示模式（未连接云端服务）。组卷的生成 / 保存需要连接 Supabase，界面可正常浏览。
        </Alert>
      )}

      <Tabs value={mode} onChange={(_, v) => switchMode(v as Mode)} sx={{ mb: 3 }} variant="scrollable">
        <Tab value="spec" label="按规格生成" />
        <Tab value="upload" label="上传原卷" />
        <Tab value="bank" label="从题库挑题" />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && !error && (
        <Alert severity={step === 'preview' ? 'info' : 'success'} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}

      {/* ---------------- 路径 A：按规格生成 ---------------- */}
      {step === 'edit' && mode === 'spec' && (
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="学科"
              size="small"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="年级"
              size="small"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="单元"
              size="small"
              placeholder="如：第一单元"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Typography sx={{ fontWeight: 700 }}>大题结构（共 {totalQuestions} 题）</Typography>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() =>
                  setSpecRows((prev) => [...prev, { qtype: 'fill', count: 5, score: 2 }])
                }
              >
                加一个大题
              </Button>
            </Stack>

            {specRows.map((row, idx) => (
              <Paper key={idx} variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
                  <FormControl size="small" sx={{ minWidth: 130 }}>
                    <InputLabel id={`spec-qtype-${idx}`}>题型</InputLabel>
                    <Select
                      labelId={`spec-qtype-${idx}`}
                      label="题型"
                      value={row.qtype}
                      onChange={(e) => updateSpec(idx, { qtype: e.target.value as ExamQType })}
                    >
                      {QTYPES.map((t) => (
                        <MenuItem key={t.key} value={t.key}>
                          {t.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="题数"
                    size="small"
                    type="number"
                    value={row.count}
                    onChange={(e) => updateSpec(idx, { count: Number(e.target.value) || 0 })}
                    sx={{ width: 110 }}
                  />
                  <TextField
                    label="每题分值"
                    size="small"
                    type="number"
                    value={row.score}
                    onChange={(e) => updateSpec(idx, { score: Number(e.target.value) || 0 })}
                    sx={{ width: 120 }}
                  />
                  <Box sx={{ flex: 1 }} />
                  <IconButton
                    aria-label="删除该大题配置"
                    color="error"
                    onClick={() => setSpecRows((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              </Paper>
            ))}
          </Box>

          {estimatedCredits !== null && (
            <Alert severity="info">
              预计消耗约 {estimatedCredits.toFixed(1)} 积分（实际以生成时扣费为准）
            </Alert>
          )}

          <Box>
            <Button variant="contained" size="large" disabled={loading} onClick={() => void handleGenerate()}>
              {loading ? <CircularProgress size={20} color="inherit" /> : '生成测验卷'}
            </Button>
          </Box>
        </Stack>
      )}

      {/* ---------------- 路径 B：上传原卷 ---------------- */}
      {step === 'edit' && mode === 'upload' && (
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="学科"
              size="small"
              value={uploadSubject}
              onChange={(e) => setUploadSubject(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="年级"
              size="small"
              value={uploadGrade}
              onChange={(e) => setUploadGrade(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="单元"
              size="small"
              placeholder="如：第一单元"
              value={uploadUnit}
              onChange={(e) => setUploadUnit(e.target.value)}
              sx={{ flex: 1 }}
            />
          </Stack>

          <TextField
            label="原卷内容"
            size="small"
            fullWidth
            multiline
            minRows={8}
            placeholder="把原卷（Word / PDF 复制出来的文字即可）粘贴到这里，或点下方按钮上传 .txt 文件"
            value={uploadText}
            onChange={(e) => setUploadText(e.target.value)}
          />

          <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ gap: 1 }}>
            <Button variant="outlined" component="label" disabled={loading}>
              上传 .txt 文件
              <input type="file" accept=".txt,.csv,.md" hidden onChange={handleFile} />
            </Button>
            <Button variant="contained" disabled={loading} onClick={() => void handleParse()}>
              {loading ? <CircularProgress size={20} color="inherit" /> : '解析原卷（免费）'}
            </Button>
          </Stack>

          {parsedSpec.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 700, mb: 1 }}>
                解析结果：{parsedSpec.reduce((n, s) => n + s.count, 0)} 题
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 1.5, gap: 1 }}>
                {parsedSpec.map((s, i) => (
                  <Chip
                    key={i}
                    size="small"
                    label={`${qtypeLabel(s.qtype)} ${s.count} 题 × ${s.score} 分`}
                  />
                ))}
              </Stack>

              {parsedPoints.length > 0 && (
                <Box sx={{ mb: 1.5 }}>
                  <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 0.5 }}>
                    识别到的知识点：
                  </Typography>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ gap: 0.75 }}>
                    {parsedPoints.map((p, i) => (
                      <Chip key={i} size="small" variant="outlined" label={p} />
                    ))}
                  </Stack>
                </Box>
              )}

              <Stack direction="row" spacing={1.5} flexWrap="wrap" sx={{ gap: 1 }}>
                <Button variant="contained" disabled={loading} onClick={() => void handleVariant()}>
                  生成同知识点变式卷
                </Button>
                <Button variant="outlined" disabled={loading} onClick={() => void handleImport()}>
                  原样导入成卷
                </Button>
              </Stack>
            </Paper>
          )}
        </Stack>
      )}

      {/* ---------------- 路径 C：从题库挑题 ---------------- */}
      {step === 'edit' && mode === 'bank' && (
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="学科"
              size="small"
              value={bankSubject}
              onChange={(e) => setBankSubject(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="年级"
              size="small"
              value={bankGrade}
              onChange={(e) => setBankGrade(e.target.value)}
              sx={{ flex: 1 }}
            />
            <TextField
              label="单元"
              size="small"
              value={bankUnit}
              onChange={(e) => setBankUnit(e.target.value)}
              sx={{ flex: 1 }}
            />
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel id="bank-qtype-label">题型</InputLabel>
              <Select
                labelId="bank-qtype-label"
                label="题型"
                value={bankQtype}
                onChange={(e) => setBankQtype(e.target.value as ExamQType | '')}
              >
                <MenuItem value="">全部</MenuItem>
                {QTYPES.map((t) => (
                  <MenuItem key={t.key} value={t.key}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>

          <Button variant="contained" disabled={bankLoading} onClick={() => void handleSearchBank()}>
            {bankLoading ? <CircularProgress size={20} color="inherit" /> : '搜索题库'}
          </Button>

          {bankItems.map((it) => (
            <Paper key={it.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Checkbox
                  checked={selectedIds.includes(it.id)}
                  onChange={() => toggleSelect(it.id)}
                  sx={{ mt: -1 }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
                    <Chip size="small" label={qtypeLabel(it.qtype)} color="primary" variant="outlined" />
                    {it.knowledgePoint ? <Chip size="small" label={it.knowledgePoint} /> : null}
                    {it.isPublic ? <Chip size="small" label="公开" color="success" /> : null}
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                      {it.subject} {it.grade} {it.unit} · 用过 {it.usageCount} 次
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 15, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                    {it.stem}
                  </Typography>
                  {it.options && it.options.length > 0 && (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5 }}>
                      {it.options.join('  ')}
                    </Typography>
                  )}
                </Box>
              </Stack>
            </Paper>
          ))}

          {bankItems.length > 0 && (
            <Button
              variant="contained"
              size="large"
              onClick={handleComposeFromBank}
              disabled={selectedIds.length === 0}
            >
              用选中的 {selectedIds.length} 题组成试卷
            </Button>
          )}
        </Stack>
      )}

      {/* ---------------- 步骤：预览（逐题可编辑） ---------------- */}
      {step === 'preview' && (
        <Stack spacing={2}>
          <TextField
            label="测验卷标题"
            size="small"
            fullWidth
            value={paper.title}
            onChange={(e) => setPaper({ ...paper, title: e.target.value })}
          />
          <Alert severity="warning">
            发布前请逐题检查：题干是否通顺、答案是否唯一正确、解析是否到位。确认无误再点「保存并发布」。
          </Alert>
          <PaperEditor paper={paper} onChange={setPaper} />
          <Stack direction="row" spacing={2}>
            <Button variant="text" onClick={() => setStep('edit')} disabled={loading}>
              返回修改
            </Button>
            <Button variant="contained" onClick={() => void handleSave()} disabled={loading}>
              {loading ? <CircularProgress size={20} color="inherit" /> : '保存并发布'}
            </Button>
          </Stack>
        </Stack>
      )}

      {/* ---------------- 步骤：完成（分享链接） ---------------- */}
      {step === 'done' && (
        <Stack spacing={2}>
          <Alert severity="success">已发布！把下面这条链接发给学生，免登录点开就能作答。</Alert>
          <TextField
            label="学生作答链接"
            size="small"
            fullWidth
            InputProps={{
              readOnly: true,
              endAdornment: (
                <IconButton onClick={() => void handleCopy()} edge="end" aria-label="复制链接">
                  <ContentCopyIcon />
                </IconButton>
              ),
            }}
            value={`${window.location.origin}/e/${shareSlug}`}
          />
          <Box>
            <Button variant="outlined" onClick={handleCreateAnother}>
              再出一套
            </Button>
          </Box>
        </Stack>
      )}
    </Container>
  );
}
