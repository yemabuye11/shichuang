import { useEffect, useState } from 'react';
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
  IconButton,
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
import { EmptyState } from '@/components/common/EmptyState';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useToast } from '@/components/common/ToastHost';
import {
  listMyPractices,
  getPracticeStats,
  closePractice,
  clearSubmissions,
} from '@/services/practiceService';
import { exportPracticeRecords } from '@/utils/csv';
import { copyText } from '@/utils/clipboard';
import type { PracticeSet, PracticeStats } from '@/types/practice';
import { AppError } from '@/services/http/errors';
import { formatRelativeTime, formatDateTime, formatPercent } from '@/utils/format';

/**
 * 教师「每日一练」管理 / 看板页。
 *
 * 能力（见 docs/PLAN_每日一练.md 第四节 / 第八节）：
 * - 挂载即拉取「我的练习」列表（listMyPractices）；
 * - 每张练习卡：分享链接复制、查看统计（完成名单 + 每题正确率）、导出 CSV、关闭作答、清空提交；
 * - 顶部「刷新」重新拉取；空列表给友好提示；
 * - 假设已登录（接线层包 RequireAuth）；未登录时列表为空，不报错。
 *
 * 红线：不引入任何新依赖；用到的 MUI / React 符号全部在本文件 import。
 */

/** 练习状态 → 展示文案 + Chip 配色。 */
const STATUS_META: Record<
  PracticeSet['status'],
  { label: string; color: 'default' | 'success' | 'warning' }
> = {
  draft: { label: '草稿', color: 'warning' },
  published: { label: '已发布', color: 'success' },
  closed: { label: '已关闭', color: 'default' },
};

/** 练习来源 → 展示文案 + 小图标。 */
const SOURCE_META: Record<PracticeSet['source'], { label: string; icon: JSX.Element }> = {
  ai: { label: 'AI 生成', icon: <AutoAwesomeIcon sx={{ fontSize: 16 }} /> },
  upload: { label: '老师上传', icon: <UploadFileIcon sx={{ fontSize: 16 }} /> },
};

export function PracticeManagePage(): JSX.Element {
  const toast = useToast();

  const [practices, setPractices] = useState<PracticeSet[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);

  // 统计弹层状态
  const [statsFor, setStatsFor] = useState<PracticeSet | null>(null);
  const [stats, setStats] = useState<PracticeStats | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(false);

  // 二次确认目标（关闭作答 / 清空提交）
  const [closeTarget, setCloseTarget] = useState<PracticeSet | null>(null);
  const [clearTarget, setClearTarget] = useState<PracticeSet | null>(null);

  /** 拉取「我的练习」列表。未登录（UNAUTHORIZED）时静默清空，不报错。 */
  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await listMyPractices();
      setPractices(list);
    } catch (err) {
      if (err instanceof AppError && err.code === 'UNAUTHORIZED') {
        setPractices([]);
        return;
      }
      toast.error(err instanceof Error ? err.message : '读取练习失败，请重试');
      setPractices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // 仅挂载时拉一次；刷新由顶部按钮显式触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 复制完整分享链接（内部走 navigator.clipboard，旧浏览器降级 execCommand）。 */
  const handleCopyLink = async (shareSlug: string): Promise<void> => {
    const url = `${window.location.origin}/p/${shareSlug}`;
    const ok = await copyText(url);
    toast[ok ? 'success' : 'error'](ok ? '分享链接已复制' : '复制失败，请手动复制');
  };

  /** 打开统计弹层并拉取完成情况与每题正确率。 */
  const handleOpenStats = async (practice: PracticeSet): Promise<void> => {
    setStatsFor(practice);
    setStats(null);
    setStatsLoading(true);
    try {
      const data = await getPracticeStats(practice.id);
      setStats(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取统计失败，请重试');
    } finally {
      setStatsLoading(false);
    }
  };

  /** 导出完成记录 CSV（完成名单 + 每题正确率，带 BOM）。 */
  const handleExport = async (practice: PracticeSet): Promise<void> => {
    setBusy(true);
    try {
      await exportPracticeRecords(practice.id, { title: practice.title });
      toast.success('已导出完成记录（CSV）');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  /** 确认关闭作答：停止学生继续提交，已提交记录保留。 */
  const handleClose = async (): Promise<void> => {
    if (!closeTarget) return;
    const id = closeTarget.id;
    setBusy(true);
    try {
      await closePractice(id);
      toast.success('已关闭作答，学生将无法再提交');
      setCloseTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '关闭失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  /** 确认清空提交：永久删除该练习全部学生提交（数据最小化）。 */
  const handleClear = async (): Promise<void> => {
    if (!clearTarget) return;
    const target = clearTarget;
    setBusy(true);
    try {
      await clearSubmissions(target.id);
      toast.success('已清空该练习的全部提交记录');
      setClearTarget(null);
      // 若统计弹层正开着同一套练习，刷新为清空后状态
      if (statsFor?.id === target.id) {
        void handleOpenStats(target);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
      {/* ---- 顶部标题 + 刷新 ---- */}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 800 }}>每日一练</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
            我的练习 · 完成统计 · 导出记录
          </Typography>
        </Box>
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
      </Stack>

      {/* ---- 三态：加载中 / 空 / 列表 ---- */}
      {loading ? (
        <InlineLoading message="正在加载我的练习…" />
      ) : practices.length === 0 ? (
        <EmptyState
          icon="📝"
          title="还没有练习"
          description="还没有练习，去「创建每日一练」生成第一个吧。"
        />
      ) : (
        <Stack spacing={2}>
          {practices.map((p) => {
            const status = STATUS_META[p.status];
            const source = SOURCE_META[p.source];
            const isClosed = p.status === 'closed';
            return (
              <Card key={p.id} variant="outlined" sx={{ borderRadius: 3, boxShadow: 'none' }}>
                <CardContent sx={{ p: { xs: 2, sm: 2.5 } }}>
                  {/* 标题 + 状态 */}
                  <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                    <Typography
                      sx={{
                        fontSize: 17,
                        fontWeight: 700,
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
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

                  {/* 学科 / 年级 / 章节 / 来源 */}
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                    <Chip
                      icon={source.icon}
                      label={source.label}
                      size="small"
                      variant="outlined"
                      sx={{ fontWeight: 600, bgcolor: 'action.hover' }}
                    />
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      {p.subject} · {p.grade} · {p.chapter || '未设置章节'}
                    </Typography>
                  </Stack>

                  {/* 天数 / 题数 / 创建时间 */}
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.5 }}>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{p.dayCount} 天</Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{p.questionCount} 题</Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      创建于 {formatRelativeTime(p.createdAt)}
                    </Typography>
                  </Stack>

                  <Divider sx={{ my: 1.5 }} />

                  {/* 分享链接（只读）+ 复制 */}
                  <Stack direction="row" spacing={1} alignItems="center">
                    <LinkIcon sx={{ color: 'text.secondary', fontSize: 20, flexShrink: 0 }} />
                    <TextField
                      value={`/p/${p.shareSlug}`}
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

                  {/* 操作按钮 */}
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

      {/* ---- 统计弹层：完成名单 + 每题正确率（两张 Table） ---- */}
      <Dialog
        open={Boolean(statsFor)}
        onClose={() => setStatsFor(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
          {statsFor?.title} · 完成情况
        </DialogTitle>
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
                          <TableCell sx={{ fontWeight: 700 }}>第几天</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>得分</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>提交时间</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stats.submissions.map((s, idx) => (
                          <TableRow key={`${s.studentName}-${s.dayNo}-${idx}`}>
                            <TableCell>{s.studentName || '匿名'}</TableCell>
                            <TableCell>第 {s.dayNo} 天</TableCell>
                            <TableCell>
                              {s.score} / {s.total}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(s.submittedAt)}</TableCell>
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

              {/* 表 2：每题正确率 */}
              <Box>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1 }}>每题正确率</Typography>
                {stats && stats.perQuestion.length > 0 ? (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>第几天</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>第几题</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>题干</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>正确率</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {stats.perQuestion.map((q, idx) => (
                          <TableRow key={`${q.dayNo}-${q.seq}-${idx}`}>
                            <TableCell>第 {q.dayNo} 天</TableCell>
                            <TableCell>第 {q.seq} 题</TableCell>
                            <TableCell sx={{ maxWidth: 280 }}>{q.stem}</TableCell>
                            <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {formatPercent(q.correctRate)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <Alert severity="info" sx={{ fontSize: 14 }}>
                    暂无正确率数据。
                  </Alert>
                )}
              </Box>
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
        description="关闭后学生将不能再提交这一套练习，已提交的完成记录会保留。关闭后若要重新开放，请重新发布。"
        confirmText="确认关闭"
        loading={busy}
        onConfirm={() => void handleClose()}
        onCancel={() => setCloseTarget(null)}
      />

      {/* ---- 清空提交：危险操作二次确认 ---- */}
      <ConfirmDialog
        open={Boolean(clearTarget)}
        title="清空提交记录？"
        description="将永久删除该练习的全部学生提交（完成名单与每题正确率），此操作不可恢复。仅用于数据最小化或重新收集。"
        confirmText="确认清空"
        danger
        loading={busy}
        onConfirm={() => void handleClear()}
        onCancel={() => setClearTarget(null)}
      />
    </Container>
  );
}

export default PracticeManagePage;
