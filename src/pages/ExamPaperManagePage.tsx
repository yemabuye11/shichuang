/**
 * 教师「组卷」管理 / 看板页（/exam/manage）。
 *
 * 能力：
 * - 挂载即拉取「我的组卷」（listMyExams）；
 * - 每张卷卡：复制 /e/{slug} 分享链接、查看统计、导出 CSV、关闭作答、清空提交；
 * - 统计弹层三块：① 完成名单（客观分 / 主观分 / 总分）② 每题统计（客观正确率 / 主观均分）
 *   ③ **主观题批改**（选学生 → 看他的作答 → 逐题给分，保存即写回服务端）；
 * - 空列表给友好提示；顶部「刷新」显式重载。
 *
 * 红线：不引入任何新依赖；页面禁止直接 import supabaseClient（一律走 service 层）。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import BarChartIcon from '@mui/icons-material/BarChart';
import DownloadIcon from '@mui/icons-material/Download';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import LinkIcon from '@mui/icons-material/Link';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import LibraryBooksIcon from '@mui/icons-material/LibraryBooks';
import SaveIcon from '@mui/icons-material/Save';

import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/ToastHost';
import {
  clearSubmissions,
  closeExam,
  exportExamPaperRecords,
  getExamStats,
  listMyExams,
  setSubjectiveScore,
} from '@/services/examPaperService';
import { copyText } from '@/utils/clipboard';
import { formatDateTime, formatPercent, formatRelativeTime } from '@/utils/format';
import type { ExamPaperSet, ExamPaperStats } from '@/types/examPaper';
import { AppError } from '@/services/http/errors';
import { ROUTES } from '@/config/routes';
import { useNavigate } from 'react-router-dom';

/** 卷状态 → 展示文案 + Chip 配色。 */
const STATUS_META: Record<
  ExamPaperSet['status'],
  { label: string; color: 'default' | 'success' | 'warning' }
> = {
  draft: { label: '草稿', color: 'warning' },
  published: { label: '已发布', color: 'success' },
  closed: { label: '已关闭', color: 'default' },
};

/** 卷来源 → 展示文案 + 小图标。 */
const SOURCE_META: Record<ExamPaperSet['source'], { label: string; icon: JSX.Element }> = {
  ai: { label: 'AI 生成', icon: <AutoAwesomeIcon sx={{ fontSize: 16 }} /> },
  upload: { label: '老师上传', icon: <UploadFileIcon sx={{ fontSize: 16 }} /> },
  bank: { label: '题库挑题', icon: <LibraryBooksIcon sx={{ fontSize: 16 }} /> },
};

/**
 * 教师「我的组卷」管理页。
 *
 * 导出方式对齐既有 Practice 页面：named export `ExamPaperManagePage` + default 兜底。
 */
export function ExamPaperManagePage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();

  const [exams, setExams] = useState<ExamPaperSet[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  // 统计弹层
  const [statsFor, setStatsFor] = useState<ExamPaperSet | null>(null);
  const [stats, setStats] = useState<ExamPaperStats | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(false);

  // 主观题批改
  const [gradingId, setGradingId] = useState<string>('');
  const [scoreDraft, setScoreDraft] = useState<Record<string, string>>({});
  const [savingQuestionId, setSavingQuestionId] = useState<string>('');

  // 二次确认
  const [closeTarget, setCloseTarget] = useState<ExamPaperSet | null>(null);
  const [clearTarget, setClearTarget] = useState<ExamPaperSet | null>(null);

  /** 拉取「我的组卷」；未登录（UNAUTHORIZED）时静默清空，不报错。 */
  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      setExams(await listMyExams());
    } catch (err) {
      if (err instanceof AppError && err.code === 'UNAUTHORIZED') {
        setExams([]);
        return;
      }
      toast.error(err instanceof Error ? err.message : '读取组卷失败，请重试');
      setExams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 仅挂载时拉一次；刷新由顶部按钮显式触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 复制学生作答链接。 */
  const handleCopyLink = async (shareSlug: string): Promise<void> => {
    const ok = await copyText(`${window.location.origin}/e/${shareSlug}`);
    toast[ok ? 'success' : 'error'](ok ? '分享链接已复制' : '复制失败，请手动复制');
  };

  /** 打开统计弹层。 */
  const handleOpenStats = async (exam: ExamPaperSet): Promise<void> => {
    setStatsFor(exam);
    setStats(null);
    setStatsLoading(true);
    setScoreDraft({});
    try {
      const data = await getExamStats(exam.id);
      setStats(data);
      setGradingId(data.submissions[0]?.submissionId ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取统计失败，请重试');
    } finally {
      setStatsLoading(false);
    }
  };

  /** 导出完成记录 CSV。 */
  const handleExport = async (exam: ExamPaperSet): Promise<void> => {
    setBusy(true);
    try {
      await exportExamPaperRecords(exam.id, { title: exam.title });
      toast.success('已导出完成记录（CSV）');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  /** 确认关闭作答。 */
  const handleClose = async (): Promise<void> => {
    if (!closeTarget) return;
    const target = closeTarget;
    setBusy(true);
    try {
      await closeExam(target.id);
      toast.success('已关闭作答，学生将无法再提交');
      setCloseTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '关闭失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  /** 确认清空提交。 */
  const handleClear = async (): Promise<void> => {
    if (!clearTarget) return;
    const target = clearTarget;
    setBusy(true);
    try {
      await clearSubmissions(target.id);
      toast.success('已清空该测验卷的全部提交记录');
      setClearTarget(null);
      if (statsFor?.id === target.id) await handleOpenStats(target);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  /** 主观题打分保存。 */
  const handleSaveScore = async (questionId: string): Promise<void> => {
    if (!gradingId || !questionId) return;
    const raw = (scoreDraft[questionId] ?? '').trim();
    const score = Number(raw);
    if (raw === '' || Number.isNaN(score) || score < 0) {
      toast.error('请填写一个不小于 0 的分数');
      return;
    }
    setSavingQuestionId(questionId);
    try {
      const finalScore = await setSubjectiveScore(gradingId, questionId, score);
      toast.success(`已打分，该生总分 ${Math.round(finalScore * 10) / 10} 分`);
      if (statsFor) {
        const data = await getExamStats(statsFor.id);
        setStats(data);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打分失败，请重试');
    } finally {
      setSavingQuestionId('');
    }
  };

  /** 主观题列表（含全局下标，用于取学生作答）。 */
  const subjectiveQuestions = useMemo(() => {
    if (!stats) return [];
    return stats.perQuestion
      .map((q, index) => ({ ...q, globalIndex: index }))
      .filter((q) => q.qtype === 'subjective');
  }, [stats]);

  /** 当前正在批改的那条提交。 */
  const gradingSubmission = useMemo(
    () => stats?.submissions.find((s) => s.submissionId === gradingId) ?? null,
    [stats, gradingId],
  );

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
      {/* ---- 顶部标题 ---- */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 800 }}>组卷</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
            我的测验卷 · 完成统计 · 主观题批改
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            size="medium"
            startIcon={<RefreshIcon />}
            onClick={() => void load()}
            disabled={loading}
            sx={{ minHeight: 40 }}
          >
            刷新
          </Button>
          <Button
            variant="contained"
            size="medium"
            onClick={() => navigate(ROUTES.EXAM_NEW)}
            sx={{ minHeight: 40 }}
          >
            出卷
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" variant="outlined" onClick={() => navigate(ROUTES.EXAM_BANK)}>
          去题库挑题
        </Button>
      </Stack>

      {/* ---- 三态：加载中 / 空 / 列表 ---- */}
      {loading ? (
        <InlineLoading message="正在加载我的组卷…" />
      ) : exams.length === 0 ? (
        <EmptyState icon="📄" title="还没有测验卷" description="还没有测验卷，去「出卷」生成第一套吧。" />
      ) : (
        <Stack spacing={2}>
          {exams.map((p) => {
            const status = STATUS_META[p.status];
            const source = SOURCE_META[p.source] ?? SOURCE_META.ai;
            const isClosed = p.status === 'closed';
            return (
              <Card key={p.id} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
                <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <Typography
                      sx={{ fontSize: 17, fontWeight: 700, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {p.title}
                    </Typography>
                    <Chip
                      label={status.label}
                      size="small"
                      color={status.color}
                      variant={isClosed ? 'outlined' : 'filled'}
                      sx={{ fontWeight: 600, flexShrink: 0 }}
                    />
                  </Stack>

                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                    <Chip
                      icon={source.icon}
                      label={source.label}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600, bgcolor: 'action.hover' }}
                    />
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      {p.subject} · {p.grade} · {p.unit || '未设置单元'}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{p.questionCount} 题</Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      卷面 {p.totalScore} 分
                    </Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      创建于 {formatRelativeTime(p.createdAt)}
                    </Typography>
                  </Stack>

                  <Divider sx={{ my: 1.5 }} />

                  <Stack direction="row" spacing={1} alignItems="center">
                    <LinkIcon sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />
                    <TextField
                      value={`/e/${p.shareSlug}`}
                      size="small"
                      fullWidth
                      InputProps={{ readOnly: true }}
                      inputProps={{ 'aria-label': '分享链接路径', style: { fontSize: 14 } }}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2, bgcolor: 'action.hover' } }}
                    />
                    <IconButton
                      aria-label="复制分享链接"
                      onClick={() => void handleCopyLink(p.shareSlug)}
                      sx={{ flexShrink: 0 }}
                    >
                      <ContentCopyIcon />
                    </IconButton>
                  </Stack>

                  <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<BarChartIcon />}
                      onClick={() => void handleOpenStats(p)}
                    >
                      查看统计
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      onClick={() => void handleExport(p)}
                      disabled={busy}
                    >
                      导出记录
                    </Button>
                    {isClosed ? (
                      <Button size="small" variant="outlined" disabled startIcon={<StopCircleIcon />}>
                        已关闭
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        startIcon={<StopCircleIcon />}
                        onClick={() => setCloseTarget(p)}
                        disabled={busy}
                      >
                        关闭作答
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteSweepIcon />}
                      onClick={() => setClearTarget(p)}
                      disabled={busy}
                    >
                      清空提交
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* ---- 统计弹层 ---- */}
      <Dialog open={Boolean(statsFor)} onClose={() => setStatsFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>{statsFor?.title} · 完成情况</DialogTitle>
        <DialogContent dividers>
          {statsLoading ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <CircularProgress />
            </Box>
          ) : (
            <Stack spacing={3}>
              {/* 表 1：完成名单 */}
              <Box>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>完成名单</Typography>
                {stats && stats.submissions.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>昵称</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>客观</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>主观</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>总分</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>提交时间</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stats.submissions.map((s) => (
                          <TableRow key={s.submissionId}>
                            <TableCell>{s.studentName || '匿名'}</TableCell>
                            <TableCell>
                              {s.score} / {s.objectiveTotal}
                            </TableCell>
                            <TableCell>{Math.round(s.subjectiveTotal * 10) / 10}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>
                              {Math.round(s.finalScore * 10) / 10}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {formatDateTime(s.submittedAt)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info" sx={{ fontSize: 14 }}>
                    还没有学生提交。
                  </Alert>
                )}
              </Box>

              {/* 表 2：每题统计 */}
              <Box>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>每题统计</Typography>
                {stats && stats.perQuestion.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>大题</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>题号</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>题干</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>指标</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stats.perQuestion.map((q, idx) => (
                          <TableRow key={`${q.questionId}-${idx}`}>
                            <TableCell>{q.sectionNo}</TableCell>
                            <TableCell>{q.seq}</TableCell>
                            <TableCell sx={{ maxWidth: 240 }}>{q.stem}</TableCell>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {q.metricType === 'correctRate'
                                ? formatPercent(q.metricValue)
                                : `均分 ${Math.round(q.metricValue * 100) / 100}`}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info" sx={{ fontSize: 14 }}>
                    暂无统计数据。
                  </Alert>
                )}
              </Box>

              {/* 表 3：主观题批改 */}
              {subjectiveQuestions.length > 0 && (
                <Box>
                  <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>主观题批改</Typography>

                  {stats && stats.submissions.length > 0 ? (
                    <Stack spacing={2}>
                      <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel id="grading-student-label">选择学生</InputLabel>
                        <Select
                          labelId="grading-student-label"
                          label="选择学生"
                          value={gradingId}
                          onChange={(e) => {
                            setGradingId(String(e.target.value));
                            setScoreDraft({});
                          }}
                        >
                          {stats.submissions.map((s) => (
                            <MenuItem key={s.submissionId} value={s.submissionId}>
                              {s.studentName || '匿名'}（客观 {s.score}/{s.objectiveTotal}）
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {gradingSubmission ? (
                        <Stack spacing={1.5}>
                          {subjectiveQuestions.map((q) => {
                            const studentAnswer = gradingSubmission.answers[q.globalIndex] ?? '';
                            return (
                              <Paper key={q.questionId} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                                <Typography sx={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.6 }}>
                                  {q.sectionNo}.{q.seq} {q.stem}
                                </Typography>
                                <Typography
                                  sx={{
                                    fontSize: 13.5,
                                    color: 'text.secondary',
                                    mt: 0.75,
                                    whiteSpace: 'pre-wrap',
                                    bgcolor: 'action.hover',
                                    p: 1,
                                    borderRadius: 1.5,
                                  }}
                                >
                                  学生作答：{studentAnswer || '（未作答）'}
                                </Typography>
                                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                                  <TextField
                                    label="得分"
                                    size="small"
                                    type="number"
                                    value={scoreDraft[q.questionId] ?? ''}
                                    onChange={(e) =>
                                      setScoreDraft((prev) => ({
                                        ...prev,
                                        [q.questionId]: e.target.value,
                                      }))
                                    }
                                    sx={{ width: 120 }}
                                  />
                                  <Button
                                    size="small"
                                    variant="contained"
                                    startIcon={<SaveIcon />}
                                    disabled={savingQuestionId === q.questionId}
                                    onClick={() => void handleSaveScore(q.questionId)}
                                  >
                                    {savingQuestionId === q.questionId ? '保存中…' : '保存得分'}
                                  </Button>
                                </Stack>
                              </Paper>
                            );
                          })}
                        </Stack>
                      ) : (
                        <Alert severity="info" sx={{ fontSize: 14 }}>
                          请先选择要批改的学生。
                        </Alert>
                      )}
                    </Stack>
                  ) : (
                    <Alert severity="info" sx={{ fontSize: 14 }}>
                      还没有学生提交，暂无可批改的主观题。
                    </Alert>
                  )}
                </Box>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setStatsFor(null)} size="large" sx={{ minHeight: 44 }}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- 关闭作答：二次确认 ---- */}
      <ConfirmDialog
        open={Boolean(closeTarget)}
        title="关闭作答？"
        description="关闭后学生将不能再提交这套测验卷，已提交的记录会保留。"
        confirmText="确认关闭"
        loading={busy}
        onConfirm={() => void handleClose()}
        onCancel={() => setCloseTarget(null)}
      />

      {/* ---- 清空提交：危险操作二次确认 ---- */}
      <ConfirmDialog
        open={Boolean(clearTarget)}
        title="清空提交记录？"
        description="将永久删除这套测验卷的全部学生提交（完成名单、每题统计与主观题得分），此操作不可恢复。"
        confirmText="确认清空"
        danger
        loading={busy}
        onConfirm={() => void handleClear()}
        onCancel={() => setClearTarget(null)}
      />
    </Container>
  );
}

export default ExamPaperManagePage;
