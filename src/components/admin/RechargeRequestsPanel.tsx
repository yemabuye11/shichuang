import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import BlockIcon from '@mui/icons-material/Block';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { useToast } from '@/components/common/ToastHost';
import { EmptyState } from '@/components/common/EmptyState';
import * as rechargeService from '@/services/rechargeService';
import type { RechargeRequest } from '@/services/rechargeService';
import { formatCny, formatDateTime } from '@/utils/format';

/**
 * 管理员「待充值」：列出 pending 的充值请求，老师端提交凭证后在这里一键到账。
 *
 * 确认 / 拒绝走 SECURITY DEFINER RPC `admin_approve_recharge`；
 * approved 时 RPC 会按 plan_id 查 membership_plans.credits 经 apply_credit 加积分。
 */
export function RechargeRequestsPanel(): JSX.Element {
  const toast = useToast();
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [items, setItems] = useState<RechargeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (s: typeof status) => {
    setLoading(true);
    setError('');
    try {
      const list = await rechargeService.listRequests(s);
      setItems(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  const handleApprove = useCallback(async (id: string, ok: boolean) => {
    setBusyId(id);
    try {
      const r = await rechargeService.approveRequest(id, ok);
      if (r.ok) {
        toast.success(r.message || (ok ? '已确认到账' : '已拒绝'));
        // 从当前列表移除（如果是 pending tab）
        setItems((prev) => prev.filter((it) => it.id !== id));
        if (status === 'pending') void load('pending');
      } else {
        toast.error(r.message || '操作失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  }, [toast, status, load]);

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>充值请求</Typography>
        {!loading ? (
          <Chip size="small" label={`${items.length} 条`} sx={{ fontWeight: 700 }} />
        ) : null}
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        老师提交充值凭证后，在这里核对金额与备注，确认到账即自动按套餐积分入账。
      </Typography>

      <Stack direction="row" spacing={0.75} sx={{ mb: 2 }}>
        {(['pending', 'approved', 'rejected', 'all'] as const).map((s) => (
          <Chip
            key={s}
            label={s === 'pending' ? '待处理' : s === 'approved' ? '已到账' : s === 'rejected' ? '已拒绝' : '全部'}
            color={status === s ? 'primary' : 'default'}
            onClick={() => setStatus(s)}
            sx={{ fontWeight: 700, cursor: 'pointer' }}
          />
        ))}
      </Stack>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} action={
          <Box component="button" type="button" onClick={() => void load(status)}
            style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
            重试
          </Box>
        }>{error}</Alert>
      ) : null}

      {loading ? (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={28} />
        </Stack>
      ) : items.length === 0 ? (
        <EmptyState icon="📭" title="暂无相关记录" description={
          status === 'pending' ? '老师还没有提交待核对的充值请求。' :
          status === 'approved' ? '还没有已到账的记录。' :
          status === 'rejected' ? '还没有已拒绝的记录。' : '没有任何充值记录。'
        } />
      ) : (
        <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          {items.map((r, i) => (
            <Box key={r.id}>
              {i > 0 ? <Divider /> : null}
              <Box sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                  <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        icon={r.status === 'pending' ? <HourglassEmptyIcon /> : r.status === 'approved' ? <CheckCircleIcon /> : <BlockIcon />}
                        label={
                          r.status === 'pending' ? '待处理' :
                          r.status === 'approved' ? '已到账' : '已拒绝'
                        }
                        color={r.status === 'pending' ? 'warning' : r.status === 'approved' ? 'success' : 'default'}
                        sx={{ fontWeight: 700 }}
                      />
                      <Typography sx={{ fontSize: 15, fontWeight: 700 }}>
                        {r.nickname || r.userId} · {r.planName || r.planId || '套餐'}
                      </Typography>
                    </Stack>
                    <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
                      金额 <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{formatCny(r.amountCny)}</Box>
                      {' · '}
                      {r.payMethod === 'wechat' ? '微信' : '支付宝'}
                      {' · '}
                      {r.proofText || '（未填备注）'}
                    </Typography>
                    {r.proofImageUrl ? (
                      <Box
                        component="a"
                        href={r.proofImageUrl}
                        target="_blank"
                        rel="noreferrer"
                        sx={{ fontSize: 12.5, color: 'primary.main', textDecoration: 'none', wordBreak: 'break-all' }}
                      >
                        查看凭证截图 →
                      </Box>
                    ) : null}
                    <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.25 }}>
                      提交：{formatDateTime(r.createdAt)}
                      {r.handledAt ? ` · 处理：${formatDateTime(r.handledAt)}` : ''}
                    </Typography>
                  </Stack>

                  {r.status === 'pending' ? (
                    <Stack direction={{ xs: 'row', sm: 'row' }} spacing={1} sx={{ flexShrink: 0 }}>
                      <Button
                        variant="contained"
                        color="success"
                        size="large"
                        startIcon={<CheckCircleIcon />}
                        disabled={busyId === r.id}
                        onClick={() => void handleApprove(r.id, true)}
                        sx={{ minHeight: 46, fontWeight: 700 }}
                      >
                        {busyId === r.id ? '处理中…' : '确认到账'}
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="large"
                        startIcon={<BlockIcon />}
                        disabled={busyId === r.id}
                        onClick={() => void handleApprove(r.id, false)}
                        sx={{ minHeight: 46 }}
                      >
                        拒绝
                      </Button>
                    </Stack>
                  ) : null}
                </Stack>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default RechargeRequestsPanel;