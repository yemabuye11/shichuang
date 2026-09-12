import { useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';

/**
 * 二次确认弹窗（危险操作统一走这里，避免误删）。
 */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 说明文案。 */
  description?: ReactNode;
  /** 确认按钮文案。 */
  confirmText?: string;
  /** 取消按钮文案。 */
  cancelText?: string;
  /** 是否危险操作（红色按钮）。 */
  danger?: boolean;
  /** 是否显示「输入确认文字」的输入框（删除应用等场景）。 */
  requireText?: string;
  /** 确认中（按钮 loading）。 */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  requireText,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const [typed, setTyped] = useState('');
  const blocked = requireText != null && typed.trim() !== requireText;

  const handleConfirm = (): void => {
    if (blocked) return;
    setTyped('');
    onConfirm();
  };

  const handleCancel = (): void => {
    setTyped('');
    onCancel();
  };

  return (
    <Dialog open={open} onClose={handleCancel} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700 }}>{title}</DialogTitle>
      <DialogContent>
        {typeof description === 'string' ? (
          <DialogContentText sx={{ fontSize: 15 }}>{description}</DialogContentText>
        ) : (
          description
        )}
        {requireText != null ? (
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 2 }}
            label={`请输入「${requireText}」以确认`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={handleCancel} size="large" sx={{ minHeight: 44 }}>
          {cancelText}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color={danger ? 'error' : 'primary'}
          disabled={blocked || loading}
          size="large"
        >
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConfirmDialog;
