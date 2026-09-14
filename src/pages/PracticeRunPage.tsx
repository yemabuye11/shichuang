import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Container,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { getPracticeForStudent, submitPracticeAnswers } from '@/services/practiceService';
import type { StudentQuestion, StudentPractice } from '@/types/practice';
import { AppError } from '@/services/http/errors';

/** 视图状态：加载中 / 可作答 / 练习不存在或已关闭 / 加载出错。 */
type ViewStatus = 'loading' | 'ready' | 'closed' | 'error';

/** 提交结果（后端判分后返回）。 */
interface SubmitOutcome {
  score: number;
  total: number;
  perQuestion: boolean[];
  explanations: string[];
}

/** 选项下标 → 字母编号（0→A, 1→B …）。 */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/**
 * 学生端「每日一练」免登录作答页（路径 /p/:slug）。
 *
 * 设计要点（见 docs/PLAN_每日一练.md §三 / §八）：
 * - 免登录，不引入 RequireAuth；答案 / 解析仅由服务端在提交后返回，前端从不持有；
 * - 挂载即按 slug 读取题目（走白名单 RPC，绝不含 answer / explanation）；
 * - 多天练习按「第 N 天」分段切换，一次提交一天；
 * - 移动端优先：Container maxWidth="sm" + 纵向堆叠，按钮够大；
 * - 仅本文件新增，不改 router / 导航 / 其它页面（路由接线由 lead 统一做）。
 */
export function PracticeRunPage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();

  const [status, setStatus] = useState<ViewStatus>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [practiceSet, setPracticeSet] = useState<StudentPractice | null>(null);
  const [questions, setQuestions] = useState<StudentQuestion[]>([]);

  const [activeDay, setActiveDay] = useState(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [studentName, setStudentName] = useState('');
  const [startTime, setStartTime] = useState(0);
  const [submitError, setSubmitError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitOutcome | null>(null);

  /** 当前选中的某一天题目（按 seq 升序）。 */
  const dayQuestions = useMemo(
    () =>
      questions
        .filter((q) => q.dayNo === activeDay)
        .sort((a, b) => a.seq - b.seq),
    [questions, activeDay],
  );

  /** 加载练习（免登录，去敏 RPC）。 */
  const loadPractice = useCallback(async (): Promise<void> => {
    if (!slug) {
      setStatus('closed');
      return;
    }
    setStatus('loading');
    setSubmitError('');
    try {
      const res = await getPracticeForStudent(slug);
      if (!res.set || !res.set.title || res.questions.length === 0) {
        setStatus('closed');
        return;
      }
      if (res.set.status !== 'published') {
        setStatus('closed');
        return;
      }
      setPracticeSet(res.set);
      setQuestions(res.questions);
      setActiveDay(1);
      setAnswers({});
      setResult(null);
      setSubmitError('');
      setStartTime(Date.now());
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
    void loadPractice();
  }, [loadPractice]);

  /** 记录某题作答（同时清掉提交错误提示）。 */
  const handleAnswerChange = (seq: number, value: string): void => {
    setSubmitError('');
    setAnswers((prev) => ({ ...prev, [seq]: value }));
  };

  /** 提交当前天作答（前端不持有答案，判分在服务端）。 */
  const handleSubmit = async (): Promise<void> => {
    if (!slug || !practiceSet || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      // 按当前天题目顺序组装答案：choice=字母、judge=对/错、fill=原文本。
      const payload = dayQuestions.map((q) => answers[q.seq] ?? '');
      // 后端暂未接收 duration_ms，先本地计算留待后续上报。
      const durationMs = startTime ? Date.now() - startTime : 0;
      void durationMs;
      const res = await submitPracticeAnswers({
        slug,
        dayNo: activeDay,
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

  /** 再做一次：重置作答，重新进入同一天的作答（同名同天会覆盖提交）。 */
  const handleRetry = (): void => {
    setAnswers({});
    setResult(null);
    setSubmitError('');
    setStartTime(Date.now());
  };

  // ---- 加载中 ----
  if (status === 'loading') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2, color: 'text.secondary' }}>正在加载练习…</Typography>
      </Container>
    );
  }

  // ---- 练习不存在 / 已关闭 ----
  if (status === 'closed') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, textAlign: 'center', px: 3 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 700 }}>练习不存在或已关闭</Typography>
        <Typography sx={{ mt: 1.5, color: 'text.secondary', lineHeight: 1.6 }}>
          链接可能已失效，或老师已停止本次作答。请向老师确认最新链接。
        </Typography>
      </Container>
    );
  }

  // ---- 加载出错（网络等） ----
  if (status === 'error') {
    return (
      <Container maxWidth="sm" sx={{ py: 8, px: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadPractice()}>
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
            你对了 {result.score} / {result.total} 题
          </Typography>
          <Stack spacing={2} sx={{ mt: 2.5 }}>
            {dayQuestions.map((q, i) => {
              const correct = result.perQuestion[i] ?? false;
              const explanation = result.explanations[i] ?? '';
              return (
                <Box
                  key={q.seq}
                  sx={{
                    p: 1.75,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: correct ? 'success.main' : 'error.main',
                    bgcolor: correct ? 'rgba(46,160,67,0.06)' : 'rgba(211,47,47,0.06)',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Typography
                      sx={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: correct ? 'success.main' : 'error.main',
                        whiteSpace: 'nowrap',
                        mt: 0.25,
                      }}
                    >
                      {correct ? '答对' : '答错'}
                    </Typography>
                    <Typography sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{q.stem}</Typography>
                  </Stack>
                  {explanation ? (
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 1, lineHeight: 1.6 }}>
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
            提示：同一天再次提交会覆盖上一次成绩。
          </Typography>
        </Paper>
      </Container>
    );
  }

  // ---- 作答页 ----
  const dayTabs = Array.from({ length: practiceSet?.dayCount ?? 1 }, (_, i) => i + 1);

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 }, px: 2 }}>
      <Paper
        elevation={0}
        sx={{ p: { xs: 2, sm: 3 }, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}
      >
        {/* 头部信息 */}
        <Typography sx={{ fontSize: { xs: 22, sm: 26 }, fontWeight: 800, lineHeight: 1.35 }}>
          {practiceSet?.title}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
          {practiceSet?.grade ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{practiceSet.grade}</Typography>
          ) : null}
          {practiceSet?.subject ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{practiceSet.subject}</Typography>
          ) : null}
          {practiceSet?.chapter ? (
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>· {practiceSet.chapter}</Typography>
          ) : null}
        </Stack>

        {/* 昵称（选填） */}
        <TextField
          label="昵称（选填）"
          value={studentName}
          onChange={(e) => setStudentName(e.target.value)}
          size="small"
          fullWidth
          sx={{ mt: 2 }}
          placeholder="不填也行，方便老师识别你"
        />

        {/* 天数切换（多天才显示） */}
        {practiceSet && practiceSet.dayCount > 1 ? (
          <Tabs
            value={activeDay}
            onChange={(_, v) => setActiveDay(v as number)}
            variant="scrollable"
            scrollButtons="auto"
            allowScrollButtonsMobile
            sx={{ mt: 2, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            {dayTabs.map((d) => (
              <Tab key={d} label={`第 ${d} 天`} value={d} />
            ))}
          </Tabs>
        ) : null}

        {/* 题目列表 */}
        {dayQuestions.length === 0 ? (
          <Typography sx={{ mt: 3, color: 'text.secondary' }}>本天暂无可作答的题目。</Typography>
        ) : (
          <Stack spacing={2.5} sx={{ mt: 2.5 }}>
            {dayQuestions.map((q, idx) => (
              <Box key={q.seq}>
                <Typography sx={{ fontSize: 16, fontWeight: 600, lineHeight: 1.55, mb: 1 }}>
                  {idx + 1}. {q.stem}
                </Typography>

                {q.qtype === 'choice' && q.options ? (
                  <RadioGroup
                    value={answers[q.seq] ?? ''}
                    onChange={(e) => handleAnswerChange(q.seq, e.target.value)}
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
                    value={answers[q.seq] ?? ''}
                    onChange={(e) => handleAnswerChange(q.seq, e.target.value)}
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
                    value={answers[q.seq] ?? ''}
                    onChange={(e) => handleAnswerChange(q.seq, e.target.value)}
                    fullWidth
                    size="small"
                    placeholder="请填写你的答案"
                    sx={{ mt: 0.5 }}
                  />
                ) : null}
              </Box>
            ))}
          </Stack>
        )}

        {/* 提交错误提示 */}
        {submitError ? (
          <Alert severity="error" sx={{ mt: 2.5 }}>
            {submitError}
          </Alert>
        ) : null}

        {/* 提交按钮 */}
        <Button
          variant="contained"
          fullWidth
          size="large"
          sx={{ mt: 3, minHeight: 52 }}
          disabled={submitting}
          onClick={() => void handleSubmit()}
        >
          {submitting ? '提交中…' : '提交'}
        </Button>
      </Paper>
    </Container>
  );
}

export default PracticeRunPage;
