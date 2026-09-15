import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ConfirmationNumberOutlinedIcon from '@mui/icons-material/ConfirmationNumberOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import BlockIcon from '@mui/icons-material/Block';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useToast } from '@/components/common/ToastHost';
import * as adminService from '@/services/adminService';
import { copyText } from '@/utils/clipboard';
import { formatDateTime } from '@/utils/format';
import type { RedemptionCode } from '@/types/models';

/**
 * 管理员「兑换码」面板（精简版）。
 *
 * 师创**永不做在线支付**：老师扫码线下付款 → 站长在「待充值」确认到账 →
 * 站长在这里发一张兑换码给老师（或在「注册用户」直接加积分）。
 * 兑换码是客户回收成本的重要通道，所以这个入口不能没有，但要做得足够简单。
 *
 * 只做三件事：
 *   1. 生成新码（数量 / 面值 / 备注 / 有效期）→ `adminService.createCodes()`；
 *   2. 列出已有码（码 / 面值 / 状态 / 使用人 / 创建时间 / 备注）→ `adminService.listCodes()`；
 *   3. 作废一张未使用的码 → `adminService.disableCode()`。
 *
 * ⚠️ 明文只在生成成功的那一次展示，刷新列表后不再出现（列表里仍是明文，
 * 但新建的码不会另行保存副本）；站长需要复制下来发给老师。
 */

/** 数量可选项（刻意只给到 50，避免一次生成一大坨不好管理）。 */
const COUNT_OPTIONS: readonly number[] = [1, 5, 10, 20, 50];

/** 有效期可选项（天）；0 = 不过期。 */
const VALID_DAY_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: '不过期（默认）' },
  { value: 7, label: '7 天后过期' },
  { value: 30, label: '30 天后过期' },
  { value: 90, label: '90 天后过期' },
  { value: 180, label: '180 天后过期' },
  { value: 365, label: '365 天后过期' },
];

/** 列表筛选：全部 / 未使用 / 已使用 / 已作废。 */
const STATUS_FILTERS: readonly { value: '' | 'unused' | 'used' | 'disabled'; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'unused', label: '未使用' },
  { value: 'used', label: '已使用' },
  { value: 'disabled', label: '已作废' },
];

/** 状态 → 中文。 */
function statusLabel(status: string): string {
  if (status === 'used') return '已使用';
  if (status === 'disabled') return '已作废';
  return '未使用';
}

/** 状态 → 颜色。 */
function statusColor(status: string): 'success' | 'warning' | 'default' {
  if (status === 'unused') return 'success';
  if (status === 'used') return 'default';
  return 'warning';
}

/** UUID 太长，列表里只显示前 8 位。 */
function shortId(id: string | null): string {
  if (!id) return '';
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function CodePanel(): JSX.Element {
  const toast = useToast();

  // ---- 生成新码表单 ----
  const [count, setCount] = useState<number>(1);
  const [credits, setCredits] = useState<number>(50);
  const [memo, setMemo] = useState<string>('');
  const [validDays, setValidDays] = useState<number>(0);
  const [generating, setGenerating] = useState(false);
  /** 刚生成出来的码（明文，只在这一次展示）。 */
  const [freshCodes, setFreshCodes] = useState<string[]>([]);

  // ---- 码列表 ----
  const [items, setItems] = useState<RedemptionCode[]>([]);
  const [statusFilter, setStatusFilter] = useState<'' | 'unused' | 'used' | 'disabled'>('');
  const [listLoading, setListLoading] = useState(true);
  const [disablingCode, setDisablingCode] = useState<string>('');

  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    setListLoading(true);
    setError('');
    try {
      const res = await adminService.listCodes({
        status: statusFilter || undefined,
        limit: 100,
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载兑换码列表失败');
    } finally {
      setListLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  /** 生成出来的码拼成一行一个，方便复制。 */
  const freshText = useMemo(() => freshCodes.join('\n'), [freshCodes]);

  const handleGenerate = useCallback(async () => {
    setError('');
    // ---- 校验：全部给中文提示，非技术人员也能看懂 ----
    if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1 || count > 50) {
      setError('生成数量只能是 1 ~ 50 之间的整数');
      return;
    }
    if (!Number.isFinite(credits) || !Number.isInteger(credits) || credits < 1) {
      setError('面值积分请填一个大于 0 的整数');
      return;
    }
    if (credits > 100000) {
      setError('面值积分太大了，请填 100000 以内');
      return;
    }
    if (memo.trim().length > 50) {
      setError('备注最多 50 个字');
      return;
    }

    setGenerating(true);
    try {
      const list = await adminService.createCodes({
        credits,
        count,
        kind: 'credit',
        validDays,
        memo: memo.trim(),
      });
      setFreshCodes(list);
      toast.success(`已生成 ${list.length} 张兑换码`);
      setMemo('');
      void loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  }, [count, credits, validDays, memo, toast, loadList]);

  const handleCopyFresh = useCallback(async () => {
    const ok = await copyText(freshText);
    toast[ok ? 'success' : 'error'](ok ? '已复制全部兑换码' : '复制失败，请手动选中复制');
  }, [freshText, toast]);

  const handleDisable = useCallback(
    async (code: string) => {
      setDisablingCode(code);
      setError('');
      try {
        await adminService.disableCode(code);
        toast.success(`已作废 ${code}`);
        setFreshCodes((prev) => prev.filter((c) => c !== code));
        void loadList();
      } catch (err) {
        setError(err instanceof Error ? err.message : '作废失败，请重试');
      } finally {
        setDisablingCode('');
      }
    },
    [toast, loadList],
  );

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <ConfirmationNumberOutlinedIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>兑换码</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        老师线下付款、你在「待充值」确认到账后，在这里生成一张兑换码发给老师，老师到个人中心「兑换码充值」输入即可到账。
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}

      {/* ================= 1. 生成新码 ================= */}
      <Box sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'rgba(27,31,39,0.02)' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 700, mb: 1.5 }}>生成新码</Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          <TextField
            select
            label="生成数量"
            value={String(count)}
            onChange={(e) => setCount(Number(e.target.value))}
            helperText="一次最多 50 张"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          >
            {COUNT_OPTIONS.map((c) => (
              <MenuItem key={c} value={c} sx={{ minHeight: 44, fontSize: 15 }}>
                {c} 张
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="面值积分"
            type="number"
            value={credits}
            onChange={(e) => setCredits(Number(e.target.value))}
            inputProps={{ min: 1, step: 1, 'aria-label': '面值积分' }}
            helperText="每张码能兑换多少积分"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />

          <TextField
            label="备注（选填）"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="例如：张三 年卡"
            helperText="只给你自己对账看，老师看不到"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          />

          <TextField
            select
            label="有效期（选填）"
            value={String(validDays)}
            onChange={(e) => setValidDays(Number(e.target.value))}
            helperText="默认不过期"
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
          >
            {VALID_DAY_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value} sx={{ minHeight: 44, fontSize: 15 }}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Button
          variant="contained"
          size="large"
          startIcon={<AddCircleOutlineIcon />}
          onClick={() => void handleGenerate()}
          disabled={generating}
          sx={{ minHeight: 48, mt: 2, fontWeight: 700 }}
        >
          {generating ? '生成中…' : `生成 ${count} 张 ${credits} 积分兑换码`}
        </Button>

        {freshCodes.length > 0 ? (
          <Box sx={{ mt: 2 }}>
            <Divider sx={{ mb: 2 }} />
            <Alert severity="warning" sx={{ mb: 1.5, lineHeight: 1.7 }}>
              请把这些码<b>保存好</b>再关掉页面 —— 刷新后这里不再显示明文，只能看到码的使用状态。
            </Alert>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <Button
                variant="outlined"
                size="large"
                startIcon={<ContentCopyIcon />}
                onClick={() => void handleCopyFresh()}
                sx={{ minHeight: 44, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
              >
                复制全部
              </Button>
            </Stack>
            <Box
              sx={{
                maxHeight: 240,
                overflow: 'auto',
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#fff',
                p: 1.5,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: 15,
                lineHeight: 2,
                letterSpacing: 1,
                wordBreak: 'break-all',
              }}
            >
              {freshCodes.map((c) => (
                <Box key={c} component="div">
                  {c}
                </Box>
              ))}
            </Box>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1 }}>
              共 {freshCodes.length} 张，合计 {freshCodes.length * credits} 积分
            </Typography>
          </Box>
        ) : null}
      </Box>

      {/* ================= 2. 码列表 ================= */}
      <Box sx={{ mt: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>已有兑换码</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              size="small"
              label="筛选"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | 'unused' | 'used' | 'disabled')}
              sx={{ width: 120 }}
            >
              {STATUS_FILTERS.map((f) => (
                <MenuItem key={f.value || 'all'} value={f.value} sx={{ minHeight: 40, fontSize: 14 }}>
                  {f.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              size="small"
              startIcon={<RefreshIcon />}
              onClick={() => void loadList()}
              disabled={listLoading}
              sx={{ minHeight: 40, color: 'text.secondary' }}
            >
              刷新
            </Button>
          </Stack>
        </Stack>

        {listLoading ? (
          <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
        ) : items.length === 0 ? (
          <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>
            还没有兑换码，用上面的表单生成第一张吧。
          </Typography>
        ) : (
          <Box sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            {items.map((item, index) => (
              <Box key={item.code}>
                {index > 0 ? <Divider /> : null}
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'flex-start', sm: 'center' }}
                  sx={{ px: 1.5, py: 1.25 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        fontSize: 14.5,
                        fontWeight: 700,
                        letterSpacing: 0.5,
                        wordBreak: 'break-all',
                      }}
                    >
                      {item.code}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                      {item.credits} 积分
                      {' · '}
                      <Box component="span" sx={{ color: statusColor(item.status) === 'success' ? '#2E7D32' : statusColor(item.status) === 'warning' ? '#ED6C02' : 'text.secondary' }}>
                        {statusLabel(item.status)}
                      </Box>
                      {item.usedBy ? ` · 使用人 ${shortId(item.usedBy)}` : ''}
                      {' · '}
                      {formatDateTime(item.createdAt)}
                      {item.memo ? ` · ${item.memo}` : ''}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    startIcon={<BlockIcon fontSize="small" />}
                    onClick={() => void handleDisable(item.code)}
                    disabled={item.status !== 'unused' || disablingCode === item.code}
                    sx={{ minHeight: 36, color: 'text.secondary', flexShrink: 0 }}
                  >
                    {disablingCode === item.code ? '作废中…' : '作废'}
                  </Button>
                </Stack>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default CodePanel;
