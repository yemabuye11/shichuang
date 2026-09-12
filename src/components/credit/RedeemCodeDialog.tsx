import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RedeemIcon from '@mui/icons-material/Redeem';
import * as creditService from '@/services/creditService';

/**
 * 兑换码充值弹窗（P0-F5）。
 *
 * 只有「卡密 / 兑换码」一种充值方式：零支付资质、零费率、零合规成本。
 */
export interface RedeemCodeDialogProps {
  open: boolean;
  onClose: () => void;
  /** 充值成功回调（页面据此刷新余额与明细）。 */
  onSuccess: (balance: number, credits: number) => void;
}

export function RedeemCodeDialog({ open, onClose, onSuccess }: RedeemCodeDialogProps): JSX.Element {
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [ok, setOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleClose = (): void => {
    setCode('');
    setMessage('');
    setOk(false);
    setSubmitting(false);
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!code.trim()) {
      setOk(false);
      setMessage('请输入兑换码');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const result = await creditService.redeem(code);
      setOk(result.ok);
      setMessage(result.message || (result.ok ? '充值成功' : '兑换失败，请检查兑换码'));
      if (result.ok) {
        onSuccess(result.balance, result.credits);
        setCode('');
      }
    } catch (err) {
      setOk(false);
      setMessage(err instanceof Error ? err.message : '兑换失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <RedeemIcon color="primary" />
        兑换码充值
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          <Typography sx={{ fontSize: 14.5, color: 'text.secondary', lineHeight: 1.7 }}>
            输入管理员发放的兑换码，积分立即到账。兑换码不区分大小写。
          </Typography>

          <TextField
            autoFocus
            fullWidth
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="例如 SC50"
            inputProps={{ 'aria-label': '兑换码', maxLength: 24, autoCapitalize: 'characters' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSubmit();
            }}
            sx={{
              '& .MuiOutlinedInput-root': { fontSize: 18, letterSpacing: 1, minHeight: 52 },
              '& input': { textTransform: 'uppercase' },
            }}
          />

          {message ? <Alert severity={ok ? 'success' : 'error'}>{message}</Alert> : null}

          <Box sx={{ borderRadius: 2, bgcolor: 'rgba(27,31,39,0.03)', p: 1.5 }}>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.7 }}>
              没有兑换码？找学校管理员领取。演示环境下可以试试：
              <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>
                {' '}
                SC50 / SC200 / SC500
              </Box>
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={handleClose} size="large" sx={{ minHeight: 44 }}>
          关闭
        </Button>
        <Button
          onClick={() => void handleSubmit()}
          variant="contained"
          size="large"
          disabled={submitting}
        >
          {submitting ? '兑换中…' : '立即兑换'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default RedeemCodeDialog;
