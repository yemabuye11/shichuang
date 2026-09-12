import { Box, Button, Chip, Divider, Stack, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import BlockIcon from '@mui/icons-material/Block';
import { formatDateTime } from '@/utils/format';
import type { ReportItem } from '@/types/models';

/**
 * 举报处理与下架（管理员三功能之三）。
 */
export interface ReportListProps {
  items: readonly ReportItem[];
  loading?: boolean;
  /** 标记为已处理。 */
  onHandle: (id: string) => void;
  /** 忽略举报。 */
  onDismiss: (id: string) => void;
  /** 下架被举报的应用。 */
  onTakedown: (appId: string) => void;
}

export function ReportList({
  items,
  loading = false,
  onHandle,
  onDismiss,
  onTakedown,
}: ReportListProps): JSX.Element {
  return (
    <Box sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', bgcolor: '#fff', p: 2.5 }}>
      <Typography sx={{ fontSize: 17, fontWeight: 700, mb: 0.5 }}>举报处理</Typography>
      <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 2, lineHeight: 1.7 }}>
        核实后可直接下架应用；误报可以标记为已处理并保留应用。
      </Typography>

      {loading ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 2 }}>加载中…</Typography>
      ) : items.length === 0 ? (
        <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 3, textAlign: 'center' }}>
          暂无待处理的举报
        </Typography>
      ) : (
        <Stack divider={<Divider />} spacing={0}>
          {items.map((item) => (
            <Box key={item.id} sx={{ py: 2 }}>
              <Stack spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Chip
                    size="small"
                    label={item.status === 'pending' ? '待处理' : item.status === 'handled' ? '已处理' : '已忽略'}
                    color={item.status === 'pending' ? 'warning' : 'default'}
                    sx={{ fontWeight: 700 }}
                  />
                  <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>
                    {item.reason}
                  </Typography>
                </Stack>

                <Typography sx={{ fontSize: 14, color: 'text.secondary', lineHeight: 1.7 }}>
                  被举报应用：{item.appTitle || item.appId}
                </Typography>
                {item.detail ? (
                  <Typography sx={{ fontSize: 14, color: 'text.primary', lineHeight: 1.7 }}>
                    补充说明：{item.detail}
                  </Typography>
                ) : null}
                <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>
                  {formatDateTime(item.createdAt)}
                </Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<CheckCircleOutlineIcon />}
                    onClick={() => onHandle(item.id)}
                    sx={{ flex: 1, minHeight: 46 }}
                  >
                    已核实处理
                  </Button>
                  <Button
                    variant="outlined"
                    size="large"
                    color="error"
                    startIcon={<BlockIcon />}
                    onClick={() => onTakedown(item.appId)}
                    sx={{ flex: 1, minHeight: 46 }}
                  >
                    下架该应用
                  </Button>
                  <Button
                    variant="text"
                    size="large"
                    onClick={() => onDismiss(item.id)}
                    sx={{ flex: 1, minHeight: 46, color: 'text.secondary' }}
                  >
                    忽略
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}

export default ReportList;
