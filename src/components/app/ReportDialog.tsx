import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { REPORT_REASONS } from '@/services/squareService';

/**
 * 举报弹窗（P0-D6，匿名可用）。
 */
export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  /** 提交举报。 */
  onSubmit: (reason: string, detail: string) => Promise<void>;
}

export function ReportDialog({ open, onClose, onSubmit }: ReportDialogProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleClose = (): void => {
    setReason('');
    setDetail('');
    setError('');
    setSubmitting(false);
    onClose();
  };

  const handleSubmit = async (): Promise<void> => {
    if (!reason) {
      setError('请选择一个举报原因');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit(reason, detail);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>举报这个应用</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ fontSize: 14.5, mb: 1.5 }}>
          请选择最符合的原因，管理员会尽快处理。我们不会向作者公开你的身份。
        </DialogContentText>

        <RadioGroup value={reason} onChange={(e) => setReason(e.target.value)}>
          {REPORT_REASONS.map((item) => (
            <FormControlLabel
              key={item}
              value={item}
              control={<Radio />}
              label={<Typography sx={{ fontSize: 15 }}>{item}</Typography>}
              sx={{ minHeight: 44, ml: 0 }}
            />
          ))}
        </RadioGroup>

        <TextField
          multiline
          minRows={2}
          fullWidth
          sx={{ mt: 1.5, '& .MuiOutlinedInput-root': { fontSize: 15 } }}
          placeholder="补充说明（选填）"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          inputProps={{ 'aria-label': '举报补充说明' }}
        />

        {error ? (
          <Typography sx={{ fontSize: 14, color: 'error.main', mt: 1 }}>{error}</Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={handleClose} size="large" sx={{ minHeight: 44 }}>
          取消
        </Button>
        <Button
          onClick={() => void handleSubmit()}
          variant="contained"
          color="error"
          size="large"
          disabled={submitting}
        >
          {submitting ? '提交中…' : '提交举报'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ReportDialog;
