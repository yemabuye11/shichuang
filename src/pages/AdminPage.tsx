import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Stack, Typography } from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { StatsPanel } from '@/components/admin/StatsPanel';
import { CodeBatchForm } from '@/components/admin/CodeBatchForm';
import { ReportList } from '@/components/admin/ReportList';
import { useToast } from '@/components/common/ToastHost';
import { isMockMode } from '@/config/env';
import * as adminService from '@/services/adminService';
import type { AdminStats, MembershipPlan, ReportItem } from '@/types/models';

/**
 * 管理员后台（Q10 极简三功能）：
 * 1. 批量生成兑换码并导出；
 * 2. 数据看板（用户数 / 应用数 / 今日生成 / 本月支出 / 各类型平均单次成本）；
 * 3. 举报处理与下架。
 *
 * 入口受 `RequireAuth requireAdmin` 保护，非管理员看不到。
 */
export function AdminPage(): JSX.Element {
  const toast = useToast();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, p, r] = await Promise.all([
        adminService.stats().catch(() => null),
        adminService.listPlans().catch(() => [] as MembershipPlan[]),
        adminService.listReports('pending').catch(() => [] as ReportItem[]),
      ]);
      setStats(s);
      setPlans(p);
      setReports(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载后台数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleReport = useCallback(
    async (id: string, action: 'handled' | 'dismissed') => {
      try {
        await adminService.handleReport(Number(id), action);
        setReports((prev) =>
          prev.map((r) =>
            r.id === id
              ? { ...r, status: action, handledAt: new Date().toISOString() }
              : r,
          ),
        );
        toast.success(action === 'handled' ? '已标记为已处理' : '已忽略该举报');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '操作失败，请重试');
      }
    },
    [toast],
  );

  const handleTakedown = useCallback(
    async (appId: string) => {
      try {
        await adminService.takedown(appId, '违反平台规范，管理员下架');
        toast.success('已下架该应用');
        setReports((prev) => prev.filter((r) => r.appId !== appId));
        void loadAll();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '下架失败，请重试');
      }
    },
    [toast, loadAll],
  );

  return (
    <Box sx={{ py: { xs: 2, sm: 3 }, maxWidth: 860, mx: 'auto' }}>
      <Stack direction="row" spacing={1.25} alignItems="center">
        <AdminPanelSettingsIcon color="primary" sx={{ fontSize: 30 }} aria-hidden="true" />
        <Box>
          <Typography sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 800 }}>管理员后台</Typography>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>
            发兑换码 · 看数据 · 处理举报
          </Typography>
        </Box>
      </Stack>

      {isMockMode() ? (
        <Alert severity="info" sx={{ mt: 2.5 }}>
          演示模式：这里的兑换码、看板数据与举报都保存在本机浏览器里，
          连接真实服务后会改为读写云端数据库。
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mt: 2.5 }} action={
          <Box
            component="button"
            type="button"
            onClick={() => void loadAll()}
            style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer', minHeight: 36 }}
          >
            重试
          </Box>
        }>
          {error}
        </Alert>
      ) : null}

      <Stack spacing={3} sx={{ mt: 3 }}>
        <StatsPanel stats={stats} loading={loading} />
        <CodeBatchForm plans={plans.map((p) => ({ id: p.id, name: p.name, credits: p.credits }))} />
        <ReportList
          items={reports}
          loading={loading}
          onHandle={(id) => void handleReport(id, 'handled')}
          onDismiss={(id) => void handleReport(id, 'dismissed')}
          onTakedown={(appId) => void handleTakedown(appId)}
        />
      </Stack>
    </Box>
  );
}

export default AdminPage;
