/**
 * 创建每日一练向导页（T10 教师端）。
 *
 * 两条出题路径，用 MUI Tabs 切换：
 * - 路径 A「AI 生成」：填表（学科/年级/章节/天数/题量/题型/难度）→ 实时预估积分 →
 *   生成 → 可编辑预览 → 保存发布拿分享链接。
 * - 路径 B「上传题目」：下载模板 → 上传 CSV/文本 → 本地解析（省积分）→ 解析不出则
 *   「用 AI 识别」→ 可编辑预览（复用同一渲染）→ 保存发布。
 *
 * 预览编辑逻辑抽成文件内私有组件 <QuestionEditor>，两条路径共用，不拆文件。
 *
 * 红线：只用本项目已有依赖（React / MUI v6 / React Router 不需要 / 服务层 / 类型），
 * 不引入任何新 npm 依赖；用到的每个 MUI / React 符号都已 import。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Container,
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
import DownloadIcon from '@mui/icons-material/Download';

import {
  estimatePracticeCredits,
  generatePractice,
  importQuestionsWithAi,
  parseQuestionsLocally,
  savePractice,
} from '@/services/practiceService';
import { downloadPracticeTemplate } from '@/utils/csv';
import type { PracticeQType, PracticeQuestion } from '@/types/practice';

/** 出题路径。 */
type Mode = 'ai' | 'upload';
/** 向导步骤。 */
type Step = 'edit' | 'preview' | 'done';

const DAY_TIERS: number[] = [1, 3, 5, 10, 20];
const DIFFICULTIES: string[] = ['基础', '提高'];
const QTYPES: { key: PracticeQType; label: string }[] = [
  { key: 'choice', label: '选择' },
  { key: 'fill', label: '填空' },
  { key: 'judge', label: '判断' },
];
const OPTION_LETTERS: string[] = ['A', 'B', 'C', 'D'];

/** 把任意错误转成可展示的中文文案（AppError 的 message 即接口返回的中文）。 */
function toMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return '操作失败，请稍后重试';
}

/** 生成一道空白选择题（新增题目时使用）。 */
function makeBlankQuestion(seq: number): PracticeQuestion {
  return {
    dayNo: 1,
    seq,
    qtype: 'choice',
    stem: '',
    options: ['', '', '', ''],
    answer: [],
    explanation: undefined,
  };
}

// ---------------------------------------------------------------------------
// 私有组件：可编辑题目列表（两条路径共用）
// ---------------------------------------------------------------------------

interface QuestionEditorProps {
  questions: PracticeQuestion[];
  dayCount: number;
  onChange: (qs: PracticeQuestion[]) => void;
}

/**
 * 预览步骤的可编辑题目列表。每题一张 Paper：题干（多行）、题型、第几天、
 * 选项（仅选择）、答案、解析；支持新增 / 删除 / 改 dayNo。
 */
function QuestionEditor({ questions, dayCount, onChange }: QuestionEditorProps) {
  const dayOptions = useMemo<number[]>(
    () => Array.from({ length: Math.max(1, dayCount) }, (_, i) => i + 1),
    [dayCount],
  );

  const update = (idx: number, patch: Partial<PracticeQuestion>) => {
    onChange(
      questions.map((q, i) => (i === idx ? { ...q, ...patch, seq: i + 1 } : q)),
    );
  };

  const remove = (idx: number) => {
    onChange(
      questions
        .filter((_, i) => i !== idx)
        .map((q, i) => ({ ...q, seq: i + 1 })),
    );
  };

  const add = () => {
    onChange([...questions, makeBlankQuestion(questions.length + 1)]);
  };

  const changeQtype = (idx: number, qt: PracticeQType) => {
    const q = questions[idx];
    const patch: Partial<PracticeQuestion> = { qtype: qt };
    if (qt === 'choice' && !q.options) {
      patch.options = ['', '', '', ''];
    } else if (qt !== 'choice') {
      patch.options = undefined;
    }
    update(idx, patch);
  };

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <Typography variant="subtitle1">题目预览（共 {questions.length} 题）</Typography>
        <Button variant="outlined" onClick={add}>
          ＋ 新增一题
        </Button>
      </Stack>

      {questions.length === 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          还没有题目，点「＋ 新增一题」手动添加，或返回上一步重新生成 / 识别。
        </Alert>
      )}

      {questions.map((q, idx) => (
        <Paper key={idx} variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel id={`dayno-label-${idx}`}>第几天</InputLabel>
              <Select
                labelId={`dayno-label-${idx}`}
                label="第几天"
                value={q.dayNo}
                onChange={(e) => update(idx, { dayNo: Number(e.target.value) })}
              >
                {dayOptions.map((d) => (
                  <MenuItem key={d} value={d}>
                    第 {d} 天
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id={`qtype-label-${idx}`}>题型</InputLabel>
              <Select
                labelId={`qtype-label-${idx}`}
                label="题型"
                value={q.qtype}
                onChange={(e) => changeQtype(idx, e.target.value as PracticeQType)}
              >
                {QTYPES.map((t) => (
                  <MenuItem key={t.key} value={t.key}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ flexGrow: 1 }} />
            <Button color="error" size="small" onClick={() => remove(idx)}>
              删除
            </Button>
          </Stack>

          <TextField
            label="题干"
            size="small"
            fullWidth
            multiline
            minRows={2}
            value={q.stem}
            onChange={(e) => update(idx, { stem: e.target.value })}
            sx={{ mb: 1.5 }}
          />

          {q.qtype === 'choice' && (
            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {OPTION_LETTERS.map((letter, oi) => (
                <TextField
                  key={letter}
                  label={`选项 ${letter}`}
                  size="small"
                  fullWidth
                  value={q.options?.[oi] ?? ''}
                  onChange={(e) => {
                    const opts = [...(q.options ?? ['', '', '', ''])];
                    opts[oi] = e.target.value;
                    update(idx, { options: opts });
                  }}
                />
              ))}
            </Stack>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="答案"
              size="small"
              sx={{ flex: 1 }}
              value={q.answer[0] ?? ''}
              placeholder={
                q.qtype === 'judge'
                  ? '对 / 错'
                  : q.qtype === 'fill'
                    ? '多空用 | 分隔'
                    : '如 A'
              }
              onChange={(e) =>
                update(idx, { answer: [e.target.value.trim().toUpperCase()] })
              }
            />
            <TextField
              label="解析（选填）"
              size="small"
              sx={{ flex: 2 }}
              value={q.explanation ?? ''}
              onChange={(e) =>
                update(idx, { explanation: e.target.value || undefined })
              }
            />
          </Stack>
        </Paper>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// 主页面
// ---------------------------------------------------------------------------

/**
 * 创建每日一练向导页。含「AI 生成」「上传题目」两条路径，最终都收敛到
 * 可编辑预览 → 保存发布 → 分享链接。
 */
export default function PracticeCreatePage() {
  const [mode, setMode] = useState<Mode>('ai');
  const [step, setStep] = useState<Step>('edit');

  // 通用状态
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [previewDayCount, setPreviewDayCount] = useState<number>(1);
  const [title, setTitle] = useState<string>('我的每日一练');
  const [shareSlug, setShareSlug] = useState<string>('');

  // 路径 A 表单状态
  const [subject, setSubject] = useState<string>('语文');
  const [grade, setGrade] = useState<string>('二年级');
  const [chapter, setChapter] = useState<string>('');
  const [dayCount, setDayCount] = useState<number>(3);
  const [questionPerDay, setQuestionPerDay] = useState<number>(5);
  const [qtypes, setQtypes] = useState<{
    choice: boolean;
    fill: boolean;
    judge: boolean;
  }>({ choice: true, fill: true, judge: false });
  const [difficulty, setDifficulty] = useState<string>('基础');
  const [estimatedCredits, setEstimatedCredits] = useState<number | null>(null);

  // 路径 B 上传状态
  const [uploadText, setUploadText] = useState<string>('');
  // 本地解析失败后，露出「用 AI 识别」按钮。
  const [needAi, setNeedAi] = useState<boolean>(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 切换路径：重置步骤与数据，避免两路状态串台。
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setStep('edit');
    setError(null);
    setNotice(null);
    setQuestions([]);
    setShareSlug('');
    setNeedAi(false);
  };

  // 实时预估积分：天数变化时重算（展示用，实际扣费以发布时为准）。
  useEffect(() => {
    let alive = true;
    estimatePracticeCredits(dayCount)
      .then((c) => {
        if (alive) setEstimatedCredits(c);
      })
      .catch(() => {
        if (alive) setEstimatedCredits(null);
      });
    return () => {
      alive = false;
    };
  }, [dayCount]);

  // 路径 A：生成题目。
  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const qt: PracticeQType[] = [];
      if (qtypes.choice) qt.push('choice');
      if (qtypes.fill) qt.push('fill');
      if (qtypes.judge) qt.push('judge');
      if (qt.length === 0) throw new Error('请至少选择一种题型');

      const res = await generatePractice({
        subject,
        grade,
        chapter,
        textbookVersionId: null,
        dayCount,
        questionPerDay,
        qtypes: qt,
        difficulty,
      });
      const qs: PracticeQuestion[] = res.questions.map((q, i) => ({
        ...q,
        seq: i + 1,
      }));
      setQuestions(qs);
      setPreviewDayCount(dayCount);
      setTitle(`${subject}${grade}每日一练`);
      setNotice(
        qs.length === 0
          ? 'AI 没有返回题目，可返回调整参数重试，或在预览里手动新增。'
          : null,
      );
      setStep('preview');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // 路径 B：读取上传文件 → 本地解析（省积分）。
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    setLoading(true);
    setError(null);
    setNotice(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setUploadText(text);
      const parsed = parseQuestionsLocally(text);
      if (parsed.length >= 1) {
        const qs = parsed.map((q, i) => ({ ...q, seq: i + 1 }));
        setQuestions(qs);
        setPreviewDayCount(Math.max(1, ...parsed.map((p) => p.dayNo)));
        setTitle('我的每日一练（上传）');
        setNotice(`已按模板解析出 ${parsed.length} 题（不消耗积分）`);
        setNeedAi(false);
        setStep('preview');
      } else {
        // 解析不出：提示并露出「用 AI 识别」按钮（仍停留 edit 步骤）。
        setNotice('模板没解析出来，可点「用 AI 识别」用 AI 帮你结构化。');
        setNeedAi(true);
      }
      setLoading(false);
    };
    reader.onerror = () => {
      setError('读取文件失败，请重试');
      setLoading(false);
    };
    reader.readAsText(file);
  };

  // 路径 B：用 AI 识别上传/粘贴的题目文本。
  const handleAiImport = async () => {
    if (!uploadText) {
      setError('请先上传题目文件，再点「用 AI 识别」');
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await importQuestionsWithAi(uploadText);
      const qs: PracticeQuestion[] = res.questions.map((q, i) => ({
        ...q,
        seq: i + 1,
      }));
      setQuestions(qs);
      setPreviewDayCount(Math.max(1, ...qs.map((p) => p.dayNo)));
      setTitle('我的每日一练（上传）');
      setNeedAi(false);
      setStep('preview');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // 保存并发布（两条路径共用）。
  const handleSave = async () => {
    if (questions.length === 0) {
      setError('请先生成或添加题目后再发布');
      return;
    }
    if (!title.trim()) {
      setError('请填写练习标题');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await savePractice({
        title: title.trim(),
        // 上传路径不收集学科/年级/章节，用合理默认值（接线层可后续扩展）。
        subject: mode === 'ai' ? subject : '语文',
        grade: mode === 'ai' ? grade : '二年级',
        chapter: mode === 'ai' ? chapter : '',
        textbookVersionId: null,
        dayCount: previewDayCount,
        source: mode,
        questions: questions.map((q, i) => ({ ...q, seq: i + 1 })),
      });
      setShareSlug(res.shareSlug);
      setStep('done');
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    const url = `${window.location.origin}/p/${shareSlug}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => undefined);
    }
  };

  const handleCreateAnother = () => {
    setStep('edit');
    setQuestions([]);
    setShareSlug('');
    setError(null);
    setNotice(null);
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 600 }}>
        创建每日一练
      </Typography>

      <Tabs
        value={mode}
        onChange={(_, v) => switchMode(v as Mode)}
        sx={{ mb: 3 }}
      >
        <Tab value="ai" label="AI 生成" />
        <Tab value="upload" label="上传题目" />
      </Tabs>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {notice && !error && (
        <Alert
          severity={step === 'preview' ? 'info' : 'warning'}
          sx={{ mb: 2 }}
        >
          {notice}
        </Alert>
      )}

      {/* -------------------- 步骤：编辑（表单 / 上传） -------------------- */}
      {step === 'edit' && mode === 'ai' && (
        <Stack spacing={2}>
          <TextField
            label="学科"
            size="small"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <TextField
            label="年级"
            size="small"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
          <TextField
            label="章节"
            size="small"
            placeholder="如：第三单元 课文"
            value={chapter}
            onChange={(e) => setChapter(e.target.value)}
          />
          <FormControl size="small">
            <InputLabel id="daycount-label">天数</InputLabel>
            <Select
              labelId="daycount-label"
              label="天数"
              value={dayCount}
              onChange={(e) => setDayCount(Number(e.target.value))}
            >
              {DAY_TIERS.map((t) => (
                <MenuItem key={t} value={t}>
                  {t} 天
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="每天题量"
            size="small"
            type="number"
            value={questionPerDay}
            onChange={(e) => setQuestionPerDay(Number(e.target.value) || 0)}
          />
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5, color: 'text.secondary' }}>
              题型
            </Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {QTYPES.map((t) => (
                <FormControlLabel
                  key={t.key}
                  control={
                    <Checkbox
                      checked={qtypes[t.key]}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setQtypes((prev) => {
                          if (t.key === 'choice') return { ...prev, choice: checked };
                          if (t.key === 'fill') return { ...prev, fill: checked };
                          return { ...prev, judge: checked };
                        });
                      }}
                    />
                  }
                  label={t.label}
                />
              ))}
            </Stack>
          </Box>
          <FormControl size="small">
            <InputLabel id="difficulty-label">难度</InputLabel>
            <Select
              labelId="difficulty-label"
              label="难度"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {DIFFICULTIES.map((d) => (
                <MenuItem key={d} value={d}>
                  {d}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {estimatedCredits !== null && (
            <Alert severity="info">
              预计消耗约 {estimatedCredits.toFixed(1)} 积分（实际以发布时扣费为准）
            </Alert>
          )}

          <Box>
            <Button
              variant="contained"
              disabled={loading}
              onClick={handleGenerate}
            >
              {loading ? <CircularProgress size={20} color="inherit" /> : '生成题目'}
            </Button>
          </Box>
        </Stack>
      )}

      {step === 'edit' && mode === 'upload' && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            先下载模板、按格式填好题目，再上传；模板规整时会自动本地解析，不消耗积分。
          </Typography>
          <Box>
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={() => downloadPracticeTemplate()}
              sx={{ mr: 1.5 }}
            >
              下载模板
            </Button>
            <Button
              variant="contained"
              disabled={loading}
              onClick={() => fileRef.current?.click()}
            >
              {loading ? <CircularProgress size={20} color="inherit" /> : '上传题目文件'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              hidden
              onChange={handleFile}
            />
          </Box>

          {/* 本地没解析出来时，露出 AI 识别入口 */}
          {needAi && uploadText && (
            <Button
              variant="contained"
              color="secondary"
              disabled={loading}
              onClick={handleAiImport}
            >
              {loading ? <CircularProgress size={20} color="inherit" /> : '用 AI 识别'}
            </Button>
          )}
        </Stack>
      )}

      {/* -------------------- 步骤：预览（可编辑） -------------------- */}
      {step === 'preview' && (
        <Stack spacing={2}>
          <TextField
            label="练习标题"
            size="small"
            fullWidth
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <QuestionEditor
            questions={questions}
            dayCount={previewDayCount}
            onChange={setQuestions}
          />
          <Stack direction="row" spacing={2}>
            <Button variant="text" onClick={() => setStep('edit')} disabled={loading}>
              返回修改
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={loading}>
              {loading ? <CircularProgress size={20} color="inherit" /> : '保存并发布'}
            </Button>
          </Stack>
        </Stack>
      )}

      {/* -------------------- 步骤：完成（分享链接） -------------------- */}
      {step === 'done' && (
        <Stack spacing={2}>
          <Alert severity="success">已发布！把下面这条链接发给学生即可。</Alert>
          <TextField
            label="分享链接"
            size="small"
            fullWidth
            inputProps={{ readOnly: true }}
            InputProps={{
              endAdornment: (
                <IconButton onClick={handleCopy} edge="end" aria-label="复制链接">
                  <ContentCopyIcon />
                </IconButton>
              ),
            }}
            value={`${window.location.origin}/p/${shareSlug}`}
          />
          <Box>
            <Button variant="outlined" onClick={handleCreateAnother}>
              再创建一个
            </Button>
          </Box>
        </Stack>
      )}
    </Container>
  );
}
