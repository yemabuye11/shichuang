import { Box, Button, CircularProgress, Typography } from '@mui/material';

/**
 * 「加载更多」按钮（每页 ≤24 条，ARCHITECTURE.md §7 T05 验收点）。
 */
export interface LoadMoreButtonProps {
  /** 是否还有下一页。 */
  hasMore: boolean;
  /** 是否正在加载。 */
  loading: boolean;
  /** 已加载条数 / 总条数。 */
  loaded: number;
  total: number;
  onClick: () => void;
}

export function LoadMoreButton({
  hasMore,
  loading,
  loaded,
  total,
  onClick,
}: LoadMoreButtonProps): JSX.Element {
  return (
    <Box sx={{ textAlign: 'center', py: 2 }}>
      {hasMore ? (
        <Button
          variant="outlined"
          size="large"
          onClick={onClick}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={18} /> : null}
          sx={{ minHeight: 48, px: 4, borderColor: 'divider', color: 'text.primary', bgcolor: '#fff' }}
        >
          {loading ? '加载中…' : '加载更多'}
        </Button>
      ) : (
        <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
          {total > 0 ? `已经到底啦，共 ${total} 个应用` : ''}
        </Typography>
      )}
      {hasMore ? (
        <Typography sx={{ fontSize: 12.5, color: 'text.disabled', mt: 1 }}>
          已显示 {loaded} / {total}
        </Typography>
      ) : null}
    </Box>
  );
}

export default LoadMoreButton;
