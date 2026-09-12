import { Box, Stack, Typography } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import { INSUFFICIENT_CREDITS_HINT } from '@/config/creditRules';

/**
 * 生成前的消耗提示（P0-F2：生成前透明）。
 *
 * 「本次预计消耗 X 积分，生成后剩余 Y 积分」——教师最在意的一句话。
 * ⚠️ 前端只做展示，**不判断余额是否足够**，以服务端 `reserve_credits()` 为准。
 */
export interface CostHintProps {
  /** 本次预计消耗积分。 */
  cost: number;
  /** 当前余额（未登录可为 null）。 */
  balance: number | null;
  /** 是否正在预估。 */
  loading?: boolean;
  /** 额外说明（如「失败会退还」）。 */
  note?: string;
}

export function CostHint({ cost, balance, loading = false, note }: CostHintProps): JSX.Element {
  const enough = balance === null || balance >= cost;
  const remain = balance === null ? null : Math.max(balance - cost, 0);

  if (loading) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontSize: 15 }}>
        正在预估本次消耗…
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        borderRadius: 2.5,
        px: 2,
        py: 1.25,
        bgcolor: enough ? 'rgba(47,107,255,0.05)' : 'rgba(229,72,77,0.06)',
        border: '1px solid',
        borderColor: enough ? 'rgba(47,107,255,0.14)' : 'rgba(229,72,77,0.24)',
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <BoltIcon sx={{ fontSize: 18, color: enough ? 'warning.main' : 'error.main' }} aria-hidden="true" />
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: 'text.primary' }}>
          本次预计消耗 {cost} 积分
        </Typography>
        {remain !== null ? (
          <Typography sx={{ fontSize: 15, color: enough ? 'text.secondary' : 'error.main' }}>
            ，生成后剩余 {remain} 积分
          </Typography>
        ) : null}
      </Stack>
      {!enough ? (
        <Typography sx={{ fontSize: 13.5, color: 'error.main', mt: 0.5, lineHeight: 1.6 }}>
          {INSUFFICIENT_CREDITS_HINT}
        </Typography>
      ) : note ? (
        <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 0.5, lineHeight: 1.6 }}>
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}

export default CostHint;
