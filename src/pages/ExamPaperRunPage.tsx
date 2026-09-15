/**
 * 学生端「组卷」免登录作答页（路径 /e/:slug）。
 *
 * 设计要点：
 * - 免登录、不包 RequireAuth：老师把 /e/{slug} 发给学生，点开就做；
 * - 读题走白名单 RPC `get_exam_paper_for_student`，**前端全程不持有答案**；
 * - 按大题（section）分组展示，题号在大题内重新起算；
 * - 客观题服务端自动判分，主观题只记录作答、显示「待老师批改」；
 * - 移动端优先：Container maxWidth="sm" + 纵向堆叠 + 大号按钮（≥44px）。
 *
 * 红线：不引入任何新依赖；禁止直接 import supabaseClient。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { getExamForStudent, submitExamAnswers } from '@/services/examPaperService';
import { AppError } from '@/services/http/errors';
import type { ExamQType, StudentExamQuestion } from '@/types/examPaper';

/** 视图状态：加载中 / 可作答 / 卷不存在或已关闭 / 加载出错。 */
type ViewStatus = 'loading' | 'ready' | 'closed' | 'error';

/** 试卷概要（本地最小结构，避免重复 import 太多类型）。 */
interface PaperMeta {
  title: string;
  grade: string;
  subject: string;
  unit: string;
}

/** 提交结果（服务端判分后返回）。 */
interface SubmitOutcome {
  objectiveScore: number;
  objectiveTotal: number;
  perQuestion: (boolean | null)[];
  explanations: string[];
}

/** 选项下标 → 字母（0→A, 1→B …）。 */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** 题型 → 中文标签（结果页展示用）。 */
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
 * 学生端作答页。
 *
 * 导出方式对齐既有 Practice 页面：named export `ExamPaperRunPage` + default 兜底。
 */
export function ExamPaperRunPage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();

  const [status, setStatus] = useState<ViewStatus>('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [paper, setPaper] = useState<PaperMeta | null>(null);
  const [questions, setQuestions] = useState<StudentExamQuestion[]>([]);

  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [studentName, setStudentName] = useState<string>('');
  const [submitError, setSubmitError] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<SubmitOutcome | null>(null);

  /** 按大题分组后的题目（保持 (section_no, seq) 顺序）。 */
  const grouped = useMemo(() => {
    const map = new Map<number, { title: string; items: StudentExamQuestion[] }>();
    for (const q of questions) {
      const cur = map.get(q.sectionNo) ?? { title: q.sectionTitle, items: [] };
      cur.items.push(q);
      map.set(q.sectionNo, cur);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([sectionNo, v]) => ({ sectionNo, title: v.title, items: v.items }));
  }, [questions]);

  /** 卷面总分（各题分值之和）。 */
  const totalScore = useMemo(
    () => questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0),
    [questions],
  );

  /** 加载试卷（免登录，去敏 RPC）。 */
  const loadExam = useCallback(async (): Promise<void> => {
    if (!slug) {
      setStatus('closed');
      return;
    }
    setStatus('loading');
    setSubmitError('');
    try {
      const res = await getExamForStudent(slug);
      if (!res.paper || !res.paper.title || res.questions.length === 0) {
        setStatus('closed');
        return;
      }
      if (res.paper.status !== 'published') {
        setStatus('closed');
        return;
      }
      setPaper({
        title: res.paper.title,
        grade: res.paper.grade,
        subject: res.paper.subject,
        unit: res.paper.unit,
      });
      setQuestions(res.questions);
      setAnswers({});
      setResult(null);
      setStatus('ready');
    } catch (err: unknown) {
      if (err instanceof AppError && err.code === 'NOT_FOUND') {
        setStatus('closed');
        return;
      }
      setErrorMsg(err instanceof Error ? err.message : '加载失败，请稍后重试');
      setStatus('error');
    }
  }, [slug]);

  useEffect(() => {
    void loadExam();
  }, [loadExam]);

  /** 记录某题作答（key = 全局下标）。 */
  const handleAnswerChange = (index: number, value: string): void => {
    setSubmitError('');
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  /** 提交作答（判分在服务端，前端不持有答案）。 */
  const handleSubmit = async (): Promise<void> => {
    if (!slug || !paper || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      // 按 (section_no, seq) 排好的全局下标组装答案数组
      const payload = questions.map((_, i) => answers[i] ?? '');
      const res = await submitExamAnswers({
        slug,
        studentName: studentName.trim(),
        answers: payload,
      });
      setResult(res);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  /** 再做一次：清空作答重新来（同名学生会覆盖上一次提交）。 */
  const handleRetry = (): void => {
    setAnswers({});
    setResult(null);
    setSubmitError('');
  };

  /** 已作答的客观题数量（提示用）。 */
  const answeredObjective = useMemo(
    () =>
      questions.filter(
        (q, i) => q.qtype !== 'subjective' && (answers[i] ?? '').trim().length > 0,
      ).length,
    [questions, answers],
  );
  const objectiveCount = useMemo(
    () => questions.filter((q) => q.qtype !== 'subjective').length,
    [questions],
  );

  // ---- 加载中 ----
  if (status === 'loading') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2, color: 'text.secondary' }}>正在加载测验卷…</Typography>
      </Container>
    );
  }

  // ---- 卷不存在 / 已关闭 ----
  if (status === 'closed') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center', px: 3 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 700 }}>测验卷不存在或已关闭</Typography>
        <Typography sx={{ mt: 1.5, color: 'text.secondary', lineHeight: 1.6 }}>
          链接可能已失效，或老师已停止本次作答。请向老师确认最新链接。
        </Typography>
      </Container>
    );
  }

  // ---- 加载出错 ----
  if (status === 'error') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, px: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadExam()}>
              重试
            </Button>
          }
        >
          {errorMsg || '出了点小问题，请稍后重试'}
        </Alert>
      </Container>
    );
  }

  // ---- 提交结果页 ----
  if (result) {
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, px: 2 }}>
        <Paper
          elevation={0}
          sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}
        >
          <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 800 }}>
            客观题：答对 {result.objectiveScore} / {result.objectiveTotal} 题
          </Typography>
          {questions.some((q) => q.qtype === 'subjective') && (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              主观题已提交，等老师批阅后在老师后台给分。
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 2.5 }}>
            {questions.map((q, i) => {
              const verdict = result.perQuestion[i] ?? null;
              const explanation = result.explanations[i] ?? '';
              const isSubjective = q.qtype === 'subjective';
              const borderColor = isSubjective ? 'divider' : verdict ? 'success.main' : 'error.main';
              return (
                <Box
                  key={i}
                  sx={{
                    p: 1.75,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor,
                    bgcolor: isSubjective
                      ? 'transparent'
                      : verdict
                        ? 'rgba(46,160,67,0.06)'
                        : 'rgba(211,47,47,0.06)',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Typography
                      sx={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: isSubjective ? 'text.secondary' : verdict ? 'success.main' : 'error.main',
                        whiteSpace: 'nowrap',
                        mt: 0.25,
                      }}
                    >
                      {isSubjective ? '待批改' : verdict ? '答对' : '答错'}
                    </Typography>
                    <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>
                      {q.stem}
                    </Typography>
                  </Stack>

                  {!isSubjective && (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.75 }}>
                      你的作答：{(answers[i] ?? '').trim() || '（未作答）'}
                    </Typography>
                  )}

                  {explanation ? (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.75, lineHeight: 1.6 }}>
                      解析：{explanation}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </Stack>

          <Button
            variant="contained"
            fullWidth
            size="large"
            sx={{ mt: 3, minHeight: 50 }}
            onClick={handleRetry}
          >
            再做一次
          </Button>
          <Typography sx={{ mt: 1.5, fontSize: 12.5, color: 'text.secondary', textAlign: 'center' }}>
            提示：用同一个昵称再次提交会覆盖上一次成绩。
          </Typography>
        </Paper>
      </Container>
    );
  }

  // ---- 作答页 ----
  let globalIndex = -1;

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 }, px: 2 }}>
      <Paper
        elevation={0}
        sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}
      >
        {/* 头部信息 */}
        <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 800, lineHeight: 1.35 }}>
          {paper?.title}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
          {paper?.grade ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{paper.grade}</Typography>
          ) : null}
          {paper?.subject ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{paper.subject}</Typography>
          ) : null}
          {paper?.unit ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>· {paper.unit}</Typography>
          ) : null}
          {totalScore > 0 ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              · 卷面 {Math.round(totalScore * 10) / 10} 分
            </Typography>
          ) : null}
        </Stack>

        <TextField
          label="昵称 / 学号后四位（选填）"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          size="small"
          fullWidth
          sx={{ mt: 2 }}
          placeholder="不填也行，方便老师识别你"
        />

        {/* 按大题分组作答 */}
        <Stack spacing={3} sx={{ mt: 2.5 }}>
          {grouped.map((group) => (
            <Box key={group.sectionNo}>
              <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 0.25 }}>
                {group.title || `第 ${group.sectionNo} 大题`}
              </Typography>
              <Divider sx={{ mb: 1.5 }} />

              <Stack spacing={2.5}>
                {group.items.map((q) => {
                  globalIndex += 1;
                  const idx = globalIndex;
                  const seqInSection = group.items.indexOf(q) + 1;
                  return (
                    <Box key={`${group.sectionNo}-${q.seq}`}>
                      <Typography sx={{ fontSize: 16, fontWeight: 600, lineHeight: 1.55, mb: 1 }}>
                        {seqInSection}. {q.stem}
                        <Box component="span" sx={{ fontSize: 13, color: 'text.secondary', ml: 1 }}>
                          （{q.score} 分 · {qtypeLabel(q.qtype)}）
                        </Box>
                      </Typography>

                      {q.qtype === 'choice' && q.options ? (
                        <RadioGroup
                          value={answers[idx] ?? ''}
                          onChange={(e) => handleAnswerChange(idx, e.target.value)}
                        >
                          {q.options.map((opt, oi) => (
                            <FormControlLabel
                              key={oi}
                              value={optionLetter(oi)}
                              control={<Radio />}
                              label={opt}
                              sx={{
                                alignItems: 'flex-start',
                                '& .MuiFormControlLabel-label': { fontSize: 15, lineHeight: 1.5 },
                              }}
                            />
                          ))}
                        </RadioGroup>
                      ) : null}

                      {q.qtype === 'judge' ? (
                        <RadioGroup
                          value={answers[idx] ?? ''}
                          onChange={(e) => handleAnswerChange(idx, e.target.value)}
                        >
                          <FormControlLabel
                            value="对"
                            control={<Radio />}
                            label="对"
                            sx={{ '& .MuiFormControlLabel-label': { fontSize: 15 } }}
                          />
                          <FormControlLabel
                            value="错"
                            control={<Radio />}
                            label="错"
                            sx={{ '& .MuiFormControlLabel-label': { fontSize: 15 } }}
                          />
                        </RadioGroup>
                      ) : null}

                      {q.qtype === 'fill' ? (
                        <TextField
                          value={answers[idx] ?? ''}
                          onChange={(e) => handleAnswerChange(idx, e.target.value)}
                          fullWidth
                          size="small"
                          placeholder="请填写你的答案（多个空请按顺序填写）"
                        />
                      ) : null}

                      {q.qtype === 'subjective' ? (
                        <TextField
                          value={answers[idx] ?? ''}
                          onChange={(e) => handleAnswerChange(idx, e.target.value)}
                          fullWidth
                          size="small"
                          multiline
                          minRows={3}
                          placeholder="请把解答过程 / 作文写在这里，老师会在后台批阅给分"
                        />
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </Stack>

        {submitError ? (
          <Alert severity="error" sx={{ mt: 2.5 }}>
            {submitError}
          </Alert>
        ) : null}

        <Typography sx={{ mt: 2.5, fontSize: 13, color: 'text.secondary' }}>
          已作答客观题 {answeredObjective} / {objectiveCount}
          {questions.length > objectiveCount
            ? ` · 主观题 ${questions.length - objectiveCount} 题（老师批阅后给分）`
            : ''}
        </Typography>

        <Button
          variant="contained"
          fullWidth
          size="large"
          sx={{ mt: 1.5, minHeight: 52 }}
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? '提交中…' : '提交'}
        </Button>
      </Paper>
    </Container>
  );
}

export default ExamPaperRunPage;
