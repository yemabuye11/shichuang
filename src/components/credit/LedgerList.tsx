import { Box, Divider, Stack, Typography } from '@mui/material';
import { ledgerReasonLabel } from '@/config/creditRules';
import { formatDateTime, formatDelta } from '@/utils/format';
import type { LedgerItem } from '@/types/models';

/**
 * 积分明细（UI-6）：积分 + token 双显示（P0-F3）。
 *
 * 兼顾「教师看得懂」与「管理员可核对」：主行是积分，副行是 token 与模型。
 */
export interface LedgerListProps {
  items: readonly LedgerItem[];
  /** 最多展示条数（0 表示不限）。 */
  limit?: number;
  /** 空态文案。 */
  emptyText?: string;
}

export function LedgerList({
  items,
  limit = 0,
  emptyText = '还没有积分记录',
}: LedgerListProps): JSX.Element {
  const list = limit > 0 ? items.slice(0, limit) : items;

  if (list.length === 0) {
    return (
      <Typography sx={{ fontSize: 14, color: 'text.secondary', py: 3, textAlign: 'center' }}>
        {emptyText}
      </Typography>
    );
  }

  return (
    <Box sx={{ borderRadius: 2.5, border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
      {list.map((item, index) => {
        const positive = item.delta > 0;
        const tokens = item.tokensIn + item.tokensOut;

        return (
          <Box key={item.id}>
            {index > 0 ? <Divider /> : null}
            <Stack
              direction="row"
              alignItems="center"
              spacing={1.5}
              sx={{ px: 2, py: 1.5, minHeight: 56 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary' }}>
                  {ledgerReasonLabel(item.reason)}
                  {item.memo ? (
                    <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                      {' · '}
                      {item.memo}
                    </Box>
                  ) : null}
                </Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                  {formatDateTime(item.createdAt)}
                  {tokens > 0 ? ` · ${(tokens / 1000).toFixed(1)}k token` : ''}
                  {item.model ? ` · ${item.model}` : ''}
                </Typography>
              </Box>

              <Typography
                sx={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: positive ? 'success.main' : 'text.primary',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatDelta(item.delta)}
              </Typography>
            </Stack>
          </Box>
        );
      })}
    </Box>
  );
}

export default LedgerList;
