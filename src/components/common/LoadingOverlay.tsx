import { Backdrop, Box, CircularProgress, Typography } from '@mui/material';

/**
 * 全屏加载遮罩。
 */
export interface LoadingOverlayProps {
  /** 是否显示。 */
  open: boolean;
  /** 提示文案。 */
  message?: string;
}

export function LoadingOverlay({ open, message }: LoadingOverlayProps): JSX.Element {
  return (
    <Backdrop
      open={open}
      sx={{ zIndex: (theme) => theme.zIndex.modal + 1, color: '#fff', flexDirection: 'column', gap: 2 }}
    >
      <CircularProgress color="inherit" size={32} />
      {message ? (
        <Typography sx={{ fontSize: 15, opacity: 0.92 }}>{message}</Typography>
      ) : null}
    </Backdrop>
  );
}

/** 行内加载占位（列表/卡片场景，避免整屏遮挡）。 */
export function InlineLoading({ message = '加载中…' }: { message?: string }): JSX.Element {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1.5, py: 4 }}>
      <CircularProgress size={20} />
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
    </Box>
  );
}

export default LoadingOverlay;
