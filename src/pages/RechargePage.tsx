import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import { useToast } from '@/components/common/ToastHost';
import { InlineLoading } from '@/components/common/LoadingOverlay';
import { EmptyState } from '@/components/common/EmptyState';
import { SystemNoticeBanner } from '@/components/common/SystemNoticeBanner';
import * as rechargeService from '@/services/rechargeService';
import * as noticeService from '@/services/noticeService';
import type { PaymentConfig, RechargeRequest } from '@/services/rechargeService';
import type { SystemNotice } from '@/services/noticeService';
import type { MembershipPlan } from '@/types/models';
import { formatCny } from '@/utils/format';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';

/**
 * 老师端自助充值页（野马个人收款码）。
 *
 * 流程：
 *   1) 顶部引导文案（来自 system_config.payment.tip）；
 *   2) 套餐卡片列表（点击「充值」带入表单）；
 *   3) 收款码区：微信 + 支付宝（缺图提示"管理员尚未配置"）；
 *   4) 「我已付款」表单：选套餐 / 付款方式 / 备注 / 凭证图链接 → submitRequest。
 *
 * 资金路径：提交后野马在 AdminPage「待充值」Tab 确认 → admin_approve_recharge 加积分。
 */
export function RechargePage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();

  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [notice, setNotice] = useState<SystemNotice | null>(null);
  const [recentRequests, setRecentRequests] = useState<RechargeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null);
  const [payMethod, setPayMethod] = useState<'wechat' | 'alipay'>('wechat');
  const [proofText, setProofText] = useState('');
  const [proofImageUrl, setProofImageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [c, p, mine, n] = await Promise.all([
        rechargeService.getPaymentConfig(),
        rechargeService.listPlans(),
        rechargeService.listMyRequests().catch(() => [] as RechargeRequest[]),
        noticeService.getSystemNotice().catch(() => null),
      ]);
      setCfg(c);
      setPlans(p);
      setRecentRequests(mine);
      setNotice(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSubmit = useCallback(async () => {
    if (!selectedPlan) {
      toast.error('请先选择一个套餐');
      return;
    }
    setSubmitting(true);
    try {
      await rechargeService.submitRequest({
        planId: selectedPlan.id,
        amountCny: selectedPlan.priceCny,
        payMethod,
        proofText,
        proofImageUrl: proofImageUrl.trim() || null,
      });
      toast.success('已提交，等待管理员确认到账');
      setSelectedPlan(null);
      setProofText('');
      setProofImageUrl('');
      void loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }, [selectedPlan, payMethod, proofText, proofImageUrl, toast, loadAll]);

  if (loading && !cfg) {
    return <InlineLoading message="正在加载收款配置…" />;
  }

  if (error && !cfg) {
    return (
      <Box sx={{ py: 4, maxWidth: 720, mx: 'auto' }}>
        <Alert severity="error" action={
          <Box
            component="button"
            type="button"
            onClick={() => void loadAll()}
            style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}
          >
            重试
          </Box>
        }>{error}</Alert>
      </Box>
    );
  }

  const tip = cfg?.tip || '选套餐 → 扫下方码付款（备注你的账号名）→ 付款后点"我已付款"提交凭证 → 管理员核对后积分到账';
  const hasQr = !!(cfg?.wechatQrUrl || cfg?.alipayQrUrl);
  const payablePlans = plans.filter((p) => p.priceCny > 0);

  return (
    <Box sx={{ py: { xs: 2, sm: 3 }, maxWidth: 820, mx: 'auto' }}>
      <SystemNoticeBanner />

      {/* ---- 顶部引导 ---- */}
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <PaidOutlinedIcon color="primary" sx={{ fontSize: 30 }} aria-hidden="true" />
        <Box>
          <Typography sx={{ fontSize: { xs: 21, sm: 24 }, fontWeight: 800 }}>自助充值</Typography>
          <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.25 }}>
            选套餐 → 扫码付款 → 提交凭证 → 管理员核对 → 积分到账
          </Typography>
        </Box>
      </Stack>

      <Alert severity="info" sx={{ mt: 2.5, lineHeight: 1.7 }}>
        {tip}
      </Alert>

      {/* ---- 套餐卡片 ---- */}
      <Box sx={{ mt: 3 }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 1.5 }}>选择套餐</Typography>
        {payablePlans.length === 0 ? (
          <EmptyState icon="🪙" title="暂无可购买的套餐" description="请联系学校管理员配置套餐档位。" />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
            {payablePlans.map((p) => {
              const selected = selectedPlan?.id === p.id;
              return (
                <Box
                  key={p.id}
                  onClick={() => setSelectedPlan(p)}
                  sx={{
                    borderRadius: 2.5,
                    border: '2px solid',
                    borderColor: selected ? 'primary.main' : 'divider',
                    bgcolor: selected ? 'rgba(47,107,255,0.04)' : '#fff',
                    p: 2,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    '&:hover': { borderColor: selected ? 'primary.main' : 'primary.light' },
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{p.name}</Typography>
                    <Chip
                      size="small"
                      label={`${p.credits} 积分`}
                      color="primary"
                      sx={{ fontWeight: 700 }}
                    />
                  </Stack>
                  <Typography sx={{ fontSize: 22, fontWeight: 800, mt: 1, color: 'primary.main' }}>
                    {formatCny(p.priceCny)}
                  </Typography>
                  {p.description ? (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5, lineHeight: 1.6 }}>
                      {p.description}
                    </Typography>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* ---- 收款码 ---- */}
      <Box sx={{ mt: 3, p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <QrCode2Icon color="primary" />
          <Typography sx={{ fontSize: 16, fontWeight: 700 }}>扫码付款</Typography>
          <Chip size="small" label="付款备注你的账号名" sx={{ fontWeight: 600 }} />
        </Stack>

        {!hasQr ? (
          <Alert severity="warning">管理员尚未配置收款码，请联系管理员。</Alert>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {cfg?.wechatQrUrl ? (
              <QrCard label="微信支付" url={cfg.wechatQrUrl} />
            ) : null}
            {cfg?.alipayQrUrl ? (
              <QrCard label="支付宝" url={cfg.alipayQrUrl} />
            ) : null}
          </Box>
        )}
      </Box>

      {/* ---- 加管理员微信确认 ---- */}
      <WechatConfirmBlock notice={notice} onToast={(msg) => toast.success(msg)} />

      {/* ---- 我已付款 表单 ---- */}
      <Box sx={{ mt: 3, p: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
        <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 0.5 }}>我已付款</Typography>
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
          付款完成后提交凭证，管理员核对后积分到账（通常几分钟内）。
        </Typography>

        <Stack spacing={2}>
          <Box>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, mb: 0.75, color: 'text.secondary' }}>
              付款方式
            </Typography>
            <ToggleButtonGroup
              value={payMethod}
              exclusive
              onChange={(_, v) => { if (v) setPayMethod(v as 'wechat' | 'alipay'); }}
              fullWidth
            >
              <ToggleButton value="wechat">微信支付</ToggleButton>
              <ToggleButton value="alipay">支付宝</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          <TextField
            label="备注（你的账号名 / 真实姓名）"
            value={proofText}
            onChange={(e) => setProofText(e.target.value)}
            fullWidth
            placeholder="例如：张老师"
          />

          <TextField
            label="凭证截图链接（可选）"
            value={proofImageUrl}
            onChange={(e) => setProofImageUrl(e.target.value)}
            fullWidth
            placeholder="https://..."
            helperText="把截图传到任意图床，把图片链接粘贴到这里"
          />

          {selectedPlan ? (
            <Alert severity="success" sx={{ py: 0.75 }}>
              已选 <b>{selectedPlan.name}</b>，付款金额 <b>{formatCny(selectedPlan.priceCny)}</b>，到账 <b>{selectedPlan.credits}</b> 积分。
            </Alert>
          ) : (
            <Alert severity="warning" sx={{ py: 0.75 }}>请先在上方选择一个套餐</Alert>
          )}

          <Button
            variant="contained"
            size="large"
            disabled={!selectedPlan || submitting}
            onClick={() => void handleSubmit()}
            sx={{ minHeight: 50, fontWeight: 700 }}
          >
            {submitting ? <CircularProgress size={22} sx={{ color: 'inherit' }} /> : '提交充值凭证'}
          </Button>
        </Stack>
      </Box>

      {/* ---- 历史充值记录 ---- */}
      {recentRequests.length > 0 ? (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, mb: 1.5 }}>我的充值记录</Typography>
          <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
            {recentRequests.map((r, i) => (
              <Box key={r.id}>
                {i > 0 ? <Divider /> : null}
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.5 }}>
                  <Chip
                    size="small"
                    label={r.status === 'pending' ? '待确认' : r.status === 'approved' ? '已到账' : '已拒绝'}
                    color={r.status === 'pending' ? 'warning' : r.status === 'approved' ? 'success' : 'default'}
                    sx={{ fontWeight: 700, minWidth: 64 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14.5, fontWeight: 600 }}>
                      {r.planName || r.planId || '套餐'} · {formatCny(r.amountCny)} · {r.payMethod === 'wechat' ? '微信' : '支付宝'}
                    </Typography>
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                      {new Date(r.createdAt).toLocaleString('zh-CN')}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}

      <Button
        variant="text"
        onClick={() => navigate(-1)}
        sx={{ mt: 3, minHeight: 44, color: 'text.secondary' }}
      >
        返回
      </Button>
    </Box>
  );
}

function QrCard({ label, url }: { label: string; url: string }): JSX.Element {
  return (
    <Box sx={{ textAlign: 'center', p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
      <Box
        component="img"
        src={url}
        alt={`${label}收款码`}
        sx={{ width: '100%', maxWidth: 220, aspectRatio: '1 / 1', objectFit: 'contain', borderRadius: 1.5 }}
      />
      <Typography sx={{ fontSize: 14, fontWeight: 700, mt: 1 }}>{label}</Typography>
    </Box>
  );
}

/**
 * 「加管理员微信确认」区块：来自 system_config.system_notice.wechat_id，
 * 老师付完款后顺手加一下管理员发截图，能让管理员更快核对到账。
 */
function WechatConfirmBlock({
  notice,
  onToast,
}: {
  notice: SystemNotice | null;
  onToast: (msg: string) => void;
}): JSX.Element | null {
  if (!notice?.wechat_id) return null;

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(notice.wechat_id);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = notice.wechat_id;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    onToast('已复制微信号');
  };

  return (
    <Box
      sx={{
        mt: 3,
        p: { xs: 2, sm: 2.5 },
        borderRadius: 3,
        bgcolor: 'rgba(7,193,96,0.06)',
        border: '1px solid rgba(7,193,96,0.24)',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
        <ChatBubbleOutlineIcon sx={{ color: '#07c160', fontSize: 20 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 15.5, fontWeight: 800, color: '#07a050' }}>
          付款后请加管理员微信发截图
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.7, mb: 1.5 }}>
        付款后请加管理员微信发送付款截图，管理员核对后立即到账；不发送截图可能影响核对速度。
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: 'wrap' }}>
        <Chip
          label={notice.wechat_id}
          sx={{
            fontWeight: 700,
            bgcolor: '#07c160',
            color: '#fff',
            fontSize: 14,
            height: 32,
            '& .MuiChip-label': { px: 1.5 },
          }}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={() => void handleCopy()}
          sx={{ minHeight: 36, fontWeight: 600, color: '#07a050', borderColor: 'rgba(7,193,96,0.4)' }}
        >
          复制微信号
        </Button>
      </Stack>
    </Box>
  );
}

export default RechargePage;