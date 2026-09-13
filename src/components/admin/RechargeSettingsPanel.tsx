import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import { useToast } from '@/components/common/ToastHost';
import * as rechargeService from '@/services/rechargeService';
import type { PaymentConfig } from '@/services/rechargeService';

/**
 * 管理员「收款设置」：野马的个人微信 / 支付宝收款码链接 + 引导文案。
 *
 * 写入走 SECURITY DEFINER RPC `admin_set_system_config('payment', jsonb)`；
 * 老师端读取走 `get_system_config('payment')`。
 */
export function RechargeSettingsPanel(): JSX.Element {
  const toast = useToast();
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [wechat, setWechat] = useState('');
  const [alipay, setAlipay] = useState('');
  const [tip, setTip] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const c = await rechargeService.getPaymentConfig();
      setCfg(c);
      setWechat(c.wechatQrUrl);
      setAlipay(c.alipayQrUrl);
      setTip(c.tip);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await rechargeService.savePaymentConfig({
        wechatQrUrl: wechat.trim(),
        alipayQrUrl: alipay.trim(),
        tip: tip.trim() || (cfg?.tip ?? ''),
      });
      toast.success('收款设置已保存');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [wechat, alipay, tip, cfg, toast]);

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <SettingsIcon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>收款设置</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        配置你的个人微信 / 支付宝收款码图片链接（建议上传到图床后粘贴 URL），老师扫码付款并提交凭证后，你将在「待充值」Tab 一键到账。
      </Typography>

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} action={
          <Box component="button" type="button" onClick={() => void load()}
            style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}>
            重试
          </Box>
        }>{error}</Alert>
      ) : null}

      {loading ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
      ) : (
        <Stack spacing={2}>
          <TextField
            label="微信收款码图片链接"
            value={wechat}
            onChange={(e) => setWechat(e.target.value)}
            fullWidth
            placeholder="https://..."
          />
          <TextField
            label="支付宝收款码图片链接"
            value={alipay}
            onChange={(e) => setAlipay(e.target.value)}
            fullWidth
            placeholder="https://..."
          />
          <TextField
            label="引导文案（展示在老师端顶部）"
            value={tip}
            onChange={(e) => setTip(e.target.value)}
            fullWidth
            multiline
            minRows={3}
            placeholder="选套餐 → 扫下方码付款（备注你的账号名）→ …"
          />

          {(wechat || alipay) ? (
            <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'rgba(27,31,39,0.02)' }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>预览</Typography>
              <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
                {wechat ? <PreviewQr label="微信支付" url={wechat} /> : null}
                {alipay ? <PreviewQr label="支付宝" url={alipay} /> : null}
              </Stack>
            </Box>
          ) : null}

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => void load()} disabled={saving} sx={{ minHeight: 44 }}>取消</Button>
            <Button
              variant="contained"
              onClick={() => void handleSave()}
              disabled={saving}
              sx={{ minHeight: 44, fontWeight: 700 }}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}

function PreviewQr({ label, url }: { label: string; url: string }): JSX.Element {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Box
        component="img"
        src={url}
        alt={`${label}预览`}
        sx={{ width: 100, height: 100, objectFit: 'contain', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
      />
      <Typography sx={{ fontSize: 12, mt: 0.5 }}>{label}</Typography>
    </Box>
  );
}

export default RechargeSettingsPanel;