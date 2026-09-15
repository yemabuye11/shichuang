import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { useToast } from '@/components/common/ToastHost';
import { DEFAULT_PAYMENT_QR, getPaymentQrConfig, savePaymentQrConfig } from '@/services/paymentQrService';
import type { PaymentQrConfig } from '@/services/paymentQrService';

/**
 * 管理员「收款码配置」面板。
 *
 * 读写 system_config.payment_qr（jsonb）：
 * - 读：getPaymentQrConfig() → rpc get_system_config('payment_qr')；
 * - 写：savePaymentQrConfig() → rpc admin_set_system_config('payment_qr', jsonb)。
 *
 * ⚠️ **只展示图片，不接支付。** 老师扫这张码线下转账后，
 * 由管理员在「待充值」Tab 手工确认加积分，系统不会自动到账。
 */
export function PaymentQrPanel(): JSX.Element {
  const toast = useToast();

  const [imageUrl, setImageUrl] = useState<string>('');
  const [title, setTitle] = useState<string>(DEFAULT_PAYMENT_QR.title);
  const [notice, setNotice] = useState<string>(DEFAULT_PAYMENT_QR.notice);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** 预览图加载失败（链接失效 / 防盗链）时置 true，避免后台出现破图。 */
  const [previewBroken, setPreviewBroken] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const cfg = await getPaymentQrConfig();
      setImageUrl(cfg.imageUrl);
      setTitle(cfg.title || DEFAULT_PAYMENT_QR.title);
      setNotice(cfg.notice || DEFAULT_PAYMENT_QR.notice);
      setPreviewBroken(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载收款码配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      const cfg: PaymentQrConfig = {
        imageUrl: imageUrl.trim(),
        title: title.trim(),
        notice: notice.trim(),
      };
      await savePaymentQrConfig(cfg);
      setPreviewBroken(false);
      toast.success('收款码配置已保存');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [imageUrl, title, notice, toast]);

  const trimmedUrl = imageUrl.trim();

  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 0.5 }}>
        <QrCode2Icon color="primary" sx={{ fontSize: 22 }} aria-hidden="true" />
        <Typography sx={{ fontSize: 17, fontWeight: 700 }}>收款码配置</Typography>
      </Stack>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        填一张收款码图片的 https 链接，老师端「自助充值」页就会展示这张图。
        老师扫码转账后，你到「待充值」Tab 手工确认加积分。
      </Typography>

      <Alert severity="warning" sx={{ mb: 2, lineHeight: 1.7 }}>
        这里<b>只是展示一张图片</b>，系统不会自动收款、也不会自动加积分。
        配置步骤见 <b>docs/WECHAT_QR_SETUP.md</b>。
      </Alert>

      {error ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Box
              component="button"
              type="button"
              onClick={() => void load()}
              style={{ border: 0, background: 'transparent', color: 'inherit', fontWeight: 700, cursor: 'pointer' }}
            >
              重试
            </Box>
          }
        >
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
      ) : (
        <Stack spacing={2}>
          <TextField
            label="收款码图片链接"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            fullWidth
            placeholder="https://..."
            helperText="必须是 https:// 开头的图片地址；留空表示暂时不展示收款码"
            error={trimmedUrl.length > 0 && !/^https:\/\//i.test(trimmedUrl)}
          />
          <TextField
            label="标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            placeholder="扫码充值"
            helperText="最多 30 个字，展示在图片上方"
          />
          <TextField
            label="提示语"
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            fullWidth
            multiline
            minRows={2}
            placeholder="转账后请联系管理员加积分"
            helperText="最多 200 个字，展示在图片下方"
          />

          <Box sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'rgba(27,31,39,0.02)' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 1 }}>预览（老师端看到的样子）</Typography>
            {trimmedUrl.length === 0 ? (
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                还没有填图片链接，老师端不会显示收款码区块。
              </Typography>
            ) : previewBroken ? (
              <Alert severity="warning">这张图片加载不出来，请检查链接是不是 https、有没有防盗链。</Alert>
            ) : (
              <Box sx={{ textAlign: 'center' }}>
                <Box
                  component="img"
                  key={trimmedUrl}
                  src={trimmedUrl}
                  alt="收款码预览"
                  onError={() => setPreviewBroken(true)}
                  sx={{
                    width: 160,
                    height: 160,
                    objectFit: 'contain',
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: '#fff',
                  }}
                />
                <Typography sx={{ fontSize: 14, fontWeight: 700, mt: 1 }}>
                  {title.trim() || DEFAULT_PAYMENT_QR.title}
                </Typography>
                {notice.trim() ? (
                  <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                    {notice.trim()}
                  </Typography>
                ) : null}
              </Box>
            )}
          </Box>

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={() => void load()} disabled={saving} sx={{ minHeight: 44 }}>
              取消
            </Button>
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

export default PaymentQrPanel;
