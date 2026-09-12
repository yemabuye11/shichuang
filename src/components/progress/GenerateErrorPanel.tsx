import { useState } from 'react';
import { Box, Button, Collapse, Stack, TextField, Typography } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { ErrorEvent } from '@/types/api';

/**
 * 生成失败 / 已取消面板（UI-3 失败态）。
 *
 * 硬要求（PRD US4）：**必须明确告诉教师积分是否已退还。**
 */
export interface GenerateErrorPanelProps {
  error: ErrorEvent | null;
  /** 原始提示词（用于「换个说法」编辑）。 */
  prompt: string;
  /** 重试（用同一份提示词）。 */
  onRetry: () => void;
  /** 换个说法（提交编辑后的提示词）。 */
  onEdit: (prompt: string) => void;
  /** 返回生成页。 */
  onBack: () => void;
}

export function GenerateErrorPanel({
  error,
  prompt,
  onRetry,
  onEdit,
  onBack,
}: GenerateErrorPanelProps): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt);

  const cancelled = error?.code === 'CANCELLED';
  const refunded = error?.refunded === true;
  const message = error?.message || '出了点小问题，请稍后重试';

  const handleSubmitEdit = (): void => {
    const next = draft.trim();
    if (next.length === 0) return;
    setEditing(false);
    onEdit(next);
  };

  return (
    <Box
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: cancelled ? 'divider' : 'rgba(229,72,77,0.28)',
        bgcolor: cancelled ? 'rgba(27,31,39,0.03)' : 'rgba(229,72,77,0.05)',
        p: 2.5,
      }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start">
          <ErrorOutlineIcon
            sx={{ fontSize: 26, color: cancelled ? 'text.secondary' : 'error.main', mt: '1px' }}
            aria-hidden="true"
          />
          <Box>
            <Typography sx={{ fontSize: 17, fontWeight: 700, color: 'text.primary', lineHeight: 1.6 }}>
              {cancelled ? '已取消生成' : '这次没生成成功'}
            </Typography>
            <Typography sx={{ fontSize: 15, color: 'text.secondary', mt: 0.5, lineHeight: 1.7 }}>
              {message}
            </Typography>
            {!cancelled ? (
              <Typography
                sx={{
                  fontSize: 15,
                  fontWeight: 700,
                  mt: 1,
                  lineHeight: 1.7,
                  color: refunded ? 'success.main' : 'warning.main',
                }}
              >
                {refunded
                  ? '本次积分已全额退还，可以放心重试。'
                  : '本次未扣除积分，可以放心重试。'}
              </Typography>
            ) : null}
          </Box>
        </Stack>

        <Collapse in={editing}>
          <Box sx={{ pt: 0.5 }}>
            <TextField
              multiline
              minRows={3}
              fullWidth
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="把需求写得更具体一些，例如加上学科、年级、玩法和题量"
              inputProps={{ 'aria-label': '修改需求描述' }}
              sx={{
                '& .MuiOutlinedInput-root': { borderRadius: 2.5, backgroundColor: '#fff', fontSize: 16 },
              }}
            />
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button variant="contained" size="large" onClick={handleSubmitEdit} sx={{ flex: 1 }}>
                用这个说法重新生成
              </Button>
              <Button variant="text" size="large" onClick={() => setEditing(false)}>
                取消
              </Button>
            </Stack>
          </Box>
        </Collapse>

        {!editing ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <Button variant="contained" size="large" onClick={onRetry} sx={{ flex: 1 }}>
              重试一次
            </Button>
            <Button variant="outlined" size="large" onClick={() => setEditing(true)} sx={{ flex: 1 }}>
              换个说法
            </Button>
            <Button variant="text" size="large" onClick={onBack} sx={{ flex: 1 }}>
              返回修改
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

export default GenerateErrorPanel;
